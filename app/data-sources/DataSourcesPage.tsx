"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  JiraFilter,
  FilterPreview,
  FilterTicketsStore,
  TicketSourcesStore,
} from "@/lib/filter-types";

// ── 운영 지표 계산 ─────────────────────────────────────────────────────────────

interface FilterStats {
  ticketCount: number;
  hiddenCount: number;
  removedCount: number;
  delta: number | null;
  removedKeys: string[];
}

function computeFilterStats(
  filter: JiraFilter,
  filterTickets: FilterTicketsStore,
  hiddenKeys: Set<string>,
  ticketSources: TicketSourcesStore,
): FilterStats {
  const currentKeys = new Set(filterTickets[filter.id] ?? []);
  const ticketCount = currentKeys.size;
  const hiddenCount = [...currentKeys].filter(k => hiddenKeys.has(k)).length;

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

  return { ticketCount, hiddenCount, removedCount: removedKeys.length, delta, removedKeys };
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

// ── 하위 컴포넌트: 상태 배지 ──────────────────────────────────────────────────

function SyncStatusBadge({ filter }: { filter: JiraFilter }) {
  if (filter.lastSyncError) {
    return (
      <span
        className="text-[10px] px-1.5 py-0.5 rounded font-medium"
        style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}
      >
        오류
      </span>
    );
  }
  if (filter.lastSyncAt) {
    return (
      <span
        className="text-[10px] px-1.5 py-0.5 rounded font-medium"
        style={{ background: "rgba(52,211,153,0.12)", color: "#34d399" }}
      >
        동기화됨
      </span>
    );
  }
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
      style={{ background: "rgba(148,163,184,0.1)", color: "var(--text-subtle)" }}
    >
      대기
    </span>
  );
}

// ── 하위 컴포넌트: 필터 카드 ──────────────────────────────────────────────────

function FilterCard({
  filter,
  onSync,
  onDelete,
  syncing,
  stats,
}: {
  filter: JiraFilter;
  onSync: (id: string) => void;
  onDelete: (id: string) => void;
  syncing: boolean;
  stats: FilterStats | null;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const displayName = filter.label ?? filter.name;

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      {/* 헤더 */}
      <div className="flex items-start gap-3">
        {/* 필터 아이콘 */}
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: "rgba(99,102,241,0.12)" }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              {displayName}
            </h3>
            {filter.label && filter.label !== filter.name && (
              <span className="text-[10px]" style={{ color: "var(--text-subtle)" }}>
                {filter.name}
              </span>
            )}
            <SyncStatusBadge filter={filter} />
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <a
              href={`https://musinsa-oneteam.atlassian.net/issues/?filter=${filter.jiraFilterId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] hover:underline"
              style={{ color: "#818cf8" }}
            >
              Filter #{filter.jiraFilterId}
            </a>
            <span style={{ color: "var(--text-subtle)" }}>·</span>
            <span className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
              등록 {formatDate(filter.createdAt)}
            </span>
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onSync(filter.id)}
            disabled={syncing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: syncing ? "rgba(99,102,241,0.08)" : "rgba(99,102,241,0.12)",
              color: "#818cf8",
              border: "1px solid rgba(99,102,241,0.2)",
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

          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
              style={{ color: "var(--text-subtle)" }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.1)";
                (e.currentTarget as HTMLElement).style.color = "#f87171";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--text-subtle)";
              }}
              title="필터 삭제"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onDelete(filter.id)}
                className="px-2 py-1 rounded text-[10px] font-medium transition-all"
                style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}
              >
                삭제
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 rounded text-[10px] font-medium transition-all"
                style={{ background: "var(--bg-item)", color: "var(--text-muted)" }}
              >
                취소
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 운영 지표 stats row */}
      {stats !== null && (
        <div
          className="flex items-center gap-3 pt-2 text-[11px] flex-wrap"
          style={{ borderTop: "1px solid var(--border-2)", color: "var(--text-subtle)" }}
        >
          <span>
            티켓{" "}
            <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
              {stats.ticketCount.toLocaleString()}
            </span>
            개
          </span>
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
                제거 후보{" "}
                <span
                  className="px-1 py-0.5 rounded text-[10px]"
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

      {/* 제거 후보 패널 */}
      {showRemoved && stats !== null && stats.removedKeys.length > 0 && (
        <div
          className="rounded-lg px-3 py-2.5 flex flex-col gap-1.5"
          style={{ background: "rgba(251,146,60,0.06)", border: "1px solid rgba(251,146,60,0.18)" }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "#fb923c" }}>
            제거 후보 — 현재 필터 결과에 없는 티켓
          </p>
          <div className="flex flex-col gap-1">
            {stats.removedKeys.map(key => (
              <div key={key} className="flex items-center gap-2">
                <a
                  href={`https://musinsa-oneteam.atlassian.net/browse/${key}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-mono hover:underline"
                  style={{ color: "#fb923c" }}
                >
                  {key} ↗
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* JQL */}
      <div
        className="rounded-lg px-3 py-2 text-[11px] font-mono leading-relaxed overflow-x-auto"
        style={{ background: "var(--bg-item)", color: "var(--text-muted)" }}
      >
        {filter.jql}
      </div>

      {/* 동기화 메타 */}
      <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--text-subtle)" }}>
        <span>
          마지막 동기화: <span style={{ color: "var(--text-muted)" }}>{relativeTime(filter.lastSyncAt)}</span>
        </span>
        {filter.lastSyncCount != null && (
          <span>
            티켓 <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{filter.lastSyncCount.toLocaleString()}</span>개
          </span>
        )}
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

function AddFilterForm({ onAdded }: { onAdded: () => void }) {
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
        onAdded();
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
          <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text-muted)" }}>
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
            onFocus={e => { (e.target as HTMLElement).style.borderColor = "#6366f1"; }}
            onBlur={e => { (e.target as HTMLElement).style.borderColor = "var(--border-2)"; }}
          />
        </div>
        <div style={{ width: 180 }}>
          <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text-muted)" }}>
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
            onFocus={e => { (e.target as HTMLElement).style.borderColor = "#6366f1"; }}
            onBlur={e => { (e.target as HTMLElement).style.borderColor = "var(--border-2)"; }}
          />
        </div>
      </div>

      {/* 미리보기 */}
      {previewLoading && (
        <div className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
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
          style={{ background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.18)" }}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold" style={{ color: "#a5b4fc" }}>{preview.name}</span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}
            >
              {preview.estimatedCount.toLocaleString()}개
            </span>
          </div>
          <div className="text-[11px] font-mono" style={{ color: "var(--text-subtle)" }}>{preview.jql}</div>
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
            background: "rgba(99,102,241,0.85)",
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
  const [showAddForm, setShowAddForm] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // 운영 지표용 추가 KV 상태
  const [filterTickets, setFilterTickets] = useState<FilterTicketsStore>({});
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [ticketSources, setTicketSources] = useState<TicketSourcesStore>({});
  const [statsLoaded, setStatsLoaded] = useState(false);

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

  useEffect(() => {
    loadFilters();
    loadStats();
  }, [loadFilters, loadStats]);

  async function handleSync(id: string) {
    setSyncingId(id);
    try {
      const res = await fetch(`/api/jira-filters/${id}/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "동기화 실패", "error");
      } else {
        showToast(`동기화 완료 — 티켓 ${(data.ticketKeys as string[]).length.toLocaleString()}개`);
        await Promise.all([loadFilters(), loadStats()]);
      }
    } catch {
      showToast("네트워크 오류", "error");
    } finally {
      setSyncingId(null);
    }
  }

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

      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* 페이지 헤더 */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-lg font-bold mb-1" style={{ color: "var(--text-primary)" }}>
              데이터 소스
            </h1>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Jira Filter를 등록하고 동기화하면, 해당 필터의 티켓이 대시보드에 자동으로 반영됩니다.
            </p>
          </div>
          <button
            onClick={() => setShowAddForm(prev => !prev)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shrink-0"
            style={{
              background: showAddForm ? "var(--bg-item)" : "rgba(99,102,241,0.85)",
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
              onAdded={() => {
                setShowAddForm(false);
                loadFilters();
                showToast("필터가 등록되었습니다. 동기화 버튼을 눌러 티켓을 가져오세요.");
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
              style={{ background: "rgba(99,102,241,0.1)" }}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="1.8">
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
          <div className="flex flex-col gap-3">
            {filters.map(filter => (
              <FilterCard
                key={filter.id}
                filter={filter}
                onSync={handleSync}
                onDelete={handleDelete}
                syncing={syncingId === filter.id}
                stats={statsLoaded ? computeFilterStats(filter, filterTickets, hiddenKeys, ticketSources) : null}
              />
            ))}
          </div>
        )}

        {/* 안내 노트 */}
        {filters.length > 0 && (
          <div
            className="mt-6 rounded-xl px-4 py-3 text-[11px] leading-relaxed"
            style={{ background: "var(--bg-item)", color: "var(--text-subtle)" }}
          >
            <p>
              <span className="font-semibold" style={{ color: "var(--text-muted)" }}>동기화</span>란 Jira에서 해당 필터의 최신 이슈 목록을 가져와 KV에 저장하는 작업입니다.
              동기화한 티켓은 <span className="font-semibold">대시보드 티켓 보드에 자동 표시</span>됩니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
