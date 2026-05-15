"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { MetricCard } from "@/app/components/system/MetricCard";

// ─── 타입 정의 ────────────────────────────────────────────────────────────────
type Ticket = {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  eta?: string;
  startDate?: string;
  type: string;
  project: string;
};

type RoleSchedule = {
  role: string;
  person?: string;
  start?: string;
  end?: string;
  status?: "완료" | "진행중" | "예정" | "미정" | "확인필요";
  detail?: string;
};

type ScheduleEntry = RoleSchedule & { ticketKey: string };

type StatusKind = "진행중" | "예정" | "확인필요" | "미정" | "기한초과" | "완료";

// ─── 상수 ─────────────────────────────────────────────────────────────────────
const TICKET_CACHE_KEY = "cc-tickets-v1";

const STATUS_COLOR: Record<StatusKind, { bg: string; text: string }> = {
  "진행중":   { bg: "rgba(59,130,246,0.15)",  text: "#60a5fa" },
  "예정":     { bg: "rgba(99,102,241,0.15)",  text: "#818cf8" },
  "확인필요": { bg: "rgba(124,58,237,0.15)",  text: "#a78bfa" },
  "미정":     { bg: "rgba(249,115,22,0.15)",  text: "#fb923c" },
  "기한초과": { bg: "rgba(239,68,68,0.15)",   text: "#f87171" },
  "완료":     { bg: "rgba(34,197,94,0.12)",   text: "#4ade80" },
};

function statusBadge(kind: StatusKind, label?: string) {
  const s = STATUS_COLOR[kind];
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
      style={{ background: s.bg, color: s.text }}
    >
      {label ?? kind}
    </span>
  );
}

// ─── helper ───────────────────────────────────────────────────────────────────
function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function classifyEntry(e: ScheduleEntry, today: string): StatusKind {
  if (e.status === "완료") return "완료";
  // 위 가드 이후 status !== "완료"는 자명하므로 추가 비교 불필요
  if (e.end && e.end < today) return "기한초과";
  if (e.status === "진행중") return "진행중";
  if (e.status === "예정")   return "예정";
  if (e.status === "확인필요") return "확인필요";
  return "미정";
}

function isUndecided(e: ScheduleEntry): boolean {
  if (e.status === "완료") return false;
  return (!e.start && !e.end) || e.status === "미정" || e.status === "확인필요";
}

// 해당 월 (YYYY-MM) 과 start~end 기간이 겹치는지
function overlapsMonth(start: string | undefined, end: string | undefined, ym: string): boolean {
  const mStart = `${ym}-01`;
  const mEnd   = `${ym}-31`;
  const s = start ?? mStart;
  const e = end   ?? mEnd;
  return s <= mEnd && e >= mStart;
}

// KpiCard 는 MetricCard로 대체됨 — import 위에 선언

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export default function ResourcesPage() {
  const [allTickets, setAllTickets] = useState<Ticket[]>([]);
  const [schedules, setSchedules] = useState<Record<string, RoleSchedule[]>>({});
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);

  const today = getToday();

  // ── 데이터 로드 ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    // 티켓 캐시
    try {
      const raw = localStorage.getItem(TICKET_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as { tickets: Ticket[] };
        if (Array.isArray(cached.tickets)) setAllTickets(cached.tickets);
      }
    } catch {}

    // KV: cc-schedules + cc-hidden-keys
    try {
      const res = await fetch("/api/kv?keys=cc-schedules,cc-hidden-keys");
      const data = await res.json();
      if (data["cc-schedules"] && typeof data["cc-schedules"] === "object") {
        setSchedules(data["cc-schedules"] as Record<string, RoleSchedule[]>);
      }
      if (Array.isArray(data["cc-hidden-keys"])) {
        setHiddenKeys(new Set(data["cc-hidden-keys"] as string[]));
      }
    } catch {}

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Flatten: ticketKey별 schedules → ScheduleEntry[] (hidden 제외) ─────────
  const allEntries = useMemo<ScheduleEntry[]>(() => {
    const result: ScheduleEntry[] = [];
    for (const [ticketKey, roles] of Object.entries(schedules)) {
      if (hiddenKeys.has(ticketKey)) continue; // hidden 제외
      for (const r of roles) {
        result.push({ ...r, ticketKey });
      }
    }
    return result;
  }, [schedules, hiddenKeys]);

  // ── KPI 집계 ──────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    let ongoing = 0, scheduled = 0, needsCheck = 0, undecided = 0, overdue = 0;
    for (const e of allEntries) {
      const kind = classifyEntry(e, today);
      if (kind === "진행중")   ongoing++;
      if (kind === "예정")     scheduled++;
      if (kind === "확인필요") needsCheck++;
      if (kind === "미정")     undecided++;
      if (kind === "기한초과") overdue++;
      if (isUndecided(e) && kind !== "미정" && kind !== "확인필요") undecided++;
    }
    return { ongoing, scheduled, needsCheck, undecided, overdue };
  }, [allEntries, today]);

  // ── 역할별(role) 집계 ────────────────────────────────────────────────────
  const roleMap = useMemo(() => {
    const map = new Map<string, { ongoing: number; scheduled: number; needsCheck: number; undecided: number; overdue: number; entries: ScheduleEntry[] }>();
    for (const e of allEntries) {
      if (!map.has(e.role)) {
        map.set(e.role, { ongoing: 0, scheduled: 0, needsCheck: 0, undecided: 0, overdue: 0, entries: [] });
      }
      const rec = map.get(e.role)!;
      rec.entries.push(e);
      const kind = classifyEntry(e, today);
      if (kind === "진행중")   rec.ongoing++;
      if (kind === "예정")     rec.scheduled++;
      if (kind === "확인필요") rec.needsCheck++;
      if (kind === "기한초과") rec.overdue++;
      if (isUndecided(e))      rec.undecided++;
    }
    return map;
  }, [allEntries, today]);

  const sortedRoles = useMemo(() => {
    return [...roleMap.entries()].sort((a, b) => {
      // 경고(overdue + needsCheck + undecided) 많은 것 먼저
      const scoreA = a[1].overdue * 3 + a[1].needsCheck * 2 + a[1].undecided;
      const scoreB = b[1].overdue * 3 + b[1].needsCheck * 2 + b[1].undecided;
      return scoreB - scoreA;
    });
  }, [roleMap]);

  // ── 인원별(person) 집계 ──────────────────────────────────────────────────
  const personMap = useMemo(() => {
    const map = new Map<string, { roles: Record<string, number>; entries: ScheduleEntry[] }>();
    for (const e of allEntries) {
      if (!e.person) continue;
      if (!map.has(e.person)) map.set(e.person, { roles: {}, entries: [] });
      const rec = map.get(e.person)!;
      rec.entries.push(e);
      rec.roles[e.role] = (rec.roles[e.role] ?? 0) + 1;
    }
    return map;
  }, [allEntries]);

  const sortedPersons = useMemo(() => {
    return [...personMap.entries()].sort((a, b) => b[1].entries.length - a[1].entries.length);
  }, [personMap]);

  // ── 월별 Capacity Heatmap ────────────────────────────────────────────────
  const heatmapMonths = useMemo(() => {
    const months: string[] = [];
    const base = new Date(today);
    base.setDate(1);
    base.setMonth(base.getMonth() - 2); // 2개월 전부터
    for (let i = 0; i < 6; i++) {
      const y = base.getFullYear();
      const m = String(base.getMonth() + 1).padStart(2, "0");
      months.push(`${y}-${m}`);
      base.setMonth(base.getMonth() + 1);
    }
    return months;
  }, [today]);

  // role별 월별 카운트
  const heatmapData = useMemo(() => {
    const result: Record<string, Record<string, number>> = {};
    for (const [role, rec] of roleMap.entries()) {
      result[role] = {};
      for (const ym of heatmapMonths) {
        result[role][ym] = rec.entries.filter(e => overlapsMonth(e.start, e.end, ym)).length;
      }
    }
    return result;
  }, [roleMap, heatmapMonths]);

  const heatmapMax = useMemo(() => {
    let max = 1;
    for (const row of Object.values(heatmapData)) {
      for (const v of Object.values(row)) {
        if (v > max) max = v;
      }
    }
    return max;
  }, [heatmapData]);

  // ── 렌더링 ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm" style={{ color: "var(--text-muted)" }}>
        로딩 중...
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--bg-canvas)", color: "var(--text-primary)" }}>
      {/* 헤더 */}
      <div className="px-8 py-5 sticky top-0 z-10 flex items-start justify-between gap-4"
        style={{ background: "var(--bg-canvas)", borderBottom: "1px solid var(--border)" }}>
        <div>
          <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>리소스 현황</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            cc-schedules 기반 · 팀 리소스 분포와 병목을 확인합니다
          </p>
        </div>
        <button
          onClick={load}
          className="text-xs px-3 py-1.5 rounded-md transition-all"
          style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", color: "var(--text-muted)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
        >
          새로고침
        </button>
      </div>

      <div className="px-8 py-6 flex flex-col gap-8">

        {/* ── KPI 카드 ── */}
        <div className="grid grid-cols-5 gap-3">
          <MetricCard label="진행중 일정" value={kpi.ongoing}    tone="info"    color="#60a5fa" />
          <MetricCard label="예정 일정"   value={kpi.scheduled}  color="#818cf8" />
          <MetricCard label="확인필요"    value={kpi.needsCheck} tone={kpi.needsCheck > 0 ? "warning" : "default"} color="#a78bfa" />
          <MetricCard label="일정 미정"   value={kpi.undecided}  tone={kpi.undecided  > 0 ? "warning" : "default"} color="#fb923c" />
          <MetricCard label="ETA 경과"    value={kpi.overdue}    tone={kpi.overdue    > 0 ? "danger"  : "default"} color="#f87171" />
        </div>

        {/* ── 역할별 현황 ── */}
        <div>
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>역할별(Role) 현황</h2>
          {sortedRoles.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-subtle)" }}>cc-schedules 데이터가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {sortedRoles.map(([role, rec]) => {
                const hasWarning = rec.overdue > 0 || rec.needsCheck > 0;
                const isExpanded = expandedRole === role;
                return (
                  <div key={role} className="rounded-xl flex flex-col"
                    style={{
                      background: "var(--bg-sidebar)",
                      border: hasWarning ? "1px solid rgba(239,68,68,0.3)" : "1px solid var(--border)",
                    }}>
                    <button
                      className="p-4 flex flex-col gap-2 text-left w-full"
                      onClick={() => setExpandedRole(isExpanded ? null : role)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{role}</span>
                        <span className="text-[10px]" style={{ color: "var(--text-subtle)" }}>
                          {isExpanded ? "▲" : "▼"} {rec.entries.length}건
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {rec.ongoing > 0 && statusBadge("진행중", `진행중 ${rec.ongoing}`)}
                        {rec.scheduled > 0 && statusBadge("예정", `예정 ${rec.scheduled}`)}
                        {rec.needsCheck > 0 && statusBadge("확인필요", `확인필요 ${rec.needsCheck}`)}
                        {rec.undecided > 0 && statusBadge("미정", `미정 ${rec.undecided}`)}
                        {rec.overdue > 0 && statusBadge("기한초과", `기한초과 ${rec.overdue}`)}
                      </div>
                    </button>

                    {/* 확장: 티켓 목록 */}
                    {isExpanded && (
                      <div className="px-4 pb-4 flex flex-col gap-1.5"
                        style={{ borderTop: "1px solid var(--bg-item)" }}>
                        <p className="text-[10px] font-semibold pt-3" style={{ color: "var(--text-subtle)" }}>연결 일정</p>
                        {rec.entries.map((e, i) => {
                          const kind = classifyEntry(e, today);
                          const ticket = allTickets.find(t => t.key === e.ticketKey);
                          return (
                            <div key={i} className="rounded-md px-2.5 py-1.5"
                              style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-mono font-semibold" style={{ color: "#60a5fa" }}>
                                  {e.ticketKey}
                                </span>
                                {statusBadge(kind)}
                                {e.person && (
                                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{e.person}</span>
                                )}
                              </div>
                              {ticket && (
                                <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>{ticket.summary}</p>
                              )}
                              {(e.start || e.end) && (
                                <p className="text-[10px] mt-0.5" style={{ color: "var(--text-subtle)" }}>
                                  {e.start ?? "?"} ~ {e.end ?? "?"}
                                </p>
                              )}
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
        </div>

        {/* ── 인원별 현황 ── */}
        <div>
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>인원별(Person) 현황</h2>
          {sortedPersons.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-subtle)" }}>person이 지정된 일정이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {sortedPersons.map(([person, rec]) => {
                const isExpanded = expandedPerson === person;
                return (
                  <div key={person} className="rounded-xl"
                    style={{ background: "var(--bg-sidebar)", border: "1px solid var(--border)" }}>
                    <button
                      className="w-full px-4 py-3 flex items-center gap-3 text-left"
                      onClick={() => setExpandedPerson(isExpanded ? null : person)}
                    >
                      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold text-white"
                        style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
                        {person.charAt(0)}
                      </div>
                      <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{person}</span>
                      <div className="flex items-center gap-1.5 flex-wrap ml-2">
                        {Object.entries(rec.roles).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([role, cnt]) => (
                          <span key={role} className="text-[10px] px-1.5 py-0.5 rounded"
                            style={{ background: "var(--bg-item)", color: "var(--text-muted)", border: "1px solid var(--border-2)" }}>
                            {role} {cnt}
                          </span>
                        ))}
                        {Object.keys(rec.roles).length > 4 && (
                          <span className="text-[10px]" style={{ color: "var(--text-subtle)" }}>+{Object.keys(rec.roles).length - 4}</span>
                        )}
                      </div>
                      <span className="ml-auto text-[10px]" style={{ color: "var(--text-subtle)" }}>
                        {isExpanded ? "▲" : "▼"} 총 {rec.entries.length}건
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 flex flex-col gap-1.5"
                        style={{ borderTop: "1px solid var(--bg-item)" }}>
                        {rec.entries.map((e, i) => {
                          const kind = classifyEntry(e, today);
                          const ticket = allTickets.find(t => t.key === e.ticketKey);
                          return (
                            <div key={i} className="rounded-md px-2.5 py-1.5"
                              style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-mono font-semibold" style={{ color: "#60a5fa" }}>
                                  {e.ticketKey}
                                </span>
                                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{e.role}</span>
                                {statusBadge(kind)}
                              </div>
                              {ticket && (
                                <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>{ticket.summary}</p>
                              )}
                              {(e.start || e.end) && (
                                <p className="text-[10px] mt-0.5" style={{ color: "var(--text-subtle)" }}>
                                  {e.start ?? "?"} ~ {e.end ?? "?"}
                                </p>
                              )}
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
        </div>

        {/* ── 월별 Capacity Heatmap ── */}
        <div>
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
            월별 Capacity Heatmap
            <span className="text-[10px] font-normal ml-2" style={{ color: "var(--text-subtle)" }}>
              (오늘 기준 ±3개월 · role별 활성 일정 수)
            </span>
          </h2>
          {sortedRoles.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-subtle)" }}>데이터 없음</p>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-sidebar)", border: "1px solid var(--border)" }}>
              {/* 헤더 행 */}
              <div className="grid px-4 py-2" style={{ gridTemplateColumns: "120px repeat(6, 1fr)", borderBottom: "1px solid var(--border)" }}>
                <div />
                {heatmapMonths.map(ym => {
                  const isNow = ym === today.substring(0, 7);
                  return (
                    <div key={ym} className="text-center text-[10px] font-medium"
                      style={{ color: isNow ? "#a78bfa" : "var(--text-subtle)" }}>
                      {ym.substring(5)}월{isNow ? " ●" : ""}
                    </div>
                  );
                })}
              </div>
              {/* 역할 행 */}
              {sortedRoles.map(([role]) => (
                <div key={role} className="grid px-4 py-1.5"
                  style={{ gridTemplateColumns: "120px repeat(6, 1fr)", borderBottom: "1px solid var(--bg-overlay)" }}>
                  <div className="text-[11px] truncate pr-2 flex items-center" style={{ color: "var(--text-muted)" }}>{role}</div>
                  {heatmapMonths.map(ym => {
                    const cnt = heatmapData[role]?.[ym] ?? 0;
                    const intensity = heatmapMax > 0 ? cnt / heatmapMax : 0;
                    return (
                      <div key={ym} className="flex items-center justify-center py-1">
                        {cnt > 0 ? (
                          <div className="rounded text-center text-[10px] font-bold px-1"
                            style={{
                              background: `rgba(124,58,237,${0.1 + intensity * 0.7})`,
                              color: intensity > 0.5 ? "var(--text-primary)" : "#a78bfa",
                              minWidth: 24,
                            }}>
                            {cnt}
                          </div>
                        ) : (
                          <span className="text-[10px]" style={{ color: "var(--bg-item)" }}>·</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
