"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import type { Ticket } from "@/app/jira-tickets/TicketBoard";
import {
  getActionItems,
  type ActionItem,
  type RoleScheduleMin,
  type EtrInfoMin,
} from "@/lib/action-items";

type Props = {
  userEmail: string;
  userName: string;
};

// ── 상수 ─────────────────────────────────────────────────────────────────────
const DONE_STATUSES       = ["론치완료", "완료", "배포완료"];
const INPROGRESS_STATUSES = [
  "개발중", "QA", "진행중", "In Progress", "In Review",
  "디자인중", "개발 진행중", "개발완료", "검수중",
];
const JIRA_BASE      = "https://jira.team.musinsa.com/browse/";
const CRITICAL_LIMIT = 5;

// ── View Scope 타입 ───────────────────────────────────────────────────────────
// "어떤 관점으로 보는가" — lifecycle 탭과 동일한 개념적 레벨
type ViewScope = "mine" | "team" | "person";

// ── Severity Filter 타입 ─────────────────────────────────────────────────────
// "얼마나 긴급한가" — ViewScope와 직교하는 별도 축
type SeverityFilter = "all" | "critical" | "warning" | "followup";

// ── Tier ─────────────────────────────────────────────────────────────────────
type Tier = "critical" | "warning" | "followup";

// ── 색상 시스템 (메인 대시보드와 통일) ──────────────────────────────────────
const LEVEL_STYLE: Record<ActionItem["level"], { bg: string; border: string; color: string; dot: string }> = {
  critical: { bg: "rgba(239,68,68,0.09)",   border: "rgba(248,113,113,0.62)", color: "#f87171", dot: "#ef4444" },
  warning:  { bg: "rgba(245,158,11,0.08)",  border: "rgba(251,191,36,0.42)",  color: "#fbbf24", dot: "#f59e0b" },
  info:     { bg: "rgba(100,116,139,0.04)", border: "rgba(100,116,139,0.18)", color: "#94a3b8", dot: "#64748b" },
};

const TIER_META: Record<Tier, {
  label: string; icon: string; color: string;
  bg: string; border: string; leftBorder: string; description: string;
}> = {
  critical: {
    label: "즉시 대응", icon: "🚨", color: "#f87171",
    bg: "rgba(239,68,68,0.05)", border: "rgba(248,113,113,0.22)", leftBorder: "#ef4444",
    description: "ETA 초과 · 플래닝 검토 확인 등 즉각 조치가 필요한 과제",
  },
  warning: {
    label: "진행 중 관리", icon: "⚠", color: "#fbbf24",
    bg: "rgba(245,158,11,0.04)", border: "rgba(251,191,36,0.20)", leftBorder: "#f59e0b",
    description: "Launch 미정 · 일정 미입력 · 플래닝 검토 중 과제",
  },
  followup: {
    label: "보완 필요", icon: "📋", color: "#94a3b8",
    bg: "rgba(100,116,139,0.03)", border: "rgba(100,116,139,0.14)", leftBorder: "#64748b",
    description: "ETR · 문서 연결 등 참고 수준 보완 과제",
  },
};

// ── Deep-link ─────────────────────────────────────────────────────────────────
// tab: detail panel 탭, focus: 해당 탭 내 자동 스크롤 대상 섹션
const ACTION_TAB: Record<string, "ops" | "overview"> = {
  "overdue":            "ops",
  "review-needed":      "ops",
  "no-schedule":        "ops",
  "no-launch":          "ops",
  "planning-reviewing": "ops",
  "no-etr":             "overview",
  "no-docs":            "overview",
};
const ACTION_FOCUS: Record<string, string> = {
  "overdue":            "schedule",   // ops 탭 > Schedule 섹션
  "review-needed":      "planning",   // ops 탭 > 플래닝 상태 섹션
  "no-schedule":        "schedule",   // ops 탭 > Schedule 섹션
  "no-launch":          "schedule",   // ops 탭 > Schedule 섹션 (Launch row)
  "planning-reviewing": "planning",   // ops 탭 > 플래닝 상태 섹션
  "no-etr":             "etr",        // overview 탭 > 요구사항 출처 섹션
  "no-docs":            "docs",       // overview 탭 > 관련 문서 섹션
};
/**
 * 담당자 대시보드 → 전체 과제 현황 deep-link URL 생성.
 *
 * ptab 정책: 항상 "전체" 사용.
 *   - action item은 lifecycle 탭과 무관한 attention 상태이므로
 *     특정 탭으로 보내면 해당 티켓이 안 보일 수 있음.
 *   - "전체" 탭은 모든 non-done 티켓을 포함하므로 ticket visibility 보장.
 *
 * ticket.key 누락 시: console.warn + "/" fallback (broken URL 방지).
 */
function getDeepLink(ticket: Ticket, actionId: string): string {
  // ticketKey 안전 추출 — key가 없으면 broken URL 생성 방지
  const ticketKey = ticket?.key;
  if (!ticketKey) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[OwnerDashboard] getDeepLink: ticket.key missing", ticket);
    }
    return "/";
  }

  const tab   = ACTION_TAB[actionId]   ?? "overview";
  const focus = ACTION_FOCUS[actionId] ?? "";
  // ptab은 항상 "전체" — ticket visibility 최우선
  const ptab  = "전체";

  const href = (
    `/?ticket=${encodeURIComponent(ticketKey)}` +
    `&ptab=${encodeURIComponent(ptab)}` +
    `&tab=${tab}` +
    (focus ? `&focus=${focus}` : "") +
    `&source=owner_dashboard` +
    `&mode=focus`
  );

  if (process.env.NODE_ENV === "development") {
    console.debug("[OwnerDashboard] deepLink", {
      ticketKey,
      href,
      tab,
      focus,
      ptab,
      actionId,
    });
  }

  return href;
}

// ── 행동 유도형 텍스트 ────────────────────────────────────────────────────────
const ACTION_TEXT: Record<string, string> = {
  "overdue":            "ETA 경과 — 일정을 재조율하거나 상태를 업데이트해주세요",
  "review-needed":      "플래닝 검토 확인 — 담당 PM이 직접 확인·해제해야 합니다",
  "no-schedule":        "세부 작업 일정을 입력해주세요",
  "no-launch":          "Launch / Release 일정을 지정해주세요",
  "planning-reviewing": "팀 플래닝 검토 중 — 완료를 독려하거나 상태를 확인하세요",
  "no-etr":             "ETR 티켓을 연결해 요구사항 출처를 남겨주세요",
  "no-docs":            "PRD 또는 관련 문서를 연결해주세요",
};

// ── Priority Score Engine ─────────────────────────────────────────────────────
function daysUntil(etaStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const eta   = new Date(etaStr); eta.setHours(0, 0, 0, 0);
  return Math.round((eta.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function calcScore(ticket: Ticket, actions: ActionItem[]): number {
  const ids = new Set(actions.map(a => a.id));
  let s = 0;
  if (ids.has("overdue") && ticket.eta) {
    s += 100 + Math.min(Math.abs(daysUntil(ticket.eta)) * 4, 40);
  }
  if (!ids.has("overdue") && ticket.eta && ticket.eta !== "-") {
    const rem = daysUntil(ticket.eta);
    if (rem <= 3) s += 70; else if (rem <= 7) s += 35;
  }
  if (ids.has("review-needed"))                        s += 50;
  if (INPROGRESS_STATUSES.includes(ticket.status))     s += 40;
  if (ids.has("no-launch"))                            s += 40;
  if (ids.has("no-schedule"))                          s += 30;
  if (ids.has("planning-reviewing"))                   s += 20;
  if (ids.has("no-etr"))                               s +=  8;
  if (ids.has("no-docs"))                              s +=  5;
  if (["SUGGESTED", "Backlog"].includes(ticket.status)) s -= 20;
  return Math.max(s, 0);
}

function toTier(score: number): Tier {
  if (score >= 80) return "critical";
  if (score >= 40) return "warning";
  return "followup";
}

function getReasons(ticket: Ticket, actions: ActionItem[]): string[] {
  const ids = new Set(actions.map(a => a.id));
  const r: string[] = [];
  if (ids.has("overdue") && ticket.eta)             r.push(`ETA ${Math.abs(daysUntil(ticket.eta))}일 경과`);
  else if (ticket.eta && ticket.eta !== "-") {
    const rem = daysUntil(ticket.eta);
    if (rem <= 7) r.push(`ETA ${rem}일 남음`);
  }
  if (ids.has("review-needed"))                    r.push("검토 확인 필요");
  if (INPROGRESS_STATUSES.includes(ticket.status)) r.push("진행중");
  if (ids.has("no-launch"))                        r.push("Launch 미정");
  if (ids.has("no-schedule"))                      r.push("일정 미입력");
  if (ids.has("planning-reviewing"))               r.push("검토 진행중");
  return r.slice(0, 3);
}

// ── Active Filter Summary 문자열 ─────────────────────────────────────────────
function buildScopeSummary(
  viewScope: ViewScope,
  personFilter: string | null,
  severityFilter: SeverityFilter,
  myFirstName: string,
): string {
  const scopeLabel =
    viewScope === "mine"   ? `내 액션 (${myFirstName})` :
    viewScope === "team"   ? "전체 팀" :
    personFilter           ? `담당자 — ${personFilter}` : "담당자 선택 필요";
  const sevLabel =
    severityFilter === "all"      ? "" :
    severityFilter === "critical" ? " · 🚨 Critical" :
    severityFilter === "warning"  ? " · ⚠ Warning" :
                                    " · 📋 Follow-up";
  return scopeLabel + sevLabel;
}

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────
export default function OwnerDashboard({ userEmail, userName }: Props) {
  const [tickets,    setTickets]    = useState<Ticket[]>([]);
  const [planning,   setPlanning]   = useState<Record<string, unknown>>({});
  const [schedules,  setSchedules]  = useState<Record<string, RoleScheduleMin[]>>({});
  const [etrMap,     setEtrMap]     = useState<Record<string, EtrInfoMin>>({});
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  // ── 3-layer filter state ───────────────────────────────────────────────────
  /** 1. View Scope: 어떤 관점으로 볼 것인가 */
  const [viewScope,      setViewScope]      = useState<ViewScope>("mine");
  /** 2. Person Filter: "담당자별" scope에서 누구를 볼 것인가 */
  const [personFilter,   setPersonFilter]   = useState<string | null>(null);
  /** 3. Severity Filter: 얼마나 긴급한 과제를 볼 것인가 */
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");

  const [expandedTickets,  setExpandedTickets]  = useState<Set<string>>(new Set());
  const [criticalShowAll,  setCriticalShowAll]  = useState(false);
  const [followupExpanded, setFollowupExpanded] = useState(false);

  // ── 데이터 로드 ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [tRes, kvRes] = await Promise.all([
        fetch("/api/jira-tickets"),
        fetch("/api/kv?keys=cc-planning,cc-schedules,cc-etr,cc-hidden-keys"),
      ]);
      if (!tRes.ok) throw new Error("티켓 데이터 로드 실패");
      const [tData, kvData] = await Promise.all([tRes.json(), kvRes.json()]);
      if (tData.tickets)          setTickets(tData.tickets);
      if (kvData["cc-planning"])  setPlanning(kvData["cc-planning"]);
      if (kvData["cc-schedules"]) setSchedules(kvData["cc-schedules"]);
      if (kvData["cc-etr"])       setEtrMap(kvData["cc-etr"]);
      const rawHidden: string[] = Array.isArray(kvData["cc-hidden-keys"]) ? kvData["cc-hidden-keys"] : [];
      setHiddenKeys(new Set(rawHidden));
    } catch (e) {
      setError(e instanceof Error ? e.message : "데이터 로드 오류");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── 기본 데이터 가공 (hidden / 완료 / ETR 제외) ─────────────────────────
  const activeTickets = useMemo(
    () => tickets.filter(t =>
      !DONE_STATUSES.includes(t.status) &&
      !t.key.startsWith("ETR-") &&
      !hiddenKeys.has(t.key)
    ),
    [tickets, hiddenKeys]
  );

  const allAssignees = useMemo(() => {
    const set = new Set(activeTickets.map(t => t.assignee).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [activeTickets]);

  const ticketActions = useMemo(() =>
    activeTickets
      .map(t => ({
        ticket:  t,
        actions: getActionItems(t, planning[t.key], schedules[t.key] ?? [], etrMap[t.key]),
      }))
      .filter(x => x.actions.length > 0),
    [activeTickets, planning, schedules, etrMap]
  );

  // ── "내 액션" 매칭 ─────────────────────────────────────────────────────────
  const myNameCandidates = useMemo(() => {
    const candidates = new Set<string>();
    if (userName && userName !== "알 수 없음") candidates.add(userName);
    const emailPrefix = userEmail.split("@")[0].replace(/\./g, "");
    if (emailPrefix) candidates.add(emailPrefix);
    return candidates;
  }, [userName, userEmail]);

  function isMyTicket(assignee: string): boolean {
    if (myNameCandidates.has(assignee)) return true;
    for (const c of myNameCandidates) {
      if (assignee.toLowerCase().includes(c.toLowerCase()) ||
          c.toLowerCase().includes(assignee.toLowerCase())) return true;
    }
    return false;
  }

  const myFirstName = userName.split(" ")[0] || userName;

  // ── View Scope 변경 helper ─────────────────────────────────────────────────
  function changeScope(scope: ViewScope, person?: string) {
    setViewScope(scope);
    setPersonFilter(scope === "person" ? (person ?? personFilter) : null);
    setCriticalShowAll(false);
  }

  // ── Score + Filter 계산 ──────────────────────────────────────────────────
  const scoredFiltered = useMemo(() => {
    let result = ticketActions;

    // Layer 1: View Scope
    if (viewScope === "mine") {
      result = result.filter(x => isMyTicket(x.ticket.assignee));
    } else if (viewScope === "person" && personFilter) {
      result = result.filter(x => x.ticket.assignee === personFilter);
    }
    // viewScope === "team" → 전체, 필터 없음

    // Layer 2: Severity Filter
    if (severityFilter === "critical") {
      result = result.filter(x => x.actions.some(a => a.level === "critical"));
    } else if (severityFilter === "warning") {
      result = result.filter(x => x.actions.some(a => a.level === "warning"));
    } else if (severityFilter === "followup") {
      result = result.filter(x =>
        !x.actions.some(a => a.level === "critical" || a.level === "warning")
      );
    }

    // Score 계산 + 정렬
    return result.map(x => {
      const score   = calcScore(x.ticket, x.actions);
      const tier    = toTier(score);
      const reasons = getReasons(x.ticket, x.actions);
      return { ...x, score, tier, reasons };
    }).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aOvd = a.actions.some(ac => ac.id === "overdue");
      const bOvd = b.actions.some(ac => ac.id === "overdue");
      if (aOvd !== bOvd) return bOvd ? 1 : -1;
      const aEta = a.ticket.eta ?? "9999";
      const bEta = b.ticket.eta ?? "9999";
      if (aEta !== bEta) return aEta < bEta ? -1 : 1;
      const aRev = a.actions.some(ac => ac.id === "review-needed");
      const bRev = b.actions.some(ac => ac.id === "review-needed");
      if (aRev !== bRev) return bRev ? 1 : -1;
      return 0;
    });
  }, [ticketActions, viewScope, personFilter, severityFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const tierGroups = useMemo(() => ({
    critical: scoredFiltered.filter(x => x.tier === "critical"),
    warning:  scoredFiltered.filter(x => x.tier === "warning"),
    followup: scoredFiltered.filter(x => x.tier === "followup"),
  }), [scoredFiltered]);

  // ── KPI (현재 scope + filter 기준) ──────────────────────────────────────
  const kpis = useMemo(() => ({
    overdue:      scoredFiltered.filter(x => x.actions.some(a => a.id === "overdue")).length,
    reviewNeeded: scoredFiltered.filter(x => x.actions.some(a => a.id === "review-needed")).length,
    noSchedule:   scoredFiltered.filter(x => x.actions.some(a => a.id === "no-schedule")).length,
    noLaunch:     scoredFiltered.filter(x => x.actions.some(a => a.id === "no-launch")).length,
    planReview:   scoredFiltered.filter(x => x.actions.some(a => a.id === "planning-reviewing")).length,
  }), [scoredFiltered]);

  // ── 담당자별 워크로드 (viewScope === "team" 시만 표시) ──────────────────
  const workloadByAssignee = useMemo(() => {
    if (viewScope !== "team") return null;
    const map: Record<string, { critical: number; warning: number; followup: number }> = {};
    // 워크로드는 severity filter 무관하게 전체 팀 기준으로 집계
    for (const x of ticketActions) {
      const name = x.ticket.assignee || "미지정";
      if (!map[name]) map[name] = { critical: 0, warning: 0, followup: 0 };
      const score = calcScore(x.ticket, x.actions);
      map[name][toTier(score)]++;
    }
    return Object.entries(map)
      .sort((a, b) => (b[1].critical - a[1].critical) || (b[1].warning - a[1].warning))
      .slice(0, 10);
  }, [ticketActions, viewScope]);

  function toggleExpand(key: string) {
    setExpandedTickets(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // scope/filter 변경 시 collapse 초기화
  useEffect(() => {
    setCriticalShowAll(false);
    setFollowupExpanded(false);
  }, [viewScope, personFilter, severityFilter]);

  // Active Filter Summary
  const scopeSummary = buildScopeSummary(viewScope, personFilter, severityFilter, myFirstName);

  // ── 로딩 ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: "var(--bg-canvas)" }}>
        <div className="flex flex-col items-center gap-3">
          <svg className="w-6 h-6 animate-spin" style={{ color: "#818cf8" }} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>데이터 불러오는 중…</p>
        </div>
      </div>
    );
  }

  // ── 렌더 ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen px-6 py-7 max-w-5xl mx-auto"
      style={{ background: "var(--bg-canvas)", color: "var(--text-primary)" }}>

      {/* ── 헤더 ── */}
      <div className="flex items-start justify-between mb-4">
        <div>
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 mb-1">
            <Link href="/" className="text-xs transition-colors" style={{ color: "var(--text-subtle)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--text-muted)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--text-subtle)")}
            >전체 과제 현황</Link>
            <span className="text-xs" style={{ color: "var(--text-subtle)" }}>›</span>
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>담당자 대시보드</span>
          </div>
          {/* Title + Beta badge */}
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Operational Priority Queue</h1>
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full leading-none"
              style={{
                background: "rgba(139,92,246,0.10)",
                color: "#a78bfa",
                border: "1px solid rgba(139,92,246,0.22)",
                letterSpacing: "0.04em",
              }}
            >
              Beta
            </span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            우선순위 점수 기준 — 지금 가장 중요한 과제부터 처리하세요
            <span className="ml-2 opacity-50">· 숨김/완료/ETR 제외</span>
          </p>
        </div>
        <button onClick={load}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border shrink-0"
          style={{ background: "var(--bg-overlay)", borderColor: "var(--border-2)", color: "var(--text-muted)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#818cf8"; (e.currentTarget as HTMLElement).style.color = "#818cf8"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-2)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}>
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          새로고침
        </button>
      </div>

      {/* ── Onboarding helper — Beta 기능 안내 배너 ── */}
      <div
        className="flex items-start gap-3 px-3.5 py-2.5 rounded-xl mb-4"
        style={{
          background: "rgba(139,92,246,0.05)",
          border: "1px solid rgba(139,92,246,0.15)",
        }}
      >
        <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2">
          <path d="M9 3h6M9 3v8l-4.5 9.5A1 1 0 005.4 22h13.2a1 1 0 00.9-1.5L15 11V3"/>
        </svg>
        <div className="min-w-0">
          <p className="text-[11px] font-medium mb-0.5" style={{ color: "#a78bfa" }}>
            실험적 기능 — 지속 고도화 중
          </p>
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
            ETA · 플래닝 · 일정 입력 상태를 분석해 지금 처리 우선순위가 높은 과제와 필요한 액션을 보여줍니다.
            우선순위 점수(0–140+)는 ETA 경과, 검토 확인, Launch 미정 여부 등을 기준으로 자동 계산됩니다.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg text-sm"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171" }}>
          {error}
        </div>
      )}

      {/* ── KPI 카드 ── */}
      <div className="grid grid-cols-5 gap-2.5 mb-2.5">
        {[
          { label: "ETA 경과",    count: kpis.overdue,      color: "#f87171", bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.22)"  },
          { label: "검토 확인",   count: kpis.reviewNeeded, color: "#fbbf24", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.22)" },
          { label: "일정 미입력", count: kpis.noSchedule,   color: "#fb923c", bg: "rgba(251,146,60,0.08)", border: "rgba(251,146,60,0.22)" },
          { label: "Launch 미정", count: kpis.noLaunch,     color: "#818cf8", bg: "rgba(99,102,241,0.08)", border: "rgba(99,102,241,0.22)" },
          { label: "플래닝 진행", count: kpis.planReview,   color: "#60a5fa", bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.22)" },
        ].map(kpi => (
          <div key={kpi.label} className="rounded-xl border px-3.5 py-2.5"
            style={{ background: kpi.count > 0 ? kpi.bg : "var(--bg-overlay)", borderColor: kpi.count > 0 ? kpi.border : "var(--border)" }}>
            <p className="text-[10px] mb-1 font-medium" style={{ color: "var(--text-muted)" }}>{kpi.label}</p>
            <p className="text-[22px] font-bold leading-none" style={{ color: kpi.count > 0 ? kpi.color : "var(--text-subtle)" }}>
              {kpi.count}
            </p>
          </div>
        ))}
      </div>

      {/* ── Active Filter Summary ── */}
      <div className="flex items-center gap-2 mb-5">
        <span className="text-[11px] px-2.5 py-1 rounded-lg font-medium"
          style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", color: "var(--text-muted)" }}>
          {scopeSummary}
        </span>
        <span className="text-[10px]" style={{ color: "var(--text-subtle)" }}>
          {scoredFiltered.length}건 표시 중 / 전체 {activeTickets.length}개 과제
        </span>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          필터 패널
          Layer 1: View Scope | Layer 2: Person (담당자별 시) | Layer 3: Severity
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border mb-5 overflow-hidden"
        style={{ borderColor: "var(--border)", background: "var(--bg-overlay)" }}>

        {/* ── Layer 1: View Scope ── */}
        <div className="px-4 pt-3.5 pb-2.5 border-b" style={{ borderColor: "var(--border)" }}>
          <p className="text-[10px] font-semibold mb-2 uppercase tracking-wide"
            style={{ color: "var(--text-subtle)" }}>View Scope</p>
          <div className="flex gap-2">
            {([
              {
                scope: "mine" as ViewScope,
                label: "내 액션",
                desc:  `${myFirstName}의 처리 항목`,
                icon:  "👤",
                activeColor: "#818cf8", activeBg: "rgba(129,140,248,0.15)", activeBorder: "rgba(129,140,248,0.5)",
              },
              {
                scope: "team" as ViewScope,
                label: "전체 팀",
                desc:  "팀 전체 운영 현황",
                icon:  "👥",
                activeColor: "#34d399", activeBg: "rgba(52,211,153,0.12)", activeBorder: "rgba(52,211,153,0.45)",
              },
              {
                scope: "person" as ViewScope,
                label: "담당자별",
                desc:  "특정 담당자 Queue",
                icon:  "🔍",
                activeColor: "#fbbf24", activeBg: "rgba(245,158,11,0.12)", activeBorder: "rgba(251,191,36,0.45)",
              },
            ] as const).map(opt => {
              const isActive = viewScope === opt.scope;
              return (
                <button key={opt.scope}
                  onClick={() => changeScope(opt.scope)}
                  title={opt.desc}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all border"
                  style={{
                    background:  isActive ? opt.activeBg   : "var(--bg-canvas)",
                    borderColor: isActive ? opt.activeBorder : "var(--border-2)",
                    color:       isActive ? opt.activeColor : "var(--text-muted)",
                  }}>
                  <span>{opt.icon}</span>
                  {opt.label}
                  {opt.scope === "person" && viewScope === "person" && personFilter && (
                    <span className="ml-0.5 text-[10px] opacity-80">— {personFilter}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Layer 2: Person Filter (담당자별 scope일 때만 표시) ── */}
        {viewScope === "person" && (
          <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
            <p className="text-[10px] font-semibold mb-2 uppercase tracking-wide"
              style={{ color: "var(--text-subtle)" }}>담당자 선택</p>
            <div className="flex flex-wrap gap-1.5">
              {allAssignees.map(name => {
                const isActive = personFilter === name;
                return (
                  <button key={name}
                    onClick={() => { setViewScope("person"); setPersonFilter(name); setCriticalShowAll(false); }}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all border"
                    style={{
                      background:  isActive ? "rgba(245,158,11,0.15)" : "var(--bg-canvas)",
                      borderColor: isActive ? "#f59e0b" : "var(--border-2)",
                      color:       isActive ? "#fbbf24" : "var(--text-muted)",
                      boxShadow:   isActive ? "0 0 0 1px #f59e0b40" : "none",
                      fontWeight:  isActive ? "700" : "500",
                    }}>
                    {isActive && <span className="mr-0.5">✓</span>}
                    {name}
                  </button>
                );
              })}
              {allAssignees.length === 0 && (
                <span className="text-xs" style={{ color: "var(--text-subtle)" }}>담당자 정보 없음</span>
              )}
            </div>
          </div>
        )}

        {/* ── Layer 3: Severity Filter ── */}
        <div className="px-4 py-2.5">
          <p className="text-[10px] font-semibold mb-2 uppercase tracking-wide"
            style={{ color: "var(--text-subtle)" }}>Severity</p>
          <div className="flex gap-1.5 flex-wrap">
            {([
              { key: "all" as SeverityFilter,      label: "전체",        icon: "·",  activeColor: "var(--text-secondary)", activeBg: "var(--bg-canvas)", activeBorder: "var(--border-2)" },
              { key: "critical" as SeverityFilter,  label: "Critical",    icon: "🚨", activeColor: "#f87171", activeBg: "rgba(239,68,68,0.12)",   activeBorder: "rgba(248,113,113,0.5)" },
              { key: "warning" as SeverityFilter,   label: "Warning",     icon: "⚠", activeColor: "#fbbf24", activeBg: "rgba(245,158,11,0.12)",  activeBorder: "rgba(251,191,36,0.5)" },
              { key: "followup" as SeverityFilter,  label: "Follow-up",   icon: "📋", activeColor: "#94a3b8", activeBg: "rgba(100,116,139,0.12)", activeBorder: "rgba(100,116,139,0.4)" },
            ] as const).map(opt => {
              const isActive = severityFilter === opt.key;
              // tier별 건수 표시
              const count =
                opt.key === "all"      ? scoredFiltered.length :
                opt.key === "critical" ? tierGroups.critical.length :
                opt.key === "warning"  ? tierGroups.warning.length  :
                                         tierGroups.followup.length;
              return (
                <button key={opt.key}
                  onClick={() => setSeverityFilter(opt.key)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border"
                  style={{
                    background:  isActive ? opt.activeBg     : "var(--bg-canvas)",
                    borderColor: isActive ? opt.activeBorder : "var(--border-2)",
                    color:       isActive ? opt.activeColor  : "var(--text-muted)",
                  }}>
                  <span>{opt.icon}</span>
                  {opt.label}
                  <span className="ml-0.5 text-[10px] opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── 담당자별 워크로드 (전체 팀 view) ── */}
      {workloadByAssignee && workloadByAssignee.length > 0 && (
        <div className="mb-5 rounded-xl border px-4 py-3" style={{ background: "var(--bg-overlay)", borderColor: "var(--border)" }}>
          <p className="text-[11px] font-semibold mb-2.5" style={{ color: "var(--text-muted)" }}>
            팀 워크로드
            <span className="ml-1.5 font-normal opacity-60">클릭 시 담당자별 view로 전환</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {workloadByAssignee.map(([name, counts]) => {
              const isOverloaded = counts.critical >= 3;
              const isSelected   = viewScope === "person" && personFilter === name;
              return (
                <button key={name}
                  onClick={() => changeScope("person", name)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all"
                  style={{
                    background:  isSelected   ? "rgba(245,158,11,0.12)" :
                                 isOverloaded ? "rgba(239,68,68,0.05)"  : "var(--bg-canvas)",
                    borderColor: isSelected   ? "#f59e0b" :
                                 isOverloaded ? "rgba(248,113,113,0.35)" : "var(--border-2)",
                    color:       "var(--text-secondary)",
                    boxShadow:   isSelected ? "0 0 0 1px #f59e0b40" : "none",
                  }}>
                  {isSelected && <span className="text-[10px]" style={{ color: "#fbbf24" }}>✓</span>}
                  <span className="text-xs font-medium">{name}</span>
                  {counts.critical > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                      style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}>
                      🚨 {counts.critical}
                    </span>
                  )}
                  {counts.warning > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                      style={{ background: "rgba(245,158,11,0.12)", color: "#fbbf24" }}>
                      ⚠ {counts.warning}
                    </span>
                  )}
                  {counts.followup > 0 && (
                    <span className="text-[10px]" style={{ color: "var(--text-subtle)" }}>
                      📋 {counts.followup}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 빈 상태 ── */}
      {scoredFiltered.length === 0 ? (
        <div className="py-14 text-center rounded-xl border" style={{ background: "var(--bg-overlay)", borderColor: "var(--border)" }}>
          <svg className="w-7 h-7 mx-auto mb-2.5 opacity-25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/>
          </svg>
          <p className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>처리가 필요한 액션이 없습니다</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-subtle)" }}>
            {viewScope === "person" && !personFilter
              ? "담당자를 선택해주세요"
              : "필터를 변경하거나 새로고침해주세요"}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {(["critical", "warning", "followup"] as Tier[]).map(tier => {
            const allItems   = tierGroups[tier];
            if (allItems.length === 0) return null;

            const meta       = TIER_META[tier];
            const isCritical = tier === "critical";
            const isFollowup = tier === "followup";

            const visibleItems = isCritical && !criticalShowAll
              ? allItems.slice(0, CRITICAL_LIMIT) : allItems;
            const hiddenCount  = isCritical && !criticalShowAll
              ? Math.max(0, allItems.length - CRITICAL_LIMIT) : 0;
            const isOpen = !isFollowup || followupExpanded;

            return (
              <div key={tier}>
                {/* 섹션 헤더 */}
                <button
                  className={`w-full flex items-center justify-between mb-2 py-0.5 ${isFollowup ? "cursor-pointer" : "cursor-default"}`}
                  onClick={() => isFollowup && setFollowupExpanded(v => !v)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm leading-none">{meta.icon}</span>
                    <span className="text-sm font-semibold" style={{ color: meta.color }}>{meta.label}</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: meta.bg, border: `1px solid ${meta.border}`, color: meta.color }}>
                      {allItems.length}건
                    </span>
                    <span className="text-[11px] hidden sm:inline" style={{ color: "var(--text-subtle)" }}>
                      {meta.description}
                    </span>
                  </div>
                  {isFollowup && (
                    <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
                      {followupExpanded ? "접기 ▲" : "펼치기 ▼"}
                    </span>
                  )}
                </button>

                {isOpen && (
                  <>
                    <div className="space-y-1.5">
                      {visibleItems.map(({ ticket, actions, score, reasons }) => {
                        const topAction  = actions[0];
                        const lvlStyle   = LEVEL_STYLE[topAction.level];
                        const isExpanded = expandedTickets.has(ticket.key);
                        const extraCount = actions.length - 1;
                        const actionText = ACTION_TEXT[topAction.id] ?? topAction.label;
                        const deepLink   = getDeepLink(ticket, topAction.id);

                        return (
                          <div key={ticket.key}
                            className="rounded-xl border transition-all"
                            title={`Priority Score: ${score}`}
                            style={{
                              background:  "var(--bg-overlay)",
                              borderColor: "var(--border)",
                              borderLeft:  `3px solid ${meta.leftBorder}`,
                            }}
                          >
                            <div className="flex items-start gap-2.5 px-3.5 py-2.5">
                              <a href={`${JIRA_BASE}${ticket.key}`} target="_blank" rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="font-mono text-[11px] font-semibold shrink-0 hover:underline"
                                style={{ color: "#60a5fa", paddingTop: "1px" }}>
                                {ticket.key}
                              </a>
                              <div className="flex-1 min-w-0">
                                <Link href={deepLink}
                                  className="text-[13px] font-medium leading-snug block truncate hover:underline"
                                  style={{ color: "var(--text-primary)" }}>
                                  {ticket.summary}
                                </Link>
                                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                                    {ticket.assignee}
                                  </span>
                                  {ticket.status && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                      style={{ background: "var(--bg-canvas)", color: "var(--text-subtle)", border: "1px solid var(--border-2)" }}>
                                      {ticket.status}
                                    </span>
                                  )}
                                  {reasons.map(r => (
                                    <span key={r} className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                                      style={{ background: meta.bg, border: `1px solid ${meta.border}`, color: meta.color }}>
                                      {r}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0 max-w-[195px]">
                                <Link href={deepLink}
                                  className="inline-flex items-start gap-1 px-2 py-1 rounded-lg text-[11px] font-medium leading-snug text-right hover:opacity-80 transition-opacity"
                                  style={{ background: lvlStyle.bg, border: `1px solid ${lvlStyle.border}`, color: lvlStyle.color }}>
                                  <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-[3px]" style={{ background: lvlStyle.dot }} />
                                  {actionText}
                                </Link>
                                {extraCount > 0 && (
                                  <button onClick={() => toggleExpand(ticket.key)}
                                    className="text-[10px] transition-colors"
                                    style={{ color: isExpanded ? "#818cf8" : "var(--text-subtle)" }}>
                                    {isExpanded ? "접기 ▲" : `+${extraCount}개 더 ▼`}
                                  </button>
                                )}
                              </div>
                            </div>
                            {isExpanded && extraCount > 0 && (
                              <div className="px-3.5 pb-2.5 pt-1 space-y-1 border-t" style={{ borderColor: "var(--border)" }}>
                                {actions.slice(1).map(action => {
                                  const s = LEVEL_STYLE[action.level];
                                  return (
                                    <Link key={action.id} href={getDeepLink(ticket, action.id)}
                                      className="flex items-start gap-1.5 hover:opacity-75 transition-opacity">
                                      <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1" style={{ background: s.dot }} />
                                      <span className="text-[11px] leading-snug" style={{ color: s.color }}>
                                        {ACTION_TEXT[action.id] ?? action.label}
                                      </span>
                                    </Link>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {isCritical && hiddenCount > 0 && (
                      <button onClick={() => setCriticalShowAll(true)}
                        className="w-full mt-1.5 py-1.5 rounded-xl text-xs font-medium border transition-all"
                        style={{ background: "var(--bg-overlay)", borderColor: "var(--border-2)", color: "var(--text-muted)" }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "#f87171"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "var(--border-2)"}>
                        🚨 나머지 {hiddenCount}건 더 보기 ▼
                      </button>
                    )}
                    {isCritical && criticalShowAll && allItems.length > CRITICAL_LIMIT && (
                      <button onClick={() => setCriticalShowAll(false)}
                        className="w-full mt-1.5 py-1.5 rounded-xl text-xs font-medium border transition-all"
                        style={{ background: "var(--bg-overlay)", borderColor: "var(--border-2)", color: "var(--text-subtle)" }}>
                        접기 ▲
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── 하단 요약 ── */}
      <div className="mt-8 pt-4 border-t text-center" style={{ borderColor: "var(--border)" }}>
        <p className="text-xs" style={{ color: "var(--text-subtle)" }}>
          전체 {activeTickets.length}개 과제 기준 · 숨김/완료/ETR 제외
          {" · "}
          <button onClick={load} className="hover:underline" style={{ color: "var(--text-muted)" }}>새로고침</button>
        </p>
      </div>
    </div>
  );
}
