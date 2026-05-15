"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import type { Ticket } from "@/app/jira-tickets/TicketBoard";
import { getActionItems, parsePlanningVal, type ActionItem, type RoleScheduleMin, type EtrInfoMin } from "@/lib/action-items";

type Props = {
  userEmail: string;
  userName: string;
};

const DONE_STATUSES = ["론치완료", "완료", "배포완료"];
const JIRA_BASE = "https://jira.team.musinsa.com/browse/";

// 액션 레벨별 스타일
const LEVEL_STYLE: Record<ActionItem["level"], { bg: string; border: string; color: string; dot: string }> = {
  critical: { bg: "rgba(239,68,68,0.1)",   border: "rgba(248,113,113,0.4)", color: "#f87171", dot: "#ef4444" },
  warning:  { bg: "rgba(245,158,11,0.1)",  border: "rgba(251,191,36,0.4)", color: "#fbbf24", dot: "#f59e0b" },
  info:     { bg: "rgba(99,102,241,0.08)", border: "rgba(129,140,248,0.3)", color: "#818cf8", dot: "#818cf8" },
};

export default function OwnerDashboard({ userEmail, userName }: Props) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [planning, setPlanning] = useState<Record<string, unknown>>({});
  const [schedules, setSchedules] = useState<Record<string, RoleScheduleMin[]>>({});
  const [etrMap, setEtrMap] = useState<Record<string, EtrInfoMin>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string>("mine");
  const [levelFilter, setLevelFilter] = useState<"all" | "critical" | "warning">("all");
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tRes, kvRes] = await Promise.all([
        fetch("/api/jira-tickets"),
        fetch("/api/kv?keys=cc-planning,cc-schedules,cc-etr"),
      ]);
      if (!tRes.ok) throw new Error("티켓 데이터 로드 실패");
      const [tData, kvData] = await Promise.all([tRes.json(), kvRes.json()]);
      if (tData.tickets) setTickets(tData.tickets);
      if (kvData["cc-planning"])  setPlanning(kvData["cc-planning"]);
      if (kvData["cc-schedules"]) setSchedules(kvData["cc-schedules"]);
      if (kvData["cc-etr"])       setEtrMap(kvData["cc-etr"]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "데이터 로드 오류");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 활성 티켓 (완료/ETR 제외)
  const activeTickets = useMemo(
    () => tickets.filter(t => !DONE_STATUSES.includes(t.status) && !t.key.startsWith("ETR-")),
    [tickets]
  );

  // 담당자 목록
  const allAssignees = useMemo(() => {
    const set = new Set(activeTickets.map(t => t.assignee).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [activeTickets]);

  // 티켓별 action items 계산
  const ticketActions = useMemo(() =>
    activeTickets
      .map(t => ({
        ticket: t,
        actions: getActionItems(t, planning[t.key], schedules[t.key] ?? [], etrMap[t.key]),
      }))
      .filter(x => x.actions.length > 0),
    [activeTickets, planning, schedules, etrMap]
  );

  // "내 담당" 매칭: userName or email prefix
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

  // 필터 적용
  const filteredActions = useMemo(() => {
    let result = ticketActions;
    if (assigneeFilter === "mine") {
      result = result.filter(x => isMyTicket(x.ticket.assignee));
    } else if (assigneeFilter !== "all") {
      result = result.filter(x => x.ticket.assignee === assigneeFilter);
    }
    if (levelFilter !== "all") {
      result = result.filter(x => x.actions.some(a => a.level === levelFilter));
    }
    // 최우선 action priority 오름차순 정렬
    return [...result].sort((a, b) => {
      const aMin = a.actions[0]?.priority ?? 99;
      const bMin = b.actions[0]?.priority ?? 99;
      return aMin - bMin;
    });
  }, [ticketActions, assigneeFilter, levelFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // KPI (전체 기준)
  const kpis = useMemo(() => ({
    overdue:      ticketActions.filter(x => x.actions.some(a => a.id === "overdue")).length,
    reviewNeeded: ticketActions.filter(x => x.actions.some(a => a.id === "review-needed")).length,
    noSchedule:   ticketActions.filter(x => x.actions.some(a => a.id === "no-schedule")).length,
    noLaunch:     ticketActions.filter(x => x.actions.some(a => a.id === "no-launch")).length,
    planReview:   ticketActions.filter(x => x.actions.some(a => a.id === "planning-reviewing")).length,
  }), [ticketActions]);

  function toggleExpand(key: string) {
    setExpandedTickets(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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

  return (
    <div className="min-h-screen px-6 py-8 max-w-5xl mx-auto" style={{ background: "var(--bg-canvas)", color: "var(--text-primary)" }}>

      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/" className="text-xs transition-colors" style={{ color: "var(--text-subtle)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--text-muted)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--text-subtle)")}
            >전체 과제 현황</Link>
            <span className="text-xs" style={{ color: "var(--text-subtle)" }}>›</span>
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>담당자 대시보드</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold ml-1"
              style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" }}>
              실험적
            </span>
          </div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>담당자 대시보드</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
            지금 처리가 필요한 과제와 액션을 확인하세요
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border"
          style={{ background: "var(--bg-overlay)", borderColor: "var(--border-2)", color: "var(--text-muted)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#818cf8"; (e.currentTarget as HTMLElement).style.color = "#818cf8"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-2)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          새로고침
        </button>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171" }}>
          {error}
        </div>
      )}

      {/* ── KPI 카드 ── */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {[
          { label: "ETA 경과",    count: kpis.overdue,      color: "#f87171", bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.2)",   filterFn: (x: {actions: ActionItem[]}) => x.actions.some(a => a.id === "overdue") },
          { label: "플래닝 검토", count: kpis.reviewNeeded, color: "#fbbf24", bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.2)",  filterFn: (x: {actions: ActionItem[]}) => x.actions.some(a => a.id === "review-needed") },
          { label: "일정 미입력", count: kpis.noSchedule,   color: "#fb923c", bg: "rgba(251,146,60,0.08)",  border: "rgba(251,146,60,0.2)",  filterFn: (x: {actions: ActionItem[]}) => x.actions.some(a => a.id === "no-schedule") },
          { label: "Launch 미정", count: kpis.noLaunch,     color: "#818cf8", bg: "rgba(99,102,241,0.08)",  border: "rgba(99,102,241,0.2)",  filterFn: (x: {actions: ActionItem[]}) => x.actions.some(a => a.id === "no-launch") },
          { label: "Dev 검토중",  count: kpis.planReview,   color: "#60a5fa", bg: "rgba(59,130,246,0.08)",  border: "rgba(59,130,246,0.2)",  filterFn: (x: {actions: ActionItem[]}) => x.actions.some(a => a.id === "planning-reviewing") },
        ].map(kpi => (
          <div
            key={kpi.label}
            className="rounded-xl border px-4 py-3 cursor-default"
            style={{ background: kpi.count > 0 ? kpi.bg : "var(--bg-overlay)", borderColor: kpi.count > 0 ? kpi.border : "var(--border)" }}
          >
            <p className="text-[11px] mb-1" style={{ color: "var(--text-muted)" }}>{kpi.label}</p>
            <p className="text-2xl font-bold" style={{ color: kpi.count > 0 ? kpi.color : "var(--text-subtle)" }}>
              {kpi.count}
            </p>
          </div>
        ))}
      </div>

      {/* ── 필터 바 ── */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {/* 담당자 필터 */}
        <div className="flex items-center gap-1.5">
          {[
            { key: "mine", label: `내 담당 (${userName.split(" ")[0]})` },
            { key: "all",  label: "전체" },
          ].map(opt => (
            <button
              key={opt.key}
              onClick={() => setAssigneeFilter(opt.key)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border"
              style={{
                background: assigneeFilter === opt.key ? "rgba(129,140,248,0.15)" : "var(--bg-overlay)",
                borderColor: assigneeFilter === opt.key ? "#818cf8" : "var(--border-2)",
                color: assigneeFilter === opt.key ? "#818cf8" : "var(--text-muted)",
              }}
            >{opt.label}</button>
          ))}
          {allAssignees.map(name => (
            <button
              key={name}
              onClick={() => setAssigneeFilter(name)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border"
              style={{
                background: assigneeFilter === name ? "rgba(52,211,153,0.15)" : "var(--bg-overlay)",
                borderColor: assigneeFilter === name ? "#34d399" : "var(--border-2)",
                color: assigneeFilter === name ? "#34d399" : "var(--text-muted)",
              }}
            >{name}</button>
          ))}
        </div>

        {/* 구분선 */}
        <div className="w-px h-5 mx-1" style={{ background: "var(--border-2)" }} />

        {/* 심각도 필터 */}
        {[
          { key: "all" as const,      label: "전체 레벨" },
          { key: "critical" as const, label: "⚠ Critical", color: "#f87171" },
          { key: "warning" as const,  label: "▲ Warning",  color: "#fbbf24" },
        ].map(opt => (
          <button
            key={opt.key}
            onClick={() => setLevelFilter(opt.key)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border"
            style={{
              background: levelFilter === opt.key ? "rgba(129,140,248,0.12)" : "var(--bg-overlay)",
              borderColor: levelFilter === opt.key ? "#818cf8" : "var(--border-2)",
              color: levelFilter === opt.key ? (opt.color ?? "#818cf8") : "var(--text-muted)",
            }}
          >{opt.label}</button>
        ))}
      </div>

      {/* ── 액션 필요 티켓 목록 ── */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
          지금 필요한 액션
          <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-normal"
            style={{ background: "var(--bg-overlay)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
            {filteredActions.length}건
          </span>
        </h2>
        {filteredActions.length > 0 && assigneeFilter !== "all" && (
          <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
            {assigneeFilter === "mine" ? `${userName} 담당` : `${assigneeFilter} 담당`} 기준
          </span>
        )}
      </div>

      {filteredActions.length === 0 ? (
        <div className="py-16 text-center rounded-xl border" style={{ background: "var(--bg-overlay)", borderColor: "var(--border)" }}>
          <svg className="w-8 h-8 mx-auto mb-3 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 12l2 2 4-4"/>
            <circle cx="12" cy="12" r="10"/>
          </svg>
          <p className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>처리가 필요한 액션이 없습니다</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-subtle)" }}>필터를 변경하거나 새로고침해주세요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredActions.map(({ ticket, actions }) => {
            const topAction = actions[0];
            const style = LEVEL_STYLE[topAction.level];
            const isExpanded = expandedTickets.has(ticket.key);
            const extraCount = actions.length - 1;

            return (
              <div
                key={ticket.key}
                className="rounded-xl border transition-all"
                style={{
                  background: "var(--bg-overlay)",
                  borderColor: "var(--border)",
                  borderLeft: `3px solid ${style.dot}`,
                }}
              >
                {/* 메인 행 */}
                <div className="flex items-start gap-3 px-4 py-3">
                  {/* 티켓 키 */}
                  <a
                    href={`${JIRA_BASE}${ticket.key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="font-mono text-xs font-semibold shrink-0 hover:underline"
                    style={{ color: "#60a5fa", paddingTop: "2px" }}
                  >{ticket.key}</a>

                  {/* 요약 + 담당자 */}
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/?ticket=${ticket.key}`}
                      className="text-sm font-medium leading-snug block truncate hover:underline"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {ticket.summary}
                    </Link>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{ticket.assignee}</span>
                      {ticket.status && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--bg-canvas)", color: "var(--text-subtle)", border: "1px solid var(--border-2)" }}>
                          {ticket.status}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 최우선 액션 배지 */}
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium"
                      style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.color }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: style.dot }} />
                      {topAction.label}
                    </span>

                    {/* 추가 액션 카운트 + 펼치기 */}
                    {extraCount > 0 && (
                      <button
                        onClick={() => toggleExpand(ticket.key)}
                        className="text-[11px] transition-colors"
                        style={{ color: isExpanded ? "#818cf8" : "var(--text-subtle)" }}
                      >
                        {isExpanded ? "접기 ▲" : `+${extraCount}개 더 ▼`}
                      </button>
                    )}
                  </div>
                </div>

                {/* 펼쳐진 추가 액션들 */}
                {isExpanded && extraCount > 0 && (
                  <div className="px-4 pb-3 pt-1 space-y-1.5 border-t" style={{ borderColor: "var(--border)" }}>
                    {actions.slice(1).map(action => {
                      const s = LEVEL_STYLE[action.level];
                      return (
                        <div key={action.id} className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.dot }} />
                          <span className="text-xs" style={{ color: s.color }}>{action.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── 하단 요약 ── */}
      <div className="mt-8 pt-5 border-t text-center" style={{ borderColor: "var(--border)" }}>
        <p className="text-xs" style={{ color: "var(--text-subtle)" }}>
          전체 {activeTickets.length}개 진행 중 과제 기준 · 완료/ETR 제외
          {" · "}
          <button onClick={load} className="hover:underline" style={{ color: "var(--text-muted)" }}>새로고침</button>
        </p>
      </div>
    </div>
  );
}
