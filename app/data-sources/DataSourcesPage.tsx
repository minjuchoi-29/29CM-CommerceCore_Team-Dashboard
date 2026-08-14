"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  JiraFilter,
  FilterPreview,
  FilterTicketsStore,
  TicketSourcesStore,
} from "@/lib/filter-types";
import {
  buildEffectiveFilterJql,
  inferJiraFilterKind,
  inferJiraFilterTargetArea,
} from "@/lib/filter-policy";
import {
  getDataSourceHealth,
  getFilterLastSuccessAt,
  type SyncRunRecord,
} from "@/lib/sync-run-types";

// ── 운영 지표 계산 ─────────────────────────────────────────────────────────────

interface FilterStats {
  ticketCount: number;
  contributionCount: number;
  overlapCount: number;
  redundant: boolean;
  hiddenCount: number;
  removedCount: number;
  delta: number | null;
  removedKeys: string[];
}

function computeFilterStats(
  filter: JiraFilter,
  filters: JiraFilter[],
  filterTickets: FilterTicketsStore,
  hiddenKeys: Set<string>,
  ticketSources: TicketSourcesStore,
): FilterStats {
  const currentKeys = new Set(filterTickets[filter.id] ?? []);
  const ticketCount = currentKeys.size;
  const hiddenCount = [...currentKeys].filter(k => hiddenKeys.has(k)).length;
  const otherActiveKeys = new Set(
    filters
      .filter(other => other.id !== filter.id && other.enabled !== false)
      .flatMap(other => filterTickets[other.id] ?? []),
  );
  const contributionCount = [...currentKeys].filter(key => !otherActiveKeys.has(key)).length;
  const overlapCount = ticketCount - contributionCount;
  const redundant = ticketCount > 0 && contributionCount === 0;

  // 제거된 티켓: cc-ticket-sources에 이 filterId 엔트리가 있는데 현재 filter에 없는 것
  const removedKeys: string[] = [];
  for (const [key, entries] of Object.entries(ticketSources)) {
    const inSource = entries.some(e => e.filterId === filter.id);
    if (inSource && !currentKeys.has(key)) {
      removedKeys.push(key);
    }
  }

  const delta =
    filter.prevSyncCount != null && filter.lastSyncCount != null
      ? filter.lastSyncCount - filter.prevSyncCount
      : null;

  return {
    ticketCount,
    contributionCount,
    overlapCount,
    redundant,
    hiddenCount,
    removedCount: removedKeys.length,
    delta,
    removedKeys,
  };
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeTime(iso: string | null): string {
  if (!iso) return "동기화 안 됨";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "방금 전";
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  return `${Math.floor(hrs / 24)}일 전`;
}

function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs == null) return "—";
  if (durationMs < 1_000) return `${durationMs}ms`;
  const seconds = Math.round(durationMs / 100) / 10;
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}분 ${Math.round(seconds % 60)}초`;
}

type SourceGroupId = "core" | "coverage" | "cleanup";

const SOURCE_GROUP_META: Record<SourceGroupId, { title: string; description: string }> = {
  core: {
    title: "필수 관리 소스",
    description: "우리 팀의 직접 F/U와 ETR 접수 흐름을 구성합니다.",
  },
  coverage: {
    title: "범위 보완 소스",
    description: "팀 참여 관계만으로 놓칠 수 있는 Commerce Core 과제를 보완합니다.",
  },
  cleanup: {
    title: "중지·정리 검토",
    description: "고유 기여가 없거나 현재 사용을 중지한 소스입니다.",
  },
};

function getSourceGroup(filter: JiraFilter, stats: FilterStats | null): SourceGroupId {
  if (filter.enabled === false || stats?.redundant) return "cleanup";
  const kind = inferJiraFilterKind(filter);
  if (kind === "assignee" || kind === "etr") return "core";
  return "coverage";
}

function getSourcePurpose(filter: JiraFilter): string {
  const kind = inferJiraFilterKind(filter);
  if (kind === "assignee") return "우리 팀이 담당·요청·참조한 티켓을 추적";
  if (kind === "etr") return "접수된 ETR 요청을 검토 목록에 반영";
  if (kind === "initiative") return "Commerce Core 전체 Initiative 범위를 보완";
  return "등록한 Jira Filter 결과를 관리 목록에 반영";
}

// ── 하위 컴포넌트: 상태 배지 ──────────────────────────────────────────────────

function SyncStatusBadge({ filter }: { filter: JiraFilter }) {
  const health = getDataSourceHealth(filter);
  const colorByStatus = {
    current: { background: "rgba(52,211,153,0.12)", color: "#059669" },
    stale: { background: "rgba(245,158,11,0.12)", color: "#d97706" },
    error: { background: "rgba(239,68,68,0.12)", color: "#dc2626" },
    pending: { background: "rgba(148,163,184,0.1)", color: "var(--text-subtle)" },
  }[health.status];
  return (
    <span
      className="text-[11px] px-1.5 py-0.5 rounded font-medium"
      style={colorByStatus}
    >
      {health.label}
    </span>
  );
}

// ── 하위 컴포넌트: 필터 카드 ──────────────────────────────────────────────────

function FilterCard({
  filter,
  onSync,
  onToggle,
  onDelete,
  syncing,
  toggling,
  stats,
}: {
  filter: JiraFilter;
  onSync: (id: string) => void;
  onToggle: (filter: JiraFilter) => void;
  onDelete: (id: string) => void;
  syncing: boolean;
  toggling: boolean;
  stats: FilterStats | null;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const displayName = filter.label ?? filter.name;
  const sourceKind = inferJiraFilterKind(filter);
  const targetArea = inferJiraFilterTargetArea(filter);
  const enabled = filter.enabled !== false;
  const sourceGroup = getSourceGroup(filter, stats);
  const effectiveJql = buildEffectiveFilterJql(filter);
  const sourceGroupLabel = sourceGroup === "core" ? "필수" : sourceGroup === "coverage" ? "보완" : enabled ? "중복" : "중지됨";
  const sourceGroupColor = sourceGroup === "core" ? "#0f766e" : sourceGroup === "coverage" ? "#315b91" : "#b45309";
  const kindLabel = {
    assignee: "팀 참여 F/U",
    etr: "ETR 요청",
    initiative: "전체 과제",
    general: "일반 소스",
  }[sourceKind];

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        background: "var(--bg-card)",
        border: `1px solid ${sourceGroup === "cleanup" ? "rgba(180,83,9,0.28)" : "var(--border)"}`,
        opacity: enabled ? 1 : 0.72,
      }}
    >
      {/* 헤더 */}
      <div className="flex items-start gap-3">
        {/* 필터 아이콘 */}
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: `${sourceGroupColor}14` }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke={sourceGroupColor} strokeWidth="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              {displayName}
            </h3>
            {filter.label && filter.label !== filter.name && (
              <span className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
                {filter.name}
              </span>
            )}
            {enabled && <SyncStatusBadge filter={filter} />}
            <span
              className="text-[11px] px-1.5 py-0.5 rounded font-semibold"
              style={{ background: `${sourceGroupColor}14`, color: sourceGroupColor }}
            >
              {sourceGroupLabel}
            </span>
            <span
              className="text-[11px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: "var(--bg-item)", color: "var(--text-muted)" }}
            >
              {kindLabel} · {targetArea === "etr" ? "ETR 검토" : targetArea === "tickets" ? "전체 과제" : "자동 분류"}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <a
              href={`https://musinsa-oneteam.atlassian.net/issues/?filter=${filter.jiraFilterId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs hover:underline"
              style={{ color: "#315b91" }}
            >
              Filter #{filter.jiraFilterId}
            </a>
            <span style={{ color: "var(--text-subtle)" }}>·</span>
            <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
              등록 {formatDate(filter.createdAt)}
            </span>
          </div>
          <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
            {getSourcePurpose(filter)}
          </p>
        </div>

        {/* 액션 버튼 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onToggle(filter)}
            disabled={toggling || syncing}
            aria-pressed={enabled}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
            style={{
              background: enabled ? "rgba(15,118,110,0.09)" : "var(--bg-item)",
              color: enabled ? "#0f766e" : "var(--text-muted)",
              border: `1px solid ${enabled ? "rgba(15,118,110,0.22)" : "var(--border-2)"}`,
            }}
            title={enabled ? "수집을 중지하되 설정과 기존 이력은 보존합니다." : "수집을 다시 시작하고 즉시 동기화합니다."}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: enabled ? "#0f766e" : "var(--text-subtle)" }} />
            {toggling ? "변경 중" : enabled ? "수집 중지" : "다시 사용"}
          </button>
          <button
            onClick={() => onSync(filter.id)}
            disabled={syncing || toggling || !enabled}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: syncing ? "rgba(49,91,145,0.08)" : "rgba(49,91,145,0.1)",
              color: "#315b91",
              border: "1px solid rgba(49,91,145,0.22)",
            }}
            title="Jira에서 티켓 목록 새로고침"
          >
            <svg
              className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
              <path d="M8 16H3v5"/>
            </svg>
            {syncing ? "동기화 중..." : "동기화"}
          </button>
        </div>
      </div>

      {/* 운영 지표 stats row */}
      {stats !== null && (
        <div
          className="flex items-center gap-3 pt-2 text-xs flex-wrap"
          style={{ borderTop: "1px solid var(--border-2)", color: "var(--text-subtle)" }}
        >
          <span>
            {enabled ? "현재" : "보관된 결과"}{" "}
            <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
              {stats.ticketCount.toLocaleString()}
            </span>
            개
          </span>
          <span style={{ color: "var(--border-2)" }}>·</span>
          <span>
            {enabled ? "이 소스만 추가" : "재개 시 추가"}{" "}
            <span className="font-semibold" style={{ color: stats.contributionCount > 0 ? "#0f766e" : "#b45309" }}>
              {stats.contributionCount.toLocaleString()}
            </span>
          </span>
          {stats.overlapCount > 0 && (
            <>
              <span style={{ color: "var(--border-2)" }}>·</span>
              <span>
                다른 소스와 중복 <strong style={{ color: "var(--text-muted)" }}>{stats.overlapCount.toLocaleString()}</strong>
              </span>
            </>
          )}
          {stats.hiddenCount > 0 && (
            <>
              <span style={{ color: "var(--border-2)" }}>·</span>
              <span>
                숨김{" "}
                <span className="font-semibold" style={{ color: "var(--text-muted)" }}>
                  {stats.hiddenCount}
                </span>
              </span>
            </>
          )}
          {stats.removedCount > 0 && (
            <>
              <span style={{ color: "var(--border-2)" }}>·</span>
              <button
                onClick={() => setShowRemoved(prev => !prev)}
                className="flex items-center gap-1 font-semibold transition-all"
                style={{ color: "#fb923c" }}
              >
                최근 필터에서 빠짐{" "}
                <span
                  className="px-1 py-0.5 rounded text-[11px]"
                  style={{ background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.2)" }}
                >
                  {stats.removedCount}
                </span>
                <svg
                  className={`w-3 h-3 transition-transform ${showRemoved ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
            </>
          )}
          {stats.delta !== null && (
            <>
              <span style={{ color: "var(--border-2)" }}>·</span>
              <span
                className="font-semibold"
                style={{ color: stats.delta > 0 ? "#34d399" : stats.delta < 0 ? "#f87171" : "var(--text-subtle)" }}
              >
                {stats.delta > 0 ? `+${stats.delta}` : stats.delta}
              </span>
            </>
          )}
        </div>
      )}

      {/* 이전 소속 이력 패널 */}
      {showRemoved && stats !== null && stats.removedKeys.length > 0 && (
        <div
          className="rounded-lg px-3 py-2.5 flex flex-col gap-1.5"
          style={{ background: "rgba(251,146,60,0.06)", border: "1px solid rgba(251,146,60,0.18)" }}
        >
          <p className="text-[11px] font-semibold mb-1" style={{ color: "#b45309" }}>
            이전에는 포함됐지만 현재 필터 결과에는 없는 티켓
          </p>
          <div className="flex flex-col gap-1">
            {stats.removedKeys.map(key => (
              <div key={key} className="flex items-center gap-2">
                <a
                  href={`https://musinsa-oneteam.atlassian.net/browse/${key}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono hover:underline"
                  style={{ color: "#fb923c" }}
                >
                  {key} ↗
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {sourceKind === "assignee" && !filter.syncJql && (
        <div
          className="rounded-lg px-3 py-2 text-xs"
          style={{ background: "rgba(14,116,144,0.07)", color: "#0e7490", border: "1px solid rgba(14,116,144,0.15)" }}
        >
          대시보드 수집 정책 · 우리 팀이 담당·요청·참조한 미완료 티켓 전체와 최근 14일 내 완료 티켓을 추적합니다.
        </div>
      )}

      <details className="group rounded-lg" style={{ background: "var(--bg-item)", border: "1px solid var(--border-2)" }}>
        <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium flex items-center justify-between" style={{ color: "var(--text-muted)" }}>
          <span>실제 수집 조건과 관리 기능</span>
          <span className="group-open:rotate-180 transition-transform">⌄</span>
        </summary>
        <div className="px-3 pb-3 flex flex-col gap-2">
          <div>
            <p className="text-[11px] mb-1" style={{ color: "var(--text-subtle)" }}>대시보드에 실제 적용되는 JQL</p>
            <div className="rounded px-2.5 py-2 text-[11px] font-mono leading-relaxed overflow-x-auto" style={{ background: "var(--bg-canvas)", color: "var(--text-muted)" }}>
              {effectiveJql}
            </div>
          </div>
          {effectiveJql !== filter.jql && (
            <div>
              <p className="text-[11px] mb-1" style={{ color: "var(--text-subtle)" }}>Jira에 저장된 원본 JQL</p>
              <div className="rounded px-2.5 py-2 text-[11px] font-mono leading-relaxed overflow-x-auto" style={{ background: "var(--bg-canvas)", color: "var(--text-subtle)" }}>
                {filter.jql}
              </div>
            </div>
          )}
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="self-start text-[11px] px-2 py-1 rounded"
              style={{ color: "#b91c1c", border: "1px solid rgba(185,28,28,0.2)" }}
            >
              데이터 소스 삭제
            </button>
          ) : (
            <div className="flex items-center gap-2 text-[11px]">
              <span style={{ color: "#b91c1c" }}>설정과 소속 이력을 삭제할까요?</span>
              <button onClick={() => onDelete(filter.id)} className="px-2 py-1 rounded" style={{ background: "#b91c1c", color: "white" }}>삭제</button>
              <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 rounded" style={{ border: "1px solid var(--border-2)" }}>취소</button>
            </div>
          )}
        </div>
      </details>

      {/* 동기화 메타 */}
      <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-subtle)" }}>
        <span>
          마지막 성공: <span style={{ color: "var(--text-muted)" }}>{relativeTime(getFilterLastSuccessAt(filter))}</span>
        </span>
        <span className="flex items-center gap-3">
          {filter.lastSyncDurationMs != null && <span>소요 {formatDuration(filter.lastSyncDurationMs)}</span>}
          {filter.lastSyncCount != null && (
            <span>
              티켓 <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{filter.lastSyncCount.toLocaleString()}</span>개
            </span>
          )}
        </span>
      </div>

      {/* 오류 메시지 */}
      {filter.lastSyncError && (
        <div
          className="rounded-lg px-3 py-2 text-[11px]"
          style={{ background: "rgba(239,68,68,0.08)", color: "#f87171", border: "1px solid rgba(239,68,68,0.15)" }}
        >
          {filter.lastSyncError}
        </div>
      )}
    </div>
  );
}

// ── 하위 컴포넌트: 필터 추가 폼 ──────────────────────────────────────────────

function AddFilterForm({ onAdded }: { onAdded: (initialSyncOk: boolean) => void }) {
  const [input, setInput] = useState("");
  const [label, setLabel] = useState("");
  const [preview, setPreview] = useState<FilterPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // input debounce → preview
  useEffect(() => {
    const trimmed = input.trim();
    if (!trimmed) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      setPreview(null);
      try {
        const res = await fetch(`/api/jira-filters?preview=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        if (!res.ok) {
          setPreviewError(data.error ?? "미리보기 조회 실패");
        } else {
          setPreview(data as FilterPreview);
        }
      } catch {
        setPreviewError("네트워크 오류");
      } finally {
        setPreviewLoading(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [input]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/jira-filters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filterIdOrUrl: input.trim(), label: label.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "등록 실패");
      } else {
        setInput("");
        setLabel("");
        setPreview(null);
        onAdded(data.initialSync?.ok === true);
      }
    } catch {
      setSubmitError("네트워크 오류");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
            Jira Filter ID 또는 URL
          </label>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="예: 12345  또는  https://...atlassian.net/issues/?filter=12345"
            className="w-full rounded-lg px-3 py-2 text-xs outline-none transition-all"
            style={{
              background: "var(--bg-item)",
              border: "1px solid var(--border-2)",
              color: "var(--text-primary)",
            }}
            onFocus={e => { (e.target as HTMLElement).style.borderColor = "#315b91"; }}
            onBlur={e => { (e.target as HTMLElement).style.borderColor = "var(--border-2)"; }}
          />
        </div>
        <div style={{ width: 180 }}>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
            레이블 <span style={{ color: "var(--text-subtle)" }}>(선택)</span>
          </label>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="예: ETR 신규 과제"
            className="w-full rounded-lg px-3 py-2 text-xs outline-none transition-all"
            style={{
              background: "var(--bg-item)",
              border: "1px solid var(--border-2)",
              color: "var(--text-primary)",
            }}
            onFocus={e => { (e.target as HTMLElement).style.borderColor = "#315b91"; }}
            onBlur={e => { (e.target as HTMLElement).style.borderColor = "var(--border-2)"; }}
          />
        </div>
      </div>

      {/* 미리보기 */}
      {previewLoading && (
        <div className="text-xs" style={{ color: "var(--text-subtle)" }}>
          Jira 필터 조회 중...
        </div>
      )}
      {previewError && (
        <div
          className="rounded-lg px-3 py-2 text-[11px]"
          style={{ background: "rgba(239,68,68,0.08)", color: "#f87171", border: "1px solid rgba(239,68,68,0.15)" }}
        >
          {previewError}
        </div>
      )}
      {preview && (
        <div
          className="rounded-lg px-3 py-2.5 flex flex-col gap-1.5"
          style={{ background: "rgba(49,91,145,0.06)", border: "1px solid rgba(49,91,145,0.18)" }}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold" style={{ color: "#315b91" }}>{preview.name}</span>
            <span
              className="text-[11px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: "rgba(49,91,145,0.12)", color: "#315b91" }}
            >
              {preview.estimatedCount.toLocaleString()}개
            </span>
          </div>
          <div className="text-xs font-mono" style={{ color: "var(--text-subtle)" }}>{preview.jql}</div>
        </div>
      )}

      {submitError && (
        <div
          className="rounded-lg px-3 py-2 text-[11px]"
          style={{ background: "rgba(239,68,68,0.08)", color: "#f87171", border: "1px solid rgba(239,68,68,0.15)" }}
        >
          {submitError}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting || !preview || !!previewError}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: "#17324d",
            color: "white",
          }}
        >
          {submitting ? (
            <>
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
              </svg>
              등록 중...
            </>
          ) : "필터 등록"}
        </button>
      </div>
    </form>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

export default function DataSourcesPage() {
  const [filters, setFilters] = useState<JiraFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // 운영 지표용 추가 KV 상태
  const [filterTickets, setFilterTickets] = useState<FilterTicketsStore>({});
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [ticketSources, setTicketSources] = useState<TicketSourcesStore>({});
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [syncRuns, setSyncRuns] = useState<SyncRunRecord[]>([]);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const loadFilters = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/jira-filters");
      if (!res.ok) throw new Error("필터 목록 로드 실패");
      const data = await res.json() as { filters: JiraFilter[] };
      setFilters(data.filters);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/kv?keys=cc-filter-tickets,cc-hidden-keys,cc-ticket-sources");
      if (!res.ok) return;
      const data = await res.json() as Record<string, unknown>;

      if (data["cc-filter-tickets"] && typeof data["cc-filter-tickets"] === "object" && !Array.isArray(data["cc-filter-tickets"]))
        setFilterTickets(data["cc-filter-tickets"] as FilterTicketsStore);
      if (Array.isArray(data["cc-hidden-keys"]))
        setHiddenKeys(new Set(data["cc-hidden-keys"] as string[]));
      if (data["cc-ticket-sources"] && typeof data["cc-ticket-sources"] === "object" && !Array.isArray(data["cc-ticket-sources"]))
        setTicketSources(data["cc-ticket-sources"] as TicketSourcesStore);
    } catch {
      // stats 로드 실패는 UI에 영향 없음
    } finally {
      setStatsLoaded(true);
    }
  }, []);

  const loadSyncRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/sync-runs?limit=10");
      if (!res.ok) return;
      const data = await res.json() as { runs?: SyncRunRecord[] };
      setSyncRuns(Array.isArray(data.runs) ? data.runs : []);
    } catch {
      // 실행 기록이 없어도 기존 데이터 소스 관리는 가능하다.
    }
  }, []);

  useEffect(() => {
    loadFilters();
    loadStats();
    loadSyncRuns();
  }, [loadFilters, loadStats, loadSyncRuns]);

  async function handleSync(id: string) {
    setSyncingId(id);
    try {
      const res = await fetch(`/api/jira-filters/${id}/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "동기화 실패", "error");
      } else {
        showToast(`동기화 완료 — 티켓 ${(data.ticketKeys as string[]).length.toLocaleString()}개`);
        await Promise.all([loadFilters(), loadStats(), loadSyncRuns()]);
      }
    } catch {
      showToast("네트워크 오류", "error");
    } finally {
      setSyncingId(null);
    }
  }

  async function handleToggle(filter: JiraFilter) {
    const nextEnabled = filter.enabled === false;
    setTogglingId(filter.id);
    try {
      const updateResponse = await fetch(`/api/jira-filters/${filter.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const updateData = await updateResponse.json();
      if (!updateResponse.ok) {
        showToast(updateData.error ?? "데이터 소스 상태 변경 실패", "error");
        return;
      }

      if (nextEnabled) {
        const syncResponse = await fetch(`/api/jira-filters/${filter.id}/sync`, { method: "POST" });
        const syncData = await syncResponse.json();
        if (!syncResponse.ok) {
          showToast(`사용은 재개했지만 동기화에 실패했습니다: ${syncData.error ?? "알 수 없는 오류"}`, "error");
        } else {
          showToast(`사용 재개 · 티켓 ${(syncData.ticketKeys as string[]).length.toLocaleString()}개 확인`);
        }
      } else {
        showToast("수집을 중지했습니다. 설정과 기존 이력은 보존됩니다.");
      }
      await Promise.all([loadFilters(), loadStats(), loadSyncRuns()]);
    } catch {
      showToast("네트워크 오류", "error");
    } finally {
      setTogglingId(null);
    }
  }

  const statsByFilterId = useMemo(() => {
    if (!statsLoaded) return {} as Record<string, FilterStats>;
    return Object.fromEntries(filters.map(filter => [
      filter.id,
      computeFilterStats(filter, filters, filterTickets, hiddenKeys, ticketSources),
    ]));
  }, [filters, filterTickets, hiddenKeys, ticketSources, statsLoaded]);

  const activeFilters = filters.filter(filter => filter.enabled !== false);
  const activeSourceKeys = new Set(activeFilters.flatMap(filter => filterTickets[filter.id] ?? []));
  const activeSourceRawCount = activeFilters.reduce((sum, filter) => sum + (filterTickets[filter.id]?.length ?? 0), 0);
  const duplicateMembershipCount = Math.max(0, activeSourceRawCount - activeSourceKeys.size);
  const cleanupCandidateCount = filters.filter(filter => getSourceGroup(filter, statsByFilterId[filter.id] ?? null) === "cleanup").length;
  const groupedFilters = (["core", "coverage", "cleanup"] as SourceGroupId[]).map(group => ({
    group,
    filters: filters.filter(filter => getSourceGroup(filter, statsByFilterId[filter.id] ?? null) === group),
  })).filter(entry => entry.filters.length > 0);

  const latestDailyRun = syncRuns.find(run => run.kind === "daily-refresh");
  const sourceHealthCounts = activeFilters.reduce(
    (counts, filter) => {
      counts[getDataSourceHealth(filter).status]++;
      return counts;
    },
    { current: 0, stale: 0, error: 0, pending: 0 },
  );
  const latestRunStuck = latestDailyRun?.status === "running"
    && Date.now() - new Date(latestDailyRun.startedAt).getTime() > 15 * 60_000;
  const automaticStatus = latestRunStuck
    ? { label: "중단 가능성", healthy: false }
    : sourceHealthCounts.error > 0
      ? { label: "오류", healthy: false }
      : sourceHealthCounts.stale > 0
        ? { label: "갱신 지연", healthy: false }
        : latestDailyRun?.status === "running"
          ? { label: "실행 중", healthy: true }
          : latestDailyRun?.status === "success"
            ? { label: "정상", healthy: true }
            : latestDailyRun
              ? { label: "확인 필요", healthy: false }
              : { label: "기록 대기", healthy: sourceHealthCounts.current > 0 };

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/jira-filters/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error ?? "삭제 실패", "error");
      } else {
        showToast("필터가 삭제되었습니다.");
        setFilters(prev => prev.filter(f => f.id !== id));
      }
    } catch {
      showToast("네트워크 오류", "error");
    }
  }

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--bg-main)", color: "var(--text-primary)" }}
    >
      {/* 토스트 알림 */}
      {toast && (
        <div
          className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg transition-all"
          style={{
            background: toast.type === "success"
              ? "rgba(52,211,153,0.15)"
              : "rgba(239,68,68,0.15)",
            color: toast.type === "success" ? "#34d399" : "#f87171",
            border: `1px solid ${toast.type === "success" ? "rgba(52,211,153,0.3)" : "rgba(239,68,68,0.3)"}`,
            backdropFilter: "blur(8px)",
          }}
        >
          {toast.msg}
        </div>
      )}

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* 페이지 헤더 */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-lg font-bold mb-1" style={{ color: "var(--text-primary)" }}>
              데이터 소스
            </h1>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              어떤 Jira 티켓이 왜 관리 목록에 포함되는지 확인하고 수집 범위를 안전하게 조정합니다.
            </p>
          </div>
          <button
            onClick={() => setShowAddForm(prev => !prev)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shrink-0"
            style={{
              background: showAddForm ? "var(--bg-item)" : "#17324d",
              color: showAddForm ? "var(--text-muted)" : "white",
              border: showAddForm ? "1px solid var(--border-2)" : "none",
            }}
          >
            {showAddForm ? (
              <>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                닫기
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                필터 추가
              </>
            )}
          </button>
        </div>

        {filters.length > 0 && statsLoaded && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
            {[
              { label: "사용 중인 소스", value: `${activeFilters.length}개`, note: `전체 설정 ${filters.length}개` },
              { label: "소스 기준 고유 티켓", value: `${activeSourceKeys.size.toLocaleString()}개`, note: "수동·연결 티켓 제외" },
              { label: "중복 소속", value: `${duplicateMembershipCount.toLocaleString()}건`, note: "합집합에서 자동 제거" },
              { label: "정리 검토", value: `${cleanupCandidateCount}개`, note: "고유 기여 없음 또는 중지" },
            ].map(item => (
              <div key={item.label} className="rounded-xl px-3.5 py-3" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
                <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--text-subtle)" }}>{item.label}</p>
                <p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>{item.value}</p>
                <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>{item.note}</p>
              </div>
            ))}
          </div>
        )}

        <div
          className="rounded-xl px-4 py-3 mb-5 flex items-center justify-between gap-4"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                자동 갱신 상태
              </span>
              <span
                className="text-[11px] px-1.5 py-0.5 rounded font-medium"
                style={{
                  background: automaticStatus.healthy ? "rgba(52,211,153,0.12)" : "rgba(245,158,11,0.12)",
                  color: automaticStatus.healthy ? "#059669" : "#d97706",
                }}
              >
                {automaticStatus.label}
              </span>
            </div>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {latestDailyRun
                ? `최근 자동 실행 ${relativeTime(latestDailyRun.startedAt)} · ${formatDuration(latestDailyRun.durationMs)}`
                : "다음 자동 실행부터 단계별 시간과 오류를 기록합니다."}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
            <span>최신 <strong style={{ color: "#059669" }}>{sourceHealthCounts.current}</strong></span>
            <span>지연 <strong style={{ color: "#d97706" }}>{sourceHealthCounts.stale}</strong></span>
            <span>오류 <strong style={{ color: "#dc2626" }}>{sourceHealthCounts.error}</strong></span>
            {sourceHealthCounts.pending > 0 && <span>대기 <strong>{sourceHealthCounts.pending}</strong></span>}
          </div>
        </div>

        {/* 필터 추가 폼 */}
        {showAddForm && (
          <div
            className="rounded-xl p-5 mb-6"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
            }}
          >
            <h2 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
              Jira Filter 등록
            </h2>
            <AddFilterForm
              onAdded={(initialSyncOk) => {
                setShowAddForm(false);
                Promise.all([loadFilters(), loadStats(), loadSyncRuns()]);
                showToast(initialSyncOk
                  ? "필터 등록과 첫 티켓 동기화를 완료했습니다."
                  : "필터는 등록됐지만 첫 동기화에 실패했습니다. 상태를 확인해주세요.",
                initialSyncOk ? "success" : "error");
              }}
            />
          </div>
        )}

        {/* 필터 목록 */}
        {loading ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map(i => (
              <div
                key={i}
                className="rounded-xl h-28 animate-pulse"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
              />
            ))}
          </div>
        ) : error ? (
          <div
            className="rounded-xl px-4 py-6 text-center text-sm"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "#f87171" }}
          >
            {error}
            <button
              onClick={loadFilters}
              className="block mx-auto mt-3 text-xs underline"
              style={{ color: "var(--text-muted)" }}
            >
              다시 시도
            </button>
          </div>
        ) : filters.length === 0 ? (
          <div
            className="rounded-xl px-6 py-12 text-center"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3"
              style={{ background: "rgba(49,91,145,0.1)" }}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#315b91" strokeWidth="1.8">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: "var(--text-primary)" }}>
              등록된 Jira Filter가 없습니다
            </p>
            <p className="text-xs" style={{ color: "var(--text-subtle)" }}>
              + 필터 추가 버튼으로 Jira Filter를 연결하세요.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-7">
            {groupedFilters.map(({ group, filters: groupFilters }) => {
              const meta = SOURCE_GROUP_META[group];
              return (
                <section key={group}>
                  <div className="flex items-end justify-between gap-3 mb-2.5">
                    <div>
                      <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{meta.title}</h2>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{meta.description}</p>
                    </div>
                    <span className="text-[11px]" style={{ color: "var(--text-subtle)" }}>{groupFilters.length}개</span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {groupFilters.map(filter => (
                      <FilterCard
                        key={filter.id}
                        filter={filter}
                        onSync={handleSync}
                        onToggle={handleToggle}
                        onDelete={handleDelete}
                        syncing={syncingId === filter.id}
                        toggling={togglingId === filter.id}
                        stats={statsByFilterId[filter.id] ?? null}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {/* 안내 노트 */}
        {filters.length > 0 && (
          <div
            className="mt-6 rounded-xl px-4 py-3 text-xs leading-relaxed"
            style={{ background: "var(--bg-item)", color: "var(--text-subtle)" }}
          >
            <p>
              <span className="font-semibold" style={{ color: "var(--text-muted)" }}>동기화</span>란 Jira에서 해당 필터의 최신 이슈 목록을 가져와 KV에 저장하는 작업입니다.
              사용 중인 소스의 티켓은 key 기준으로 합쳐져 대시보드에 표시됩니다. 수집 중지는 설정과 이력을 보존하며, 삭제는 펼침 영역에서만 실행할 수 있습니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
