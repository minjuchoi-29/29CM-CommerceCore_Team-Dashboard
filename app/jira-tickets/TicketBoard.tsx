"use client";
import { useState, useMemo, useEffect, useCallback, useRef, Fragment } from "react";

const JIRA_BASE = "https://jira.team.musinsa.com/browse/";

const STATUS_COLOR: Record<string, string> = {
  "론치완료": "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700/40",
  "완료":     "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700/40",
  "배포완료": "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700/40",
  "개발중":   "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-700/40",
  "In Progress": "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-700/40",
  "QA중":     "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700/40",
  "디자인완료": "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 border border-purple-300 dark:border-purple-700/40",
  "기획중":   "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400 border border-orange-300 dark:border-orange-700/40",
  "기획완료": "bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400 border border-teal-300 dark:border-teal-700/40",
  "SUGGESTED": "bg-gray-100 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-700/40",
  "HOLD":     "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-700/40",
  "Postponed": "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-700/40",
  "철회/반려/취소": "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 border border-red-300 dark:border-red-700/40",
  "준비중":   "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-700/30",
  "디자인중": "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700/30",
  "Backlog":  "bg-gray-100 dark:bg-gray-800/40 text-gray-500 dark:text-gray-500 border border-gray-200 dark:border-gray-700/30",
};

const ROLE_COLOR: Record<string, string> = {
  "기획":    "bg-indigo-400",
  "디자인":  "bg-violet-400",
  "BE-SP":   "bg-blue-600",
  "BE-PP":   "bg-blue-400",
  "BE-CE":   "bg-blue-300",
  "BE-외주": "bg-sky-600",
  "FE-CFE":  "bg-cyan-500",
  "FE-DFE":  "bg-cyan-400",
  "FE-외주":    "bg-sky-400",
  "FE-Sotatek": "bg-sky-400",
  "Mobile":  "bg-teal-400",
  "QA":      "bg-emerald-500",
  "DA":      "bg-amber-500",
  "배포":    "bg-rose-400",
  "CSE":     "bg-teal-600",
  "Kick-Off": "bg-indigo-600",
  "Release":  "bg-orange-500",
  "Launch":   "bg-green-600",
  // legacy keys (backward compat)
  "개발BE":  "bg-blue-500",
  "개발FE":  "bg-cyan-500",
};

type RoleSchedule = {
  role: string;
  person: string;
  start: string;
  end: string;
  status: "완료" | "진행중" | "예정" | "미정" | "확인필요";
  detail?: string;
  detailPerson?: string;
  vacationDays?: number;
};

type MemoEntry = {
  text: string;
  author: string;
  date: string; // YYYY-MM-DD
};

type PlanningNote = {
  text: string;
  author: string;
  date: string; // YYYY-MM-DD HH:mm
};

type MemoVersion = {
  text: string;
  author: string;
  date: string; // YYYY-MM-DD HH:mm
  isAI?: boolean;
};

const TYPE_COLOR: Record<string, string> = {
  "Initiative": "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-400 border border-violet-300 dark:border-violet-700/40",
  "Epic":       "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-700/40",
  "Dev":        "bg-gray-100 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-700/40",
};

export type Ticket = {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  startDate?: string;
  eta: string;
  type: string;
  project: string;
  roles?: RoleSchedule[];
  description?: string;
  // 추가 메타 필드
  requestDept?: string;
  requestPriority?: string;
  twoPagerUrl?: string;
  prdUrl?: string;
  parent?: string;
  healthCheck?: string;
  storyPoints?: number;
  bodyRequestDept?: string;
};

// 오늘 자정 기준 ms
const TODAY_MS = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
})();

const Q1Q2_KEYS = new Set([
  "TM-1241", "TM-1846", "TM-1869", "TM-1871", "TM-1886",
  "TM-2048", "TM-2155", "TM-2174", "TM-2182", "TM-2185",
  "TM-2186", "TM-2216", "TM-2234", "TM-2294",
]);

const Q2_KEYS = new Set([
  ...Q1Q2_KEYS,
  "TM-2513", "TM-2726", "TM-2727", "TM-2741", "TM-2742",
  "TM-2745", "TM-2746", "TM-2751", "TM-2753", "TM-2756",
  "TM-2758", "TM-2762", "TM-2763", "TM-2770", "TM-2771",
  "TM-2779", "TM-2814", "TM-2815", "TM-2817", "TM-2853",
  "TM-2854", "TM-2878",
]);

const ALL_QUARTERS = ["Y26Q1", "Q1+Q2", "Y26Q2"];
const ALL_PROJECTS = ["TM", "CMALL", "M29CMCCF", "M29COMCO", "M29CMOD", "EF"];
const ALL_STATUSES = ["론치완료/완료", "개발중", "QA중", "SUGGESTED", "HOLD/Postponed", "기타"];
const ALL_LEVELS   = ["Initiative", "Epic", "Dev"];

const TARGET_LABELS = new Set(["29CM", "29Connect"]);

function extractTarget(summary: string): string | null {
  const m = summary.match(/^\[([^\]]+)\]/);
  return m && TARGET_LABELS.has(m[1]) ? m[1] : null;
}

function extractDomain(summary: string): string {
  const s = summary.replace(/^\[(29CM|29Connect)\]\s*/, "");
  const m = s.match(/^\[([^\]]+)\]/);
  return m ? m[1] : "기타";
}

function matchStatus(status: string, filter: string): boolean {
  if (filter === "전체") return true;
  if (filter === "론치완료/완료") return ["론치완료", "완료", "배포완료"].includes(status);
  if (filter === "개발중") return ["개발중", "In Progress"].includes(status);
  if (filter === "QA중") return status === "QA중";
  if (filter === "SUGGESTED") return ["SUGGESTED", "Backlog"].includes(status);
  if (filter === "HOLD/Postponed") return ["HOLD", "Postponed"].includes(status);
  if (filter === "기타") return ["기획중", "기획완료", "디자인완료", "디자인중", "준비중", "철회/반려/취소"].includes(status);
  return true;
}

function toggle(prev: Set<string>, value: string): Set<string> {
  const next = new Set(prev);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

const TODAY_LABEL = (() => {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`;
})();

function makeViewFns(viewStart: number, viewEnd: number) {
  const span = viewEnd - viewStart;
  function pct(ms: number) {
    return Math.max(0, Math.min(100, ((ms - viewStart) / span) * 100));
  }
  function datePct(d: string) { return pct(new Date(d).getTime()); }
  function barLeft(s: string) { return pct(Math.max(viewStart, new Date(s).getTime())); }
  function barWidth(s: string, e: string) {
    const sMs = Math.max(viewStart, new Date(s).getTime());
    // 종료일을 하루의 끝(23:59:59)으로 계산 — 시작=종료(1일짜리)도 바가 보이도록
    const eMs = Math.min(viewEnd, new Date(e + "T23:59:59").getTime());
    return eMs <= sMs ? 0 : Math.max(0.3, ((eMs - sMs) / span) * 100);
  }
  return { pct, datePct, barLeft, barWidth };
}

const THIS_YEAR = new Date().getFullYear();

function formatDateWithDay(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00");
  const prefix = d.getFullYear() !== THIS_YEAR ? `${d.getFullYear()}/` : "";
  return `${prefix}${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`;
}

// 짧은 날짜 포맷: 요일 항상 표시, 올해 아니면 연도도 표시
function shortDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const prefix = d.getFullYear() !== THIS_YEAR ? `${d.getFullYear()}/` : "";
  return `${prefix}${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`;
}

// 한국 공휴일 (2025~2026)
const KR_HOLIDAYS = new Set([
  // 2025
  "2025-01-01","2025-01-28","2025-01-29","2025-01-30",
  "2025-03-01","2025-05-05","2025-05-06","2025-06-06",
  "2025-08-15","2025-10-03","2025-10-05","2025-10-06","2025-10-07","2025-10-08","2025-10-09",
  "2025-12-25",
  // 2026
  "2026-01-01","2026-02-17","2026-02-18","2026-02-19",
  "2026-03-01","2026-03-02","2026-05-01","2026-05-05","2026-05-06","2026-05-25","2026-06-06",
  "2026-08-15","2026-08-17","2026-09-24","2026-09-25","2026-09-26",
  "2026-10-03","2026-10-09","2026-12-25",
]);

function isWorkingDay(date: Date): boolean {
  const day = date.getDay(); // 0=일, 6=토
  if (day === 0 || day === 6) return false;
  const iso = date.toISOString().slice(0, 10);
  if (KR_HOLIDAYS.has(iso)) return false;
  return true;
}

function calcWorkingDays(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  if (s > e) return 0;
  let count = 0;
  const cur = new Date(s);
  while (cur <= e) {
    if (isWorkingDay(cur)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function GanttChart({ roles, forceShowPastDone, extendedView, fitToContent, ticketDone, ticketActive, onEditRow }: {
  roles?: RoleSchedule[];
  forceShowPastDone?: boolean;
  extendedView?: boolean;   // 펼치기: 과거 6개월 + 미래 2개월
  fitToContent?: boolean;   // 론치완료 요약: viewStart = 최초 role 시작일, pastDone 없이 표시
  ticketDone?: boolean;     // 완료 티켓: 확인필요 항목도 이전 완료 일정으로 분류
  ticketActive?: boolean;   // 진행중·완료 티켓: Kick-Off 미입력 시 "확인필요", Release/Launch 미입력 시 "미정"
  onEditRow?: (r: RoleSchedule) => void; // 행 수정 버튼 클릭 콜백
}) {
  const [showPastDone, setShowPastDone] = useState(false);
  const effectiveShowPastDone = forceShowPastDone || showPastDone;

  // 뷰 시작
  const viewStart = (() => {
    if (extendedView) {
      // 과거 6개월 전 1일
      const d = new Date();
      d.setMonth(d.getMonth() - 6);
      d.setDate(1); d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    if (fitToContent && (roles ?? []).some(r => r.start)) {
      // 가장 이른 role 시작월 1일
      const earliest = Math.min(...(roles ?? []).filter(r => r.start).map(r => new Date(r.start + "T00:00:00").getTime()));
      const d = new Date(earliest);
      d.setDate(1); d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    // 기본: 이번 달 1일
    const d = new Date();
    d.setDate(1); d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();

  // 뷰 종료
  const viewEnd = (() => {
    const monthsForward = extendedView ? 2 : 3; // 펼치기: 미래 2개월, 기본: 현재월 포함 3개월
    const minEnd = new Date();
    minEnd.setMonth(minEnd.getMonth() + monthsForward);
    minEnd.setDate(0);
    minEnd.setHours(23, 59, 59, 999);
    let ms = minEnd.getTime();
    for (const r of roles ?? []) {
      if (r.end) {
        const endMs = new Date(r.end).getTime();
        if (endMs > ms) {
          const d = new Date(r.end);
          d.setMonth(d.getMonth() + 1);
          d.setDate(0);
          d.setHours(23, 59, 59, 999);
          ms = d.getTime();
        }
      }
    }
    return ms;
  })();

  // 월 레이블 동적 생성
  const monthDates = (() => {
    const months: { label: string; ms: number }[] = [];
    const cur = new Date(viewStart);
    cur.setDate(1);
    while (cur.getTime() <= viewEnd) {
      months.push({ label: `${cur.getMonth() + 1}월`, ms: cur.getTime() });
      cur.setMonth(cur.getMonth() + 1);
    }
    return months;
  })();

  const { pct, barLeft, barWidth } = makeViewFns(viewStart, viewEnd);
  const todayPct = pct(TODAY_MS);

  // 시작일 오름차순 → 동일 시 종료일 오름차순 정렬 (빈 날짜는 맨 뒤)
  const sortedRoles = [...(roles ?? [])].sort((a, b) => {
    const aS = a.start ? new Date(a.start).getTime() : Infinity;
    const bS = b.start ? new Date(b.start).getTime() : Infinity;
    if (aS !== bS) return aS - bS;
    const aE = a.end ? new Date(a.end).getTime() : Infinity;
    const bE = b.end ? new Date(b.end).getTime() : Infinity;
    return aE - bE;
  });

  // 현재 뷰에서 안 보이는 과거 완료 항목 분리 (fitToContent면 항상 visible로)
  // 완료 티켓(ticketDone)은 이전 완료 일정 섹션 없이 전체 플랫하게 표시
  const isPastDone = (fitToContent || ticketDone)
    ? () => false
    : (r: RoleSchedule) => r.status === "완료" && !!r.end && new Date(r.end).getTime() < viewStart;
  const pastDoneRoles  = sortedRoles.filter(isPastDone);
  const rawVisible     = sortedRoles.filter(r => !isPastDone(r));

  // Kick-Off / Release / Launch 가 없으면 기본 행 추가
  // 진행중·완료 티켓(ticketActive): Kick-Off 미입력 → "확인필요", Release/Launch 미입력 → "미정"
  const milestoneDefaults: RoleSchedule[] = MILESTONE_ROLES
    .filter(role => !rawVisible.some(r => r.role === role))
    .map(role => ({
      role, person: "-", start: "", end: "",
      status: (ticketActive && role === "Kick-Off") ? "확인필요" as const : "미정" as const,
    }));
  const visibleRoles = [...rawVisible, ...milestoneDefaults];

  return (
    <div className="mt-3">
      {/* 월 헤더 */}
      <div className="flex mb-0.5">
        <div className="w-52 shrink-0" />
        <div className="flex-1 relative h-5">
          {monthDates.map((m) => (
            <span
              key={m.label}
              className="absolute text-xs text-gray-500 -translate-x-1/2"
              style={{ left: `${pct(m.ms)}%` }}
            >
              {m.label}
            </span>
          ))}
        </div>
      </div>

      {/* 오늘 날짜 레이블 — 일정이 있을 때만 표시 */}
      {roles && roles.length > 0 && (
        <div className="flex mb-2">
          <div className="w-52 shrink-0" />
          <div className="flex-1 relative h-6">
            <span
              className="absolute -translate-x-1/2"
              style={{ left: `${todayPct}%` }}
            >
              <span className="text-xs font-semibold text-red-500 whitespace-nowrap bg-red-50 border border-red-100 px-1.5 py-0.5 rounded">
                📍 {TODAY_LABEL}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* 롤 바 목록 */}
      <div className="relative">
        {visibleRoles.length > 0 ? visibleRoles.map((r, i) => {
          const endMs   = r.end   ? new Date(r.end).getTime()   : null;
          const startMs = r.start ? new Date(r.start).getTime() : null;
          const overdue   = endMs   !== null && endMs   < TODAY_MS && r.status !== "완료";
          const notStarted = startMs !== null && startMs < TODAY_MS && r.status === "예정";
          return (
          <div key={`${r.role}-${r.person}-${i}`} className="mb-2.5 group/ganttrow">
            <div className="flex items-start">
              {/* 좌측: role + person, 세부작업 */}
              <div className="w-48 shrink-0 pt-0.5">
                <div className="flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-sm shrink-0 ${ROLE_COLOR[r.role] ?? "bg-gray-400"}`} />
                  <span className={`text-sm font-medium shrink-0 whitespace-nowrap w-20 ${MILESTONE_ROLES.includes(r.role) ? "font-semibold" : ""}`} style={{ color: MILESTONE_ROLES.includes(r.role) ? "#818cf8" : "var(--text-muted)" }}>{r.role}</span>
                  <span className="text-sm whitespace-nowrap" style={{ color: "#9ca3af" }} title={r.person}>{r.person}</span>
                </div>
                {r.detail && (
                  <p className="text-xs text-gray-400 mt-0.5 pl-3.5 leading-snug" title={`${r.detail}${r.detailPerson ? ` · ${r.detailPerson}` : ""}`}>
                    {r.detail}
                    {r.detailPerson && <span className="ml-1 text-gray-300">· {r.detailPerson}</span>}
                  </p>
                )}
              </div>
              {/* 우측: 바 + 날짜 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center">
                  <div className="flex-1 relative h-5 rounded-sm overflow-hidden" style={{ background: "var(--bg-item)" }}>
                    <div className="absolute top-0 bottom-0 w-px bg-red-400 z-10" style={{ left: `${todayPct}%` }} />
                    {r.status === "미정" ? (
                      <div className="absolute inset-0 flex items-center justify-center gap-1.5" style={{ background: "rgba(245,158,11,0.06)" }}>
                        <span className="text-[10px] font-bold tracking-wide" style={{ color: "#f59e0b" }}>⚠</span>
                        <span className="text-xs font-medium" style={{ color: "#f59e0b" }}>기간 산정 중</span>
                      </div>
                    ) : r.status === "확인필요" && !r.start ? (
                      <div className="absolute inset-0 flex items-center justify-center gap-1.5" style={{ background: "rgba(167,139,250,0.06)" }}>
                        <span className="text-[10px] font-bold" style={{ color: "#a78bfa" }}>?</span>
                        <span className="text-xs font-medium" style={{ color: "#a78bfa" }}>PM 확인 필요</span>
                      </div>
                    ) : barWidth(r.start, r.end) > 0 && (
                      <div
                        className={`absolute top-0.5 bottom-0.5 rounded-sm ${ROLE_COLOR[r.role] ?? "bg-gray-400"} ${r.status === "완료" ? "opacity-40" : r.status === "예정" ? "opacity-60" : r.status === "확인필요" ? "opacity-50 border border-purple-300" : ""}`}
                        style={{ left: `${barLeft(r.start)}%`, width: `${barWidth(r.start, r.end)}%` }}
                      />
                    )}
                  </div>
                  <span className={`ml-2 text-xs w-16 shrink-0 whitespace-nowrap ${r.status === "완료" ? "text-green-500" : r.status === "진행중" ? "text-blue-500" : r.status === "미정" ? "text-orange-400" : r.status === "확인필요" ? "text-purple-500" : "text-gray-400"}`}>
                    {r.status}
                  </span>
                  {overdue && (
                    <span className="relative ml-1 shrink-0 group">
                      <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-600 border border-red-200 cursor-default">기한 초과</span>
                      <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 w-40 rounded-lg bg-gray-900 text-white text-xs px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 whitespace-normal text-center">
                        종료일이 지났으나 완료 처리되지 않았습니다
                        <span className="absolute top-full right-3 border-4 border-transparent border-t-gray-900" />
                      </span>
                    </span>
                  )}
                  {!overdue && notStarted && (
                    <span className="relative ml-1 shrink-0 group">
                      <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-600 border border-orange-200 cursor-default">시작 확인</span>
                      <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 w-40 rounded-lg bg-gray-900 text-white text-xs px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 whitespace-normal text-center">
                        시작일이 지났으나 아직 예정 상태입니다
                        <span className="absolute top-full right-3 border-4 border-transparent border-t-gray-900" />
                      </span>
                    </span>
                  )}
                  {/* 수정 바로가기 버튼 (행 호버 시 노출) */}
                  {onEditRow && (
                    <button
                      onClick={() => onEditRow(r)}
                      title="이 항목 수정"
                      className="ml-1.5 shrink-0 opacity-0 group-hover/ganttrow:opacity-100 transition-opacity text-gray-300 hover:text-indigo-500 text-xs px-1 py-0.5 rounded hover:bg-indigo-50"
                    >
                      ✏️
                    </button>
                  )}
                </div>
                {r.status === "미정" ? (
                  <p className="inline-flex items-center gap-1 text-[11px] font-medium mt-0.5 px-1.5 py-0.5 rounded" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)" }}>
                    기간 산정 중 — 날짜 확정 후 상태를 변경해주세요
                  </p>
                ) : r.status === "확인필요" && !r.start ? (
                  <p className="inline-flex items-center gap-1 text-[11px] font-medium mt-0.5 px-1.5 py-0.5 rounded" style={{ background: "rgba(167,139,250,0.1)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.25)" }}>
                    담당 PM이 현황 확인 후 업데이트 필요
                  </p>
                ) : r.start && r.end && (
                  <p className="text-xs text-gray-500 whitespace-nowrap mt-0.5">
                    {formatDateWithDay(r.start)} ~ {formatDateWithDay(r.end)}
                    {(() => {
                      const total = calcWorkingDays(r.start, r.end);
                      const vac = r.vacationDays ?? 0;
                      const net = Math.max(0, total - vac);
                      return vac > 0
                        ? <><span className="ml-1.5 text-gray-400">{net}영업일</span><span className="ml-1 text-orange-400 text-[10px]">(-{vac}휴가)</span></>
                        : <span className="ml-1.5 text-gray-400">{total}영업일</span>;
                    })()}
                  </p>
                )}
              </div>
            </div>
          </div>
          );
        }) : (
          <div className="flex items-center">
            <div className="w-52 shrink-0" />
            <p className="text-xs text-gray-500 py-2">일정 데이터 없음 — 작업별 일정 입력 시 표시됩니다</p>
          </div>
        )}
      </div>

      {pastDoneRoles.length > 0 && (
        <div className="mt-3 border-t border-gray-800 pt-2" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={() => setShowPastDone(v => !v)}
            className="flex items-center gap-1.5 text-sm transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            <span>{effectiveShowPastDone ? "▾" : "▸"}</span>
            <span>이전 완료 일정 {pastDoneRoles.length}건</span>
          </button>
          {effectiveShowPastDone && (
            <div className="mt-2 pl-1">
              <div className="grid gap-y-0.5" style={{ gridTemplateColumns: "auto auto auto 1fr" }}>
                {pastDoneRoles.map((r, i) => (
                  <Fragment key={`past-${r.role}-${r.person}-${i}`}>
                    {/* role */}
                    <div className="flex items-center gap-1.5 pr-3 py-1">
                      <span className={`inline-block w-2 h-2 rounded-sm shrink-0 ${ROLE_COLOR[r.role] ?? "bg-gray-400"}`} />
                      <span className="text-sm font-medium text-gray-400 whitespace-nowrap">{r.role}</span>
                    </div>
                    {/* person */}
                    <span className="text-sm text-gray-400 whitespace-nowrap pr-3 py-1" title={r.person}>{r.person}</span>
                    {/* date */}
                    <span className="text-sm text-gray-500 whitespace-nowrap pr-3 py-1">
                      {r.start && r.end ? (
                        <>
                          {formatDateWithDay(r.start)} ~ {formatDateWithDay(r.end)}
                          {(() => {
                            const total = calcWorkingDays(r.start, r.end);
                            const vac = r.vacationDays ?? 0;
                            const net = Math.max(0, total - vac);
                            return vac > 0
                              ? <><span className="ml-1.5 text-xs text-gray-400">{net}영업일</span><span className="ml-1 text-orange-400 text-[10px]">(-{vac}휴가)</span></>
                              : <span className="ml-1.5 text-xs text-gray-400">{total}영업일</span>;
                          })()}
                        </>
                      ) : ""}
                    </span>
                    {/* detail */}
                    <span className="text-sm text-gray-400 py-1 min-w-0 truncate" title={r.detail ?? ""}>
                      {r.detail ? `· ${r.detail}` : ""}
                    </span>
                  </Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MILESTONE_ROLES = ["Kick-Off", "Release", "Launch"];
const MILESTONE_KO: Record<string, string> = {
  "Kick-Off": "킥오프",
  "Release":  "배포",
  "Launch":   "론치",
};
const MILESTONE_CHIP: Record<string, string> = {
  "Kick-Off": "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-700/40",
  "Release":  "bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-700/40",
  "Launch":   "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-700/40",
};
const MILESTONE_DOT: Record<string, string> = {
  "Kick-Off": "bg-indigo-500",
  "Release":  "bg-orange-500",
  "Launch":   "bg-green-600",
};
const MILESTONE_DOT_HEX: Record<string, string> = {
  "Kick-Off": "#6366f1",
  "Release":  "#f97316",
  "Launch":   "#16a34a",
};
const PRESET_ROLES = ["기획", "디자인", "BE-SP", "BE-PP", "BE-CE", "BE-메가존", "FE-CFE", "FE-DFE", "FE-Sotatek", "Mobile", "DA", "QA"];
const ALL_PRESET_ROLES = [...MILESTONE_ROLES, ...PRESET_ROLES];

function isCustomRole(role: string) {
  return !ALL_PRESET_ROLES.includes(role);
}
const STATUS_OPTIONS: RoleSchedule["status"][] = ["확인필요", "미정", "예정", "진행중", "완료"];

function newRow(): RoleSchedule {
  return { role: "기획", person: "", start: "", end: "", status: "예정" };
}

type EtrTicketInfo = {
  key: string;
  summary?: string;
  requestDept?: string;
  status?: string;
};

type WikiLink = {
  url: string;
  title: string;
};

type TicketRequestInfo = {
  source: "자체발의" | "ELT" | "ETR";
  etrStatus?: "추가완료" | "추가필요";
  etrTickets?: EtrTicketInfo[];
  wikiLinks?: WikiLink[];
};

type TrackState = "대기중" | "검토중" | "완료" | "대상아님";
const TRACK_STATES: TrackState[] = ["대기중", "검토중", "완료", "대상아님"];

type DevTrackKey = "SP" | "PP" | "CFE" | "기타";
const DEV_TRACK_KEYS: DevTrackKey[] = ["SP", "PP", "CFE", "기타"];

function aggregateDevState(devTracks: Partial<Record<DevTrackKey, TrackState>>): TrackState {
  const values = Object.values(devTracks).filter(Boolean) as TrackState[];
  if (values.length === 0) return "대기중";
  if (values.every(v => v === "대상아님")) return "대상아님";
  const active = values.filter(v => v !== "대상아님");
  if (active.length === 0) return "대상아님";
  if (active.some(v => v === "대기중")) return "대기중";
  if (active.some(v => v === "검토중")) return "검토중";
  return "완료";
}

function getPlanningVal(val: unknown): { design: TrackState; dev: TrackState; devTracks: Partial<Record<DevTrackKey, TrackState>>; reviewNeeded: boolean } {
  if (!val || typeof val === "string") return { design: "대기중", dev: "대기중", devTracks: {}, reviewNeeded: false };
  const v = val as Record<string, unknown>;
  const devTracks = (v.devTracks as Partial<Record<DevTrackKey, TrackState>>) ?? {};
  const devTracksHasEntries = Object.keys(devTracks).length > 0;
  return {
    design:       (v.design as TrackState) ?? "대기중",
    dev:          devTracksHasEntries ? aggregateDevState(devTracks) : ((v.dev as TrackState) ?? "대기중"),
    devTracks,
    reviewNeeded: (v.reviewNeeded as boolean) ?? false,
  };
}

function HealthBadge({ value }: { value: string }) {
  const v = value.toLowerCase();
  const isGreen  = ["그린", "green", "정상", "good", "ok"].some(k => v.includes(k));
  const isYellow = ["옐로우", "yellow", "주의", "warning", "caution"].some(k => v.includes(k));
  const isRed    = ["레드", "red", "위험", "danger", "critical", "bad"].some(k => v.includes(k));
  const dotCls = isGreen ? "bg-green-500" : isYellow ? "bg-yellow-400" : isRed ? "bg-red-500" : "bg-gray-400";
  const badgeCls = isGreen
    ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-700/40"
    : isYellow
    ? "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-700/40"
    : isRed
    ? "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-700/40"
    : "bg-gray-100 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700/40";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium ${badgeCls}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
      {value}
    </span>
  );
}

const DONE_PRIORITY_STATUSES = new Set(["론치완료", "완료", "배포완료"]);

/**
 * 완료/삭제된 티켓의 우선순위 공백을 메워 1부터 순차 재배열.
 * 변경이 없으면 null 반환.
 * @returns { newState } - 로컬 state 반영용 (active만 포함)
 *          { sheetUpdate } - 시트 일괄 반영용 (active + 클리어 대상 포함)
 */
function computeRebalance(
  rawPriorities: Record<string, string>,
  tickets: Ticket[]
): { newState: Record<string, string>; sheetUpdate: Record<string, string> } | null {
  const ticketMap = new Map(tickets.map(t => [t.key, t.status]));

  const active = Object.entries(rawPriorities)
    .filter(([key]) => {
      const s = ticketMap.get(key);
      return s !== undefined && !DONE_PRIORITY_STATUSES.has(s);
    })
    .map(([key, p]) => ({ key, p: parseInt(p) || 999 }))
    .sort((a, b) => a.p - b.p);

  const toClean = Object.keys(rawPriorities).filter(key => {
    const s = ticketMap.get(key);
    return s !== undefined && DONE_PRIORITY_STATUSES.has(s);
  });

  const activeChanged = active.some(({ key, p }, idx) =>
    rawPriorities[key] !== String(idx + 1) || p !== idx + 1
  );
  if (!activeChanged && toClean.length === 0) return null;

  const newState: Record<string, string> = {};
  active.forEach(({ key }, idx) => { newState[key] = String(idx + 1); });

  const sheetUpdate: Record<string, string> = { ...newState };
  toClean.forEach(key => { sheetUpdate[key] = "완료"; });

  return { newState, sheetUpdate };
}

function MultiSelectDropdown({
  label,
  items,
  selected,
  onToggle,
  onClear,
  accentColor = "#7c3aed",
}: {
  label: string;
  items: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
  accentColor?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);
  const count = selected.size;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border whitespace-nowrap"
        style={{
          background: count > 0 ? "rgba(124,58,237,0.12)" : "var(--bg-item)",
          borderColor: count > 0 ? accentColor : "var(--border-2)",
          color: count > 0 ? accentColor : "var(--text-muted)",
        }}
      >
        {label}{count > 0 ? `: ${[...selected].join(", ")}` : ": 전체"}
        <span className="ml-0.5 text-[9px]">▾</span>
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 rounded-lg border overflow-hidden shadow-xl"
          style={{ background: "var(--bg-item)", borderColor: "var(--border-2)", minWidth: "140px" }}
        >
          <div
            className="px-3 py-2 text-xs font-medium cursor-pointer hover:bg-opacity-80 border-b"
            style={{ color: count === 0 ? "#a78bfa" : "var(--text-muted)", borderColor: "var(--border-2)" }}
            onClick={() => { onClear(); }}
          >
            전체 (선택 해제)
          </div>
          {items.map(v => (
            <div
              key={v}
              className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer transition-colors"
              style={{ color: selected.has(v) ? "#a78bfa" : "var(--text-secondary)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--border)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              onClick={() => onToggle(v)}
            >
              <span
                className="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0"
                style={{
                  borderColor: selected.has(v) ? "#7c3aed" : "var(--text-subtle)",
                  background: selected.has(v) ? "#7c3aed" : "transparent",
                }}
              >
                {selected.has(v) && <span className="text-white text-[9px]">✓</span>}
              </span>
              {v}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TicketBoard({ userName = "알 수 없음" }: { userName?: string }) {
  const [tickets, setTickets]       = useState<Ticket[]>([]);
  const [fetching, setFetching]     = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt]     = useState<Date | null>(null);

  const [selected, setSelected]     = useState<Ticket | null>(null);
  const [quarters, setQuarters]     = useState<Set<string>>(new Set());
  const [projects, setProjects]     = useState<Set<string>>(new Set());
  const [statuses, setStatuses]     = useState<Set<string>>(new Set());
  const [levels, setLevels]         = useState<Set<string>>(new Set());
  const [domainFilter, setDomainFilter] = useState<Set<string>>(new Set());
  const [targetFilter, setTargetFilter] = useState<Set<string>>(new Set());
  const [assigneeFilter, setAssigneeFilter] = useState<Set<string>>(new Set());
  const [search, setSearch]         = useState("");

  // localStorage 기반 일정 데이터
  const [schedules, setSchedules]   = useState<Record<string, RoleSchedule[]>>({});
  const [editMode, setEditMode]     = useState(false);
  const [editRows, setEditRows]     = useState<RoleSchedule[]>([]);
  const [editError, setEditError]   = useState<string | null>(null);
  const [editFocusKey, setEditFocusKey] = useState<string | null>(null); // 직접 수정 버튼으로 진입 시 포커스할 행 키
  const editRowRefs = useRef<(HTMLDivElement | null)[]>([]); // 편집 폼 행 ref (스크롤용)

  // 주요 내용 요약 (작성자/날짜 포함)
  const [memos, setMemos]           = useState<Record<string, MemoEntry | string>>({});
  const [memoHistory, setMemoHistory] = useState<Record<string, MemoVersion[]>>({});
  const [memoEditMode, setMemoEditMode] = useState(false);
  const [memoCollapsed, setMemoCollapsed] = useState(true);
  const [memoText, setMemoText]     = useState("");
  const [memoHistoryOpen, setMemoHistoryOpen] = useState(false);

  // AI 요약 생성 중인 티켓 키 집합
  const [summaryLoading, setSummaryLoading] = useState<Set<string>>(new Set());

  // 우측 사이드바 너비 (드래그 리사이즈)
  const [sidebarWidth, setSidebarWidth] = useState(700);
  const [isDetailExpanded, setIsDetailExpanded] = useState(false);
  const [showFullDoneSchedule, setShowFullDoneSchedule] = useState(false);

  // 시트 우선순위 (key → priority 문자열)
  const [priorities, setPriorities] = useState<Record<string, string>>({});
  const [priorityError, setPriorityError] = useState<string | null>(null);
  // 플래닝 상태 (key → { design: TrackState, dev: TrackState, reviewNeeded?: boolean })
  const [planning, setPlanning]     = useState<Record<string, unknown>>({});
  const [reviewFilter, setReviewFilter] = useState(false); // 검토필요 티켓만 필터
  const [newFilter, setNewFilter]       = useState(false); // 최근 2주 신규 티켓만 필터
  const [ticketAddedDates, setTicketAddedDates] = useState<Record<string, string>>({}); // key → "YYYY-MM-DD"
  const [newSectionOpen, setNewSectionOpen] = useState(false); // 신규 섹션 접힘 여부
  const [planningTab, setPlanningTab] = useState("진행 중");
  const [kvLoaded, setKvLoaded]     = useState(false);
  const planningMigratedRef         = useRef(false);
  // 플래닝 코멘트 (key → PlanningNote[])
  const [planningNotes, setPlanningNotes] = useState<Record<string, PlanningNote[]>>({});
  const [noteInput, setNoteInput]         = useState("");
  // 티켓 메모 (key → PlanningNote[])
  const [ticketNotes, setTicketNotes]     = useState<Record<string, PlanningNote[]>>({});
  const [ticketNoteInput, setTicketNoteInput] = useState("");
  const [planningOpen, setPlanningOpen] = useState(true);
  const [agenda, setAgenda] = useState<Set<string>>(new Set());
  const [agendaView, setAgendaView] = useState(false);

  // 요구사항 출처 (key → TicketRequestInfo)
  const [etrMap, setEtrMap]       = useState<Record<string, TicketRequestInfo>>({});
  const [etrInput, setEtrInput]   = useState("");
  const [etrError, setEtrError]   = useState<string | null>(null);
  const [etrLoading, setEtrLoading] = useState<Set<string>>(new Set());
  const [wikiInput, setWikiInput] = useState("");
  const [wikiTitleInput, setWikiTitleInput] = useState("");
  const [wikiError, setWikiError] = useState<string | null>(null);
  const [wikiAddOpen, setWikiAddOpen] = useState(false);
  const [sheetSyncMsg, setSheetSyncMsg] = useState<string | null>(null);

  // 정렬
  const [sortBy, setSortBy] = useState<"default" | "priority" | "startDate" | "eta">("eta");
  const [statusTab, setStatusTab] = useState<"전체" | "완료" | "진행중" | "계획/대기">("전체");

  // 사용자 직접 추가 티켓 관리
  const [addKeyInput, setAddKeyInput]     = useState("");
  const [addKeyLoading, setAddKeyLoading] = useState(false);
  const [addKeyError, setAddKeyError]     = useState<string | null>(null);
  const [addKeyProgress, setAddKeyProgress] = useState<{ current: number; total: number } | null>(null);
  const [newlyAddedKeys, setNewlyAddedKeys] = useState<Set<string>>(new Set());
  const [duplicateKeys, setDuplicateKeys] = useState<Set<string>>(new Set());
  const [customKeys, setCustomKeys]       = useState<Set<string>>(new Set());
  const [hiddenKeys, setHiddenKeys]       = useState<Set<string>>(new Set());
  const [hiddenMeta, setHiddenMeta]       = useState<{ key: string; summary: string }[]>([]);
  const [showHiddenPanel, setShowHiddenPanel] = useState(false);
  const isResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      setSidebarWidth(Math.min(700, Math.max(280, startW + delta)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  // localStorage 클라이언트 캐시 키 / 최대 보존 시간
  const TICKET_CACHE_KEY = "cc-tickets-v2";
  const CACHE_MAX_MS = 12 * 60 * 60 * 1000; // 12시간

  // API에서 받은 데이터를 상태 + localStorage에 저장 (사용자 추가 티켓 병합)
  function applyApiData(data: { tickets: Ticket[]; fetchedAt?: string }) {
    const at = data.fetchedAt ? new Date(data.fetchedAt) : new Date();
    // hiddenKeys 필터 적용 (KV에서만 로드된 상태 사용)
    const hidden = hiddenKeys;

    setTickets(prev => {
      const jiraKeys = new Set(data.tickets.map(t => t.key));
      // KV에서 이미 로드된 custom tickets(prev에 있는 것) 우선 유지
      const existingExtra = prev.filter(t => !jiraKeys.has(t.key));
      const extraByKey = new Map<string, Ticket>(existingExtra.map(t => [t.key, t]));
      // hiddenKeys 필터 적용
      return [...data.tickets, ...extraByKey.values()].filter(t => !hidden.has(t.key));
    });
    setSyncedAt(at);
    try {
      localStorage.setItem(
        TICKET_CACHE_KEY,
        JSON.stringify({ tickets: data.tickets, fetchedAt: at.toISOString() })
      );
    } catch {}
  }

  // 클라이언트 fetch에 20초 타임아웃 적용 (서버가 오래 걸릴 때 UI가 멈추지 않도록)
  async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // 마운트: localStorage 캐시가 유효하면 사용, 아니면 API (서버 12h 캐시) 호출
  const loadTickets = useCallback(async () => {
    try {
      const raw = localStorage.getItem(TICKET_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as { tickets: Ticket[]; fetchedAt: string };
        if (cached.tickets.length > 0 && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_MAX_MS) {
          setTickets(prev => {
            const jiraKeys = new Set(cached.tickets.map((t: Ticket) => t.key));
            const existingExtra = prev.filter(t => !jiraKeys.has(t.key));
            const extraByKey = new Map<string, Ticket>(existingExtra.map(t => [t.key, t]));
            return [...cached.tickets, ...extraByKey.values()];
          });
          setSyncedAt(new Date(cached.fetchedAt));
          setFetching(false);
          return;
        }
      }
    } catch {}

    setFetching(true);
    setFetchError(null);
    try {
      const res = await apiFetch("/api/jira-tickets");
      const data = await res.json();
      if (!res.ok || data.error) {
        setFetchError(data.error ?? "알 수 없는 오류");
      } else {
        applyApiData(data);
      }
    } catch (e) {
      const isTimeout = e instanceof DOMException && e.name === "AbortError";
      setFetchError(isTimeout
        ? "JIRA 응답 시간 초과 (20초). 강제 업데이트 버튼으로 재시도하세요."
        : "네트워크 오류가 발생했습니다."
      );
    } finally {
      setFetching(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 강제 업데이트: 서버 캐시 무효화 → JIRA 재조회 → 커스텀 티켓도 재조회 → localStorage 갱신
  const forceRefresh = useCallback(async () => {
    setFetching(true);
    setFetchError(null);
    try {
      await fetch("/api/jira-tickets/revalidate", { method: "POST" });
      const res = await apiFetch("/api/jira-tickets");
      const data = await res.json();
      if (!res.ok || data.error) {
        setFetchError(data.error ?? "알 수 없는 오류");
        return;
      }

      // 커스텀 키 목록: KV 우선, 없으면 현재 상태 사용
      let savedCustomKeys: string[] = [...customKeys];
      try {
        const kvRes = await fetch("/api/kv?keys=cc-custom-keys");
        const kvData = await kvRes.json();
        if (Array.isArray(kvData["cc-custom-keys"]) && kvData["cc-custom-keys"].length > 0) {
          savedCustomKeys = kvData["cc-custom-keys"];
          setCustomKeys(new Set(savedCustomKeys));
        }
      } catch {}

      // 배치 결과에 없는 커스텀 티켓만 단건 재조회
      const jiraKeySet = new Set((data.tickets as Ticket[]).map(t => t.key));
      const keysToRefetch = savedCustomKeys.filter(k => !jiraKeySet.has(k));

      const freshCustom: Ticket[] = [];
      await Promise.all(keysToRefetch.map(async (k) => {
        try {
          const r = await apiFetch(`/api/jira-tickets/single?key=${encodeURIComponent(k)}`);
          const d = await r.json();
          if (r.ok && d.ticket) freshCustom.push(d.ticket);
        } catch {}
      }));

      // cc-custom-tickets KV 최신화
      fetch("/api/kv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "cc-custom-tickets", value: freshCustom }),
      }).catch(() => {});

      // 화면 반영 + cc-tickets-v1 갱신
      const at = data.fetchedAt ? new Date(data.fetchedAt) : new Date();
      // hiddenKeys 필터 적용 (삭제된 티켓 재등장 방지)
      const hiddenSync = hiddenKeys;
      setTickets([...(data.tickets as Ticket[]), ...freshCustom].filter(t => !hiddenSync.has(t.key)));
      setSyncedAt(at);
      try {
        localStorage.setItem(
          TICKET_CACHE_KEY,
          JSON.stringify({ tickets: data.tickets, fetchedAt: at.toISOString() })
        );
      } catch {}

      // 시트 우선순위 갱신 + 완료 전환 재정렬 + 누락 티켓 시트 추가
      try {
        const priRes = await fetch("/api/sheet-priorities");
        const priData = await priRes.json();
        const rawPri: Record<string, string> = priData.priorities ?? {};
        const sheetKeySet = new Set<string>(priData.sheetKeys ?? []);
        setPriorityError(priData.error ?? null);

        const allNewTickets = [...(data.tickets as Ticket[]), ...freshCustom];

        // 토큰 없으면 시트 연동 스킵
        if (!priData.error) {
          const ticketMap = new Map(allNewTickets.map(t => [t.key, t.status]));

          // 1. 시트에 없는 티켓 추가 (완료 포함 전체)
          const missingKeys = allNewTickets.map(t => t.key).filter(k => !sheetKeySet.has(k));
          if (missingKeys.length > 0) {
            try {
              const appendRes = await fetch("/api/sheet-append", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ keys: missingKeys }),
              });
              if (appendRes.ok) {
                missingKeys.forEach(k => sheetKeySet.add(k)); // 새로 추가된 키 반영
                setSheetSyncMsg(`시트에 ${missingKeys.length}개 티켓 추가됨`);
                setTimeout(() => setSheetSyncMsg(null), 4000);
              } else {
                console.error("[sheet-append]", await appendRes.json());
              }
            } catch (e) { console.error("[sheet-append]", e); }
          }

          // 2. 우선순위 재정렬 (완료 → "완료", 활성 → 재번호)
          const rebalanced = computeRebalance(rawPri, allNewTickets);

          // 3. 시트에 있지만 B열이 아직 "완료"가 아닌 완료 티켓 → "완료" 기입
          const completedUpdate: Record<string, string> = {};
          for (const key of sheetKeySet) {
            const status = ticketMap.get(key);
            if (status && DONE_PRIORITY_STATUSES.has(status) && rawPri[key] !== "완료") {
              completedUpdate[key] = "완료";
            }
          }

          const sheetUpdate = { ...(rebalanced?.sheetUpdate ?? {}), ...completedUpdate };
          setPriorities(rebalanced?.newState ?? rawPri);

          if (Object.keys(sheetUpdate).length > 0) {
            fetch("/api/sheet-priorities", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ priorities: sheetUpdate }),
            }).catch(() => {});
          }
        } else {
          setPriorities(rawPri);
        }
      } catch {};
      fetch("/api/kv?keys=cc-planning,cc-schedules,cc-memos")
        .then(r => r.json())
        .then(d => {
          if (d["cc-planning"])  setPlanning(d["cc-planning"]);
          if (d["cc-schedules"]) setSchedules(d["cc-schedules"]);
          if (d["cc-memos"])     setMemos(d["cc-memos"]);
        })
        .catch(() => {});
    } catch (e) {
      const isTimeout = e instanceof DOMException && e.name === "AbortError";
      setFetchError(isTimeout
        ? "JIRA 응답 시간 초과 (20초). 잠시 후 다시 시도하세요."
        : "네트워크 오류가 발생했습니다."
      );
    } finally {
      setFetching(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 티켓 키 직접 추가: 입력 → JIRA 단건 조회 → 상태 + localStorage 갱신
  async function addTicket(key: string) {
    const trimmed = key.trim().toUpperCase();
    if (!trimmed) return;
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(trimmed)) {
      setAddKeyError("올바른 형식이 아닙니다. 예: TM-1234");
      return;
    }
    if (tickets.some(t => t.key === trimmed) || customKeys.has(trimmed)) {
      setAddKeyError(`${trimmed}은(는) 이미 등록되어 있습니다.`);
      setAddKeyInput("");
      setDuplicateKeys(new Set([trimmed]));
      setTimeout(() => setDuplicateKeys(new Set()), 3000);
      return;
    }
    setAddKeyLoading(true);
    setAddKeyError(null);
    try {
      const res = await apiFetch(`/api/jira-tickets/single?key=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setAddKeyError(data.error ?? "티켓을 가져올 수 없습니다.");
      } else {
        const newTicket = data.ticket as Ticket;
        const newCustomKeys = new Set([...customKeys, trimmed]);
        setCustomKeys(newCustomKeys);
        setTickets(prev => [...prev, newTicket]);

        // 완료 상태 티켓은 플래닝 자동 완료 처리
        if (["론치완료", "완료", "배포완료"].includes(newTicket.status)) {
          const updatedPlanning = { ...planning, [trimmed]: { design: "완료" as TrackState, dev: "완료" as TrackState } };
          setPlanning(updatedPlanning);
          fetch("/api/kv", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: "cc-planning", value: updatedPlanning }),
          }).catch(() => {});
        }

        const newCustomKeysArr = [...newCustomKeys];
        const currentCustomTickets = tickets.filter(t => customKeys.has(t.key));
        const newCustomTickets = [...currentCustomTickets.filter(t => t.key !== trimmed), newTicket];

        // KV에 저장 (팀 공유)
        fetch("/api/kv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "cc-custom-keys", value: newCustomKeysArr }),
        }).catch(() => {});
        fetch("/api/kv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "cc-custom-tickets", value: newCustomTickets }),
        }).catch(() => {});
        setAddKeyInput("");
        setPlanningTab("플래닝 대기·검토");
        setNewlyAddedKeys(new Set([trimmed]));
        setTimeout(() => setNewlyAddedKeys(new Set()), 3000);

        // 구글 시트 A열에 추가 (실패해도 티켓 추가에 영향 없음)
        fetch("/api/sheet-append", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keys: [trimmed] }),
        }).catch(() => {});

        // 메모가 없을 때만 AI 요약 1회 생성
        const memoVal = memos[trimmed];
        const hasMemo = typeof memoVal === "string" ? !!memoVal.trim() : !!memoVal?.text?.trim();
        if (!hasMemo) {
          setSummaryLoading(prev => new Set([...prev, trimmed]));
          fetch(`/api/ai-summary?key=${encodeURIComponent(trimmed)}`)
            .then(r => {
              console.log("[ai-summary] HTTP status:", r.status, r.statusText);
              return r.json();
            })
            .then(d => {
              console.log("[ai-summary] response body:", d);
              if (d.summary) saveMemoVersion(trimmed, d.summary, true);
            })
            .catch((err) => { console.error("[ai-summary] fetch error:", err); })
            .finally(() => {
              setSummaryLoading(prev => {
                const next = new Set(prev);
                next.delete(trimmed);
                return next;
              });
            });
        }
      }
    } catch (e) {
      const isTimeout = e instanceof DOMException && e.name === "AbortError";
      setAddKeyError(isTimeout ? "요청 시간 초과 (20초)" : "네트워크 오류");
    } finally {
      setAddKeyLoading(false);
    }
  }

  // 다중 티켓 추가 (쉼표/공백 구분)
  async function addTickets(input: string) {
    const keys = input.split(/[\s,]+/).map(k => k.trim().toUpperCase()).filter(Boolean);
    if (keys.length === 0) return;
    if (keys.length === 1) return addTicket(keys[0]);

    const invalid = keys.filter(k => !/^[A-Z][A-Z0-9]*-\d+$/.test(k));
    if (invalid.length > 0) {
      setAddKeyError(`형식 오류: ${invalid.join(", ")} (예: TM-1234)`);
      return;
    }
    const dupKeys = keys.filter(k => tickets.some(t => t.key === k) || customKeys.has(k));
    const newKeys = keys.filter(k => !tickets.some(t => t.key === k) && !customKeys.has(k));

    if (dupKeys.length > 0) {
      setDuplicateKeys(new Set(dupKeys));
      setTimeout(() => setDuplicateKeys(new Set()), 3000);
    }

    if (newKeys.length === 0) {
      setAddKeyError(`이미 등록된 티켓입니다: ${dupKeys.join(", ")}`);
      setAddKeyInput("");
      return;
    }

    setAddKeyLoading(true);
    setAddKeyError(null);
    setAddKeyInput("");
    setAddKeyProgress({ current: 0, total: newKeys.length });

    const fetched: Ticket[] = [];
    const errors: string[] = [];

    for (let i = 0; i < newKeys.length; i++) {
      setAddKeyProgress({ current: i + 1, total: newKeys.length });
      try {
        const res = await apiFetch(`/api/jira-tickets/single?key=${encodeURIComponent(newKeys[i])}`);
        const data = await res.json();
        if (!res.ok || data.error) errors.push(newKeys[i]);
        else fetched.push(data.ticket as Ticket);
      } catch {
        errors.push(newKeys[i]);
      }
    }

    if (fetched.length > 0) {
      const newCustomKeys = new Set([...customKeys, ...fetched.map(t => t.key)]);
      setCustomKeys(newCustomKeys);
      setTickets(prev => [...prev, ...fetched]);

      // 완료 상태 티켓은 플래닝 자동 완료 처리
      const doneTickets = fetched.filter(t => ["론치완료", "완료", "배포완료"].includes(t.status));
      if (doneTickets.length > 0) {
        const updatedPlanning = { ...planning };
        for (const t of doneTickets) {
          updatedPlanning[t.key] = { design: "완료" as TrackState, dev: "완료" as TrackState };
        }
        setPlanning(updatedPlanning);
        fetch("/api/kv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "cc-planning", value: updatedPlanning }),
        }).catch(() => {});
      }

      const newCustomKeysArr = [...newCustomKeys];
      const currentCustomTickets = tickets.filter(t => customKeys.has(t.key));
      const newCustomTickets = [...currentCustomTickets, ...fetched];

      fetch("/api/kv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "cc-custom-keys", value: newCustomKeysArr }) }).catch(() => {});
      fetch("/api/kv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "cc-custom-tickets", value: newCustomTickets }) }).catch(() => {});

      // 신규 추가 티켓 날짜 기록
      const today = new Date().toISOString().split("T")[0];
      const updatedDates = { ...ticketAddedDates };
      for (const t of fetched) if (!updatedDates[t.key]) updatedDates[t.key] = today;
      setTicketAddedDates(updatedDates);
      fetch("/api/kv", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "cc-ticket-added-dates", value: updatedDates }) }).catch(() => {});

      for (const t of fetched) {
        const hasMemo = !!getCurrentMemo(t.key);
        if (!hasMemo) {
          setSummaryLoading(prev => new Set([...prev, t.key]));
          fetch(`/api/ai-summary?key=${encodeURIComponent(t.key)}`)
            .then(r => r.json())
            .then(d => { if (d.summary) saveMemoVersion(t.key, d.summary, true); })
            .catch(() => {})
            .finally(() => { setSummaryLoading(prev => { const n = new Set(prev); n.delete(t.key); return n; }); });
        }
      }
    }

    setAddKeyProgress(null);
    setAddKeyLoading(false);
    if (fetched.length > 0) {
      setPlanningTab("플래닝 대기·검토");
      setNewlyAddedKeys(new Set(fetched.map(t => t.key)));
      setTimeout(() => setNewlyAddedKeys(new Set()), 3000);

      // 구글 시트 A열에 일괄 추가
      fetch("/api/sheet-append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: fetched.map(t => t.key) }),
      }).catch(() => {});
    }
    if (errors.length > 0) setAddKeyError(`추가 실패: ${errors.join(", ")}`);
    else if (dupKeys.length > 0) setAddKeyError(`이미 등록된 티켓 제외: ${dupKeys.join(", ")}`);
  }

  // 사용자 추가 티켓 제거
  function removeTicket(key: string) {
    // 우선순위 재정렬: 삭제 티켓 아래 번호를 -1씩 당김
    const deletedP = parseInt(priorities[key] ?? "");
    if (deletedP > 0) {
      const shifted: Record<string, string> = {};
      Object.entries(priorities).forEach(([k, v]) => {
        if (k === key) return;
        const p = parseInt(v);
        shifted[k] = p > deletedP ? String(p - 1) : v;
      });
      setPriorities(shifted);
      fetch("/api/sheet-priorities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priorities: { ...shifted, [key]: "" } }),
      }).catch(() => {});
    }

    // hiddenMeta에 티켓 정보 저장 (복원용)
    const removedTicket = tickets.find(t => t.key === key);
    const newHiddenMeta = [
      ...hiddenMeta.filter(m => m.key !== key),
      ...(removedTicket ? [{ key: removedTicket.key, summary: removedTicket.summary }] : [{ key, summary: key }]),
    ];
    setHiddenMeta(newHiddenMeta);

    setTickets(prev => prev.filter(t => t.key !== key));
    const newCustomKeys = new Set([...customKeys].filter(k => k !== key));
    setCustomKeys(newCustomKeys);
    // hiddenKeys에 추가 → Jira 재조회 시에도 필터링
    const newHiddenKeys = new Set([...hiddenKeys, key]);
    setHiddenKeys(newHiddenKeys);
    if (selected?.key === key) { setSelected(null); setEditMode(false); }

    const newCustomKeysArr = [...newCustomKeys];
    const newHiddenArr     = [...newHiddenKeys];
    const newCustomTickets = tickets.filter(t => customKeys.has(t.key) && t.key !== key);

    // KV에 저장 (팀 공유)
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-custom-keys", value: newCustomKeysArr }),
    }).catch(() => {});
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-custom-tickets", value: newCustomTickets }),
    }).catch(() => {});
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-hidden-keys", value: newHiddenArr }),
    }).catch(() => {});
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-hidden-meta", value: newHiddenMeta }),
    }).catch(() => {});
  }

  // 숨긴 티켓 복원
  async function restoreTicket(key: string) {
    // hiddenKeys / hiddenMeta에서 제거
    const newHiddenKeys = new Set([...hiddenKeys].filter(k => k !== key));
    const newHiddenMeta = hiddenMeta.filter(m => m.key !== key);
    setHiddenKeys(newHiddenKeys);
    setHiddenMeta(newHiddenMeta);

    const newHiddenArr = [...newHiddenKeys];

    // KV 업데이트
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-hidden-keys", value: newHiddenArr }),
    }).catch(() => {});
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-hidden-meta", value: newHiddenMeta }),
    }).catch(() => {});

    // Jira에서 단건 재조회해서 목록에 추가
    try {
      const res = await apiFetch(`/api/jira-tickets/single?key=${encodeURIComponent(key)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.ticket) {
          setTickets(prev => {
            if (prev.some(t => t.key === key)) return prev;
            return [...prev, data.ticket as Ticket];
          });
        }
      }
    } catch {}
  }



  // 마운트 시 자동 로드
  useEffect(() => { loadTickets(); }, [loadTickets]);

  // 시트 우선순위 로드 (마운트 + 탭 복귀 + 30초 폴링)
  useEffect(() => {
    function fetchPriorities() {
      fetch("/api/sheet-priorities")
        .then(r => r.json())
        .then(d => {
          if (d.priorities) setPriorities(d.priorities);
          setPriorityError(d.error ?? null);
        })
        .catch(() => {});
    }
    fetchPriorities();
    const interval = setInterval(fetchPriorities, 30_000);
    function onVisible() { if (document.visibilityState === "visible") fetchPriorities(); }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // tickets 갱신 시 선택된 티켓도 최신 데이터로 동기화
  useEffect(() => {
    if (selected) {
      const updated = tickets.find(t => t.key === selected.key);
      if (updated && updated !== selected) setSelected(updated);
    }
  }, [tickets]); // eslint-disable-line react-hooks/exhaustive-deps

  // 상세 패널 열림/닫힘 시 좌측 사이드바 토글
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("detail-panel", { detail: { open: !!selected } }));
  }, [selected]);

  // KV + 티켓 로드 완료 후 1회: 진행중/완료 티켓 중 플래닝 미설정 항목을 자동으로 완료 처리
  useEffect(() => {
    if (!kvLoaded || fetching || tickets.length === 0 || planningMigratedRef.current) return;
    planningMigratedRef.current = true;

    const AUTO_DONE = new Set(["론치완료", "완료", "배포완료", "개발중", "In Progress", "QA중"]);
    const updates: Record<string, { design: TrackState; dev: TrackState }> = {};
    for (const t of tickets) {
      if (AUTO_DONE.has(t.status) && !planning[t.key]) {
        updates[t.key] = { design: "완료", dev: "완료" };
      }
    }
    if (Object.keys(updates).length === 0) return;

    const updatedPlanning = { ...planning, ...updates };
    setPlanning(updatedPlanning);
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-planning", value: updatedPlanning }),
    }).catch(() => {});
  }, [kvLoaded, fetching, tickets, planning]);

  useEffect(() => {
    // 공유 데이터: KV에서 로드 (planning, schedules, memos, custom-keys, custom-tickets, planning-notes)
    fetch("/api/kv?keys=cc-planning,cc-schedules,cc-memos,cc-memos-v2,cc-custom-keys,cc-custom-tickets,cc-planning-notes,cc-ticket-notes,cc-etr,cc-agenda,cc-hidden-keys,cc-hidden-meta,cc-ticket-added-dates")
      .then((r) => r.json())
      .then((data) => {
        if (data["cc-planning"])   setPlanning(data["cc-planning"]);
        if (data["cc-schedules"])  setSchedules(data["cc-schedules"]);
        if (data["cc-memos"])      setMemos(data["cc-memos"]);
        if (data["cc-memos-v2"])   setMemoHistory(data["cc-memos-v2"]);
        if (data["cc-etr"])        setEtrMap(data["cc-etr"]);
        if (data["cc-agenda"])     setAgenda(new Set(data["cc-agenda"] as string[]));
        if (data["cc-planning-notes"]) {
          setPlanningNotes(data["cc-planning-notes"]);
        }
        if (data["cc-ticket-notes"]) {
          setTicketNotes(data["cc-ticket-notes"]);
        }

        // hidden keys: KV에서만 로드
        const kvHidden: string[] = Array.isArray(data["cc-hidden-keys"]) ? data["cc-hidden-keys"] : [];
        setHiddenKeys(new Set(kvHidden));
        if (kvHidden.length > 0) {
          setTickets(prev => prev.filter(t => !kvHidden.includes(t.key)));
        }

        // hidden meta (복원용 티켓 정보): KV에서만 로드
        const kvMeta: { key: string; summary: string }[] = Array.isArray(data["cc-hidden-meta"]) ? data["cc-hidden-meta"] : [];
        setHiddenMeta(kvMeta);

        // custom keys: KV에서만 로드
        const kvKeys: string[] = Array.isArray(data["cc-custom-keys"]) ? data["cc-custom-keys"] : [];
        setCustomKeys(new Set(kvKeys));

        // custom tickets: KV에서만 로드
        const kvTickets: Ticket[] = Array.isArray(data["cc-custom-tickets"]) ? data["cc-custom-tickets"] : [];
        if (kvTickets.length > 0) {
          setTickets(prev => {
            const jiraKeys = new Set(prev.map(t => t.key));
            const extra = kvTickets.filter(t => !jiraKeys.has(t.key));
            return extra.length > 0 ? [...prev, ...extra] : prev;
          });
        }
        // cc-ticket-added-dates: 신규 티켓 추가 날짜 추적
        const savedDates: Record<string, string> = data["cc-ticket-added-dates"] ?? {};
        setTicketAddedDates(savedDates);

        setKvLoaded(true);
      })
      .catch(() => {
        setKvLoaded(true);
        // KV 실패 시 기본값으로 초기화 (localStorage 폴백 제거)
      });
  }, []);

  // 새로 추가된 티켓이 생기면 첫 번째 행으로 스크롤
  useEffect(() => {
    if (newlyAddedKeys.size === 0) return;
    const firstKey = [...newlyAddedKeys][0];
    const timer = setTimeout(() => {
      document.querySelector(`[data-ticket-key="${firstKey}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    return () => clearTimeout(timer);
  }, [newlyAddedKeys]);

  useEffect(() => {
    if (duplicateKeys.size === 0) return;
    const firstKey = [...duplicateKeys][0];
    const timer = setTimeout(() => {
      document.querySelector(`[data-ticket-key="${firstKey}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    return () => clearTimeout(timer);
  }, [duplicateKeys]);

  function getRoles(t: Ticket): RoleSchedule[] {
    return schedules[t.key] ?? t.roles ?? [];
  }

  function saveSchedule(key: string, rows: RoleSchedule[]) {
    const updated = { ...schedules, [key]: rows };
    setSchedules(updated);
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-schedules", value: updated }),
    }).catch(() => {});
  }

  function startEdit(focusKey?: string) {
    if (!selected) return;
    const existing = getRoles(selected).map(r => ({ ...r }));
    const existingMap = Object.fromEntries(existing.map(r => [r.role, r]));

    // 마일스톤 3개는 항상 상단 고정 (기존 데이터 있으면 사용, 없으면 빈 기본값)
    const isTicketActive = INPROGRESS_STATUSES.includes(selected.status) ||
      ["론치완료", "완료", "배포완료"].includes(selected.status);
    const milestoneRows: RoleSchedule[] = MILESTONE_ROLES.map(role =>
      existingMap[role] ?? {
        role,
        person: "-",
        start: "",
        end: "",
        status: (isTicketActive && role === "Kick-Off") ? "확인필요" as const : "미정" as const,
      }
    );

    // 나머지 작업 행 (마일스톤 제외), 오래된순 정렬
    const workRows = existing
      .filter(r => !MILESTONE_ROLES.includes(r.role))
      .sort((a, b) => {
        const aS = a.start ? new Date(a.start).getTime() : Infinity;
        const bS = b.start ? new Date(b.start).getTime() : Infinity;
        if (aS !== bS) return aS - bS;
        const aE = a.end ? new Date(a.end).getTime() : Infinity;
        const bE = b.end ? new Date(b.end).getTime() : Infinity;
        return aE - bE;
      });

    setEditRows([...milestoneRows, ...workRows]);
    setEditFocusKey(focusKey ?? null);
    setEditMode(true);
  }

  // 행의 포커스 키 생성 (role + person + start 조합)
  function makeEditFocusKey(r: RoleSchedule) {
    return `${r.role}|||${r.person}|||${r.start ?? ""}`;
  }

  function saveEdit() {
    if (!selected) return;
    const invalid = editRows.find(r => {
      if (!r.role || !r.person) return true;
      // 미정/확인필요 상태는 날짜 불필요
      if (r.status === "미정" || r.status === "확인필요") return false;
      return !r.start || !r.end;
    });
    if (invalid) {
      const missing: string[] = [];
      if (!invalid.role)   missing.push("작업명");
      if (!invalid.person) missing.push("담당자명");
      if (invalid.status !== "미정" && invalid.status !== "확인필요") {
        if (!invalid.start) missing.push("시작일");
        if (!invalid.end)   missing.push("종료일");
      }
      setEditError(`필수 항목을 입력해주세요: ${missing.join(", ")}`);
      return;
    }
    setEditError(null);
    saveSchedule(selected.key, editRows);
    setEditMode(false);
  }

  function updateRow(i: number, field: keyof RoleSchedule, value: string) {
    setEditRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  }

  // 편집 모드 진입 + focusKey 있을 때 → 해당 행으로 스크롤
  useEffect(() => {
    if (!editMode || !editFocusKey) return;
    const timer = setTimeout(() => {
      const focusIdx = editRows.findIndex(r => makeEditFocusKey(r) === editFocusKey);
      if (focusIdx >= 0 && editRowRefs.current[focusIdx]) {
        editRowRefs.current[focusIdx]?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 80); // 렌더 완료 후 스크롤
    return () => clearTimeout(timer);
  }, [editMode, editFocusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // KV 로드 완료 후: 날짜 미기록 티켓에 오늘 날짜 기록 (신규 추가분만 앞으로 추적)
  useEffect(() => {
    if (!kvLoaded || tickets.length === 0) return;
    const today = new Date().toISOString().split("T")[0];
    const missing = tickets.filter(t => !ticketAddedDates[t.key]).map(t => t.key);
    if (missing.length === 0) return;
    const updated = { ...ticketAddedDates };
    for (const key of missing) updated[key] = today;
    setTicketAddedDates(updated);
    fetch("/api/kv", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-ticket-added-dates", value: updated }) }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kvLoaded, tickets.length]);

  // addKeyError 자동 해제 (5초 후)
  useEffect(() => {
    if (!addKeyError) return;
    const t = setTimeout(() => setAddKeyError(null), 5000);
    return () => clearTimeout(t);
  }, [addKeyError]);

  const PLANNING_DONE_STATUSES = new Set(["론치완료", "완료", "배포완료", "개발완료"]);
  const PLANNING_ACTIVE_STATUSES = new Set(["개발중", "In Progress", "QA중", "디자인중", "기획중", "기획완료", "디자인완료"]);

  // key 기준 중복 제거 (배치 + 커스텀 동시 로드 시 race condition 방어)
  const dedupedTickets = useMemo(() => {
    const seen = new Set<string>();
    return tickets.filter(t => {
      if (seen.has(t.key)) return false;
      seen.add(t.key);
      return true;
    });
  }, [tickets]);

  const planningCounts = useMemo(() => {
    const counts: Record<string, number> = { "전체": dedupedTickets.length, "진행 중": 0, "플래닝 대기·검토": 0, "완료": 0, "요청 검토 중": 0 };
    for (const t of dedupedTickets) {
      // ETR 티켓은 "요청 검토 중"에만 집계
      if (t.key.startsWith("ETR-")) { counts["요청 검토 중"]++; continue; }
      const p = getPlanningVal(planning[t.key]);
      const bothDone = (p.design === "완료" || p.design === "대상아님") && (p.dev === "완료" || p.dev === "대상아님");
      const isTicketDone = PLANNING_DONE_STATUSES.has(t.status);
      const isJiraActive = PLANNING_ACTIVE_STATUSES.has(t.status);
      if (isTicketDone) { counts["완료"]++; continue; }
      if (bothDone || isJiraActive) counts["진행 중"]++;
      else counts["플래닝 대기·검토"]++;
    }
    return counts;
  }, [dedupedTickets, planning]); // eslint-disable-line react-hooks/exhaustive-deps

  const allDomains = useMemo(() => {
    const set = new Set(tickets.map((t) => extractDomain(t.summary)));
    return [...set].sort((a, b) => a === "기타" ? 1 : b === "기타" ? -1 : a.localeCompare(b, "ko"));
  }, [tickets]);

  const allTargets = useMemo(() => {
    const set = new Set(tickets.map((t) => extractTarget(t.summary)).filter(Boolean) as string[]);
    return [...set].sort();
  }, [tickets]);

  const allAssignees = useMemo(() => {
    const set = new Set(tickets.map((t) => t.assignee).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [tickets]);

  const DONE_STATUSES      = [...DONE_PRIORITY_STATUSES];
  const INPROGRESS_STATUSES = ["개발중", "In Progress", "QA중"];
  const PLANNED_STATUSES   = ["SUGGESTED", "Backlog", "HOLD", "Postponed", "기획중", "기획완료", "디자인완료", "준비중", "디자인중"];

  // 완료 티켓의 우선순위는 의미 없으므로 진행중·대기 티켓만 남김
  const activePriorities = useMemo(() => {
    return Object.fromEntries(
      Object.entries(priorities).filter(([key]) => {
        const t = tickets.find(t => t.key === key);
        return !t || !DONE_PRIORITY_STATUSES.has(t.status);
      })
    );
  }, [priorities, tickets]); // eslint-disable-line react-hooks/exhaustive-deps

  // statusTab 제외한 필터 (카운트 계산용)
  const preFiltered = useMemo(() => {
    return dedupedTickets.filter((t: Ticket) => {
      if (quarters.size > 0) {
        const isQ2   = Q2_KEYS.has(t.key);
        const isQ1Q2 = Q1Q2_KEYS.has(t.key);
        const wantQ1   = quarters.has("Y26Q1");
        const wantQ2   = quarters.has("Y26Q2");
        const wantQ1Q2 = quarters.has("Q1+Q2");
        const matches =
          (wantQ1   && (!isQ2 || isQ1Q2)) ||
          (wantQ2   && (isQ2 && !isQ1Q2)) ||
          (wantQ1Q2 && isQ1Q2);
        if (!matches) return false;
      }
      // ETR 티켓은 "요청 검토 중" 탭 전용 — 다른 탭(전체 포함)에는 미노출
      const isEtr = t.key.startsWith("ETR-");
      if (planningTab === "요청 검토 중") {
        if (!isEtr) return false;
      } else {
        if (isEtr) return false; // ETR은 전체 포함 모든 탭에서 제외
        if (planningTab !== "전체") {
          const p = getPlanningVal(planning[t.key]);
          const bothDone = (p.design === "완료" || p.design === "대상아님") && (p.dev === "완료" || p.dev === "대상아님");
          const isTicketDone = PLANNING_DONE_STATUSES.has(t.status);
          const isJiraActive = PLANNING_ACTIVE_STATUSES.has(t.status);
          if (planningTab === "진행 중" && !((bothDone || isJiraActive) && !isTicketDone)) return false;
          if (planningTab === "플래닝 대기·검토" && (bothDone || isJiraActive)) return false;
          if (planningTab === "완료" && !isTicketDone) return false;
        }
      }
      if (levels.size > 0 && !levels.has(t.type)) return false;
      if (assigneeFilter.size > 0 && !assigneeFilter.has(t.assignee)) return false;
      if (domainFilter.size > 0 && !domainFilter.has(extractDomain(t.summary))) return false;
      if (targetFilter.size > 0 && !targetFilter.has(extractTarget(t.summary) ?? "")) return false;
      if (projects.size > 0 && !projects.has(t.project)) return false;
      if (statuses.size > 0 && !Array.from(statuses).some((s) => matchStatus(t.status, s))) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!t.summary.toLowerCase().includes(q) && !t.key.toLowerCase().includes(q) && !t.assignee.includes(search)) return false;
      }
      return true;
    });
  }, [dedupedTickets, planningTab, quarters, projects, statuses, levels, assigneeFilter, domainFilter, targetFilter, search, planning]); // eslint-disable-line react-hooks/exhaustive-deps

  // 요약 카드 — 현재 planningTab 기준(preFiltered) 집계, statusTab 무관
  const totalAll        = preFiltered.length;
  const totalDone       = preFiltered.filter((t) => DONE_STATUSES.includes(t.status)).length;
  const totalInProgress = preFiltered.filter((t) => INPROGRESS_STATUSES.includes(t.status)).length;
  const totalPlanned    = preFiltered.filter((t) => PLANNED_STATUSES.includes(t.status)).length;

  const done       = totalDone;
  const inProgress = totalInProgress;
  const planned    = totalPlanned;

  // 최근 2주 기준 날짜
  const TWO_WEEKS_AGO = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 14);
    return d.toISOString().split("T")[0];
  }, []);

  const isRecentTicket = (key: string) => (ticketAddedDates[key] ?? "") >= TWO_WEEKS_AGO;

  // statusTab + 정렬 적용 (렌더용)
  const filtered = useMemo(() => {
    let result = statusTab === "전체" ? [...preFiltered]
      : statusTab === "완료"     ? preFiltered.filter((t) => DONE_STATUSES.includes(t.status))
      : statusTab === "진행중"   ? preFiltered.filter((t) => INPROGRESS_STATUSES.includes(t.status))
      :                            preFiltered.filter((t) => PLANNED_STATUSES.includes(t.status));
    // 검토필요 필터
    if (reviewFilter) result = result.filter(t => getPlanningVal(planning[t.key]).reviewNeeded);
    // 신규 필터
    if (newFilter) result = result.filter(t => isRecentTicket(t.key));
    const dateVal = (v: string | undefined) => (v && v !== "-" ? new Date(v).getTime() : Infinity);
    if (sortBy === "priority") {
      result.sort((a: Ticket, b: Ticket) =>
        parseInt(activePriorities[a.key] ?? "999") - parseInt(activePriorities[b.key] ?? "999")
      );
    } else if (sortBy === "startDate") {
      result.sort((a: Ticket, b: Ticket) => dateVal(a.startDate) - dateVal(b.startDate));
    } else if (sortBy === "eta") {
      result.sort((a: Ticket, b: Ticket) => dateVal(a.eta) - dateVal(b.eta));
    }
    return result;
  }, [preFiltered, statusTab, sortBy, priorities, reviewFilter, newFilter, planning, ticketAddedDates]); // eslint-disable-line react-hooks/exhaustive-deps

  function nowDateStr(): string {
    const now = new Date();
    return `${now.toISOString().slice(0, 10)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  /** cc-memos-v2에 새 버전 추가 */
  function saveMemoVersion(key: string, text: string, isAI = false) {
    const version: MemoVersion = { text, author: isAI ? "AI 자동 요약" : userName, date: nowDateStr(), isAI };
    setMemoHistory(prev => {
      const updated = { ...prev, [key]: [...(prev[key] ?? []), version] };
      fetch("/api/kv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "cc-memos-v2", value: updated }) }).catch(() => {});
      return updated;
    });
  }

  /** 현재(최신) 메모 — cc-memos-v2 우선, 없으면 cc-memos 폴백 */
  function getCurrentMemo(key: string): MemoVersion | null {
    const versions = memoHistory[key];
    if (versions && versions.length > 0) return versions[versions.length - 1];
    const m = memos[key];
    if (!m) return null;
    const text = typeof m === "string" ? m : m.text;
    if (!text) return null;
    const author = typeof m === "string" ? "-" : (m.author ?? "-");
    const date = typeof m === "string" ? "" : (m.date ?? "");
    return { text, author, date };
  }

  /** AI 요약 수동 재생성 */
  const [regenError, setRegenError] = useState<string | null>(null);

  async function regenerateSummary(ticketKey: string) {
    setRegenError(null);
    setSummaryLoading(prev => new Set([...prev, ticketKey]));
    try {
      const res = await apiFetch(`/api/ai-summary?key=${encodeURIComponent(ticketKey)}`);
      const data = await res.json();
      if (data.summary) {
        saveMemoVersion(ticketKey, data.summary, true);
      } else {
        setRegenError(data.error ?? "AI 요약 생성에 실패했습니다.");
      }
    } catch (e) {
      const isTimeout = e instanceof DOMException && e.name === "AbortError";
      setRegenError(isTimeout ? "응답 시간 초과 (20초)" : "네트워크 오류가 발생했습니다.");
    } finally {
      setSummaryLoading(prev => { const n = new Set(prev); n.delete(ticketKey); return n; });
    }
  }

  /** 기존 saveMemo — 하위 호환용으로 유지 */
  function saveMemo(key: string, text: string) {
    saveMemoVersion(key, text, false);
  }

  function savePlanningNotes(updated: Record<string, PlanningNote[]>) {
    setPlanningNotes(updated);
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-planning-notes", value: updated }),
    }).catch(() => {});
  }

  function addPlanningNote(ticketKey: string, text: string) {
    if (!text.trim()) return;
    const now = new Date();
    const date = `${now.toISOString().slice(0, 10)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const note: PlanningNote = { text: text.trim(), author: userName, date };
    const prev = planningNotes[ticketKey] ?? [];
    savePlanningNotes({ ...planningNotes, [ticketKey]: [...prev, note] });
  }

  function deletePlanningNote(ticketKey: string, index: number) {
    const prev = planningNotes[ticketKey] ?? [];
    savePlanningNotes({ ...planningNotes, [ticketKey]: prev.filter((_, i) => i !== index) });
  }

  function saveTicketNotes(updated: Record<string, PlanningNote[]>) {
    setTicketNotes(updated);
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-ticket-notes", value: updated }),
    }).catch(() => {});
  }

  function addTicketNote(ticketKey: string, text: string) {
    if (!text.trim()) return;
    const now = new Date();
    const date = `${now.toISOString().slice(0, 10)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const note: PlanningNote = { text: text.trim(), author: userName, date };
    const prev = ticketNotes[ticketKey] ?? [];
    saveTicketNotes({ ...ticketNotes, [ticketKey]: [...prev, note] });
  }

  function deleteTicketNote(ticketKey: string, index: number) {
    const prev = ticketNotes[ticketKey] ?? [];
    saveTicketNotes({ ...ticketNotes, [ticketKey]: prev.filter((_, i) => i !== index) });
  }



  function savePlanning(key: string, track: "design" | "dev", state: TrackState) {
    const current = getPlanningVal(planning[key]);
    const updated = { ...planning, [key]: { ...current, [track]: state } };
    setPlanning(updated);
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-planning", value: updated }),
    }).catch(() => {});
  }

  function toggleDevTrack(key: string, trackKey: DevTrackKey) {
    const current = getPlanningVal(planning[key]);
    const newDevTracks = { ...current.devTracks };
    if (trackKey in newDevTracks) {
      delete newDevTracks[trackKey];
    } else {
      newDevTracks[trackKey] = "대기중";
    }
    const newDev = Object.keys(newDevTracks).length > 0 ? aggregateDevState(newDevTracks) : current.dev;
    const updated = { ...planning, [key]: { ...current, devTracks: newDevTracks, dev: newDev } };
    setPlanning(updated);
    fetch("/api/kv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "cc-planning", value: updated }) }).catch(() => {});
  }

  function saveDevTrack(key: string, trackKey: DevTrackKey, state: TrackState) {
    const current = getPlanningVal(planning[key]);
    const newDevTracks = { ...current.devTracks, [trackKey]: state };
    const newDev = aggregateDevState(newDevTracks);
    const updated = { ...planning, [key]: { ...current, devTracks: newDevTracks, dev: newDev } };
    setPlanning(updated);
    fetch("/api/kv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "cc-planning", value: updated }) }).catch(() => {});
  }

  function toggleReviewNeeded(key: string) {
    const current = getPlanningVal(planning[key]);
    const updated = { ...planning, [key]: { ...current, reviewNeeded: !current.reviewNeeded } };
    setPlanning(updated);
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-planning", value: updated }),
    }).catch(() => {});
  }

  function saveAgenda(updated: Set<string>) {
    setAgenda(updated);
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-agenda", value: [...updated] }),
    }).catch(() => {});
  }
  function toggleAgenda(key: string) {
    const updated = new Set(agenda);
    if (updated.has(key)) updated.delete(key);
    else updated.add(key);
    saveAgenda(updated);
  }

  function saveEtr(updated: Record<string, TicketRequestInfo>) {
    setEtrMap(updated);
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-etr", value: updated }),
    }).catch(() => {});
  }

  function setEtrSource(ticketKey: string, source: TicketRequestInfo["source"]) {
    const current = etrMap[ticketKey];
    saveEtr({
      ...etrMap,
      [ticketKey]: {
        ...current,
        source,
        etrStatus: source === "ETR" ? (current?.etrStatus ?? "추가필요") : undefined,
        etrTickets: source === "ETR" ? (current?.etrTickets ?? []) : undefined,
      },
    });
  }

  function setEtrStatus(ticketKey: string, status: "추가완료" | "추가필요") {
    const current = etrMap[ticketKey] ?? { source: "ETR" as const };
    saveEtr({ ...etrMap, [ticketKey]: { ...current, etrStatus: status } });
  }

  async function addEtr(ticketKey: string, etrKey: string) {
    const trimmed = etrKey.trim().toUpperCase();
    if (!trimmed) return;
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(trimmed)) { setEtrError("올바른 형식이 아닙니다. 예: ETR-123, OPS-456"); return; }
    const current = etrMap[ticketKey] ?? { source: "ETR" as const };
    const prevTickets = current.etrTickets ?? [];
    if (prevTickets.some(t => t.key === trimmed)) { setEtrError("이미 연결된 티켓입니다."); return; }
    setEtrError(null);
    setEtrInput("");
    setEtrLoading(prev => new Set([...prev, trimmed]));
    try {
      const res = await apiFetch(`/api/jira-tickets/single?key=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      const info: EtrTicketInfo = data.ticket
        ? { key: trimmed, summary: data.ticket.summary, requestDept: data.ticket.requestDept, status: data.ticket.status }
        : { key: trimmed };
      const updated: TicketRequestInfo = { ...current, source: "ETR", etrStatus: "추가완료", etrTickets: [...prevTickets, info] };
      saveEtr({ ...etrMap, [ticketKey]: updated });
    } catch {
      saveEtr({ ...etrMap, [ticketKey]: { ...current, source: "ETR", etrTickets: [...prevTickets, { key: trimmed }] } });
    } finally {
      setEtrLoading(prev => { const n = new Set(prev); n.delete(trimmed); return n; });
    }
  }

  function removeEtr(ticketKey: string, etrKey: string) {
    const current = etrMap[ticketKey];
    if (!current) return;
    saveEtr({ ...etrMap, [ticketKey]: { ...current, etrTickets: (current.etrTickets ?? []).filter(t => t.key !== etrKey) } });
  }

  /** Confluence URL에서 페이지 제목 자동 추출 */
  function extractWikiTitle(url: string): string {
    try {
      const u = new URL(url);
      const segments = u.pathname.split("/").filter(Boolean);
      // /wiki/spaces/SPACE/pages/ID/Page+Title 형태
      const pagesIdx = segments.indexOf("pages");
      if (pagesIdx !== -1 && segments.length > pagesIdx + 2) {
        return decodeURIComponent(segments[pagesIdx + 2]).replace(/\+/g, " ");
      }
      // 마지막 세그먼트라도 사용
      const last = segments[segments.length - 1];
      return last ? decodeURIComponent(last).replace(/[_+]/g, " ") : url;
    } catch {
      return url;
    }
  }

  function addWikiLink(ticketKey: string) {
    const url = wikiInput.trim();
    if (!url) return;
    if (!/^https?:\/\//.test(url)) {
      setWikiError("올바른 URL을 입력해주세요 (https://...)");
      return;
    }
    const title = wikiTitleInput.trim() || extractWikiTitle(url);
    const current = etrMap[ticketKey] ?? { source: "자체발의" as const };
    const prev = current.wikiLinks ?? [];
    if (prev.some(w => w.url === url)) {
      setWikiError("이미 추가된 링크입니다");
      return;
    }
    saveEtr({ ...etrMap, [ticketKey]: { ...current, wikiLinks: [...prev, { url, title }] } });
    setWikiInput("");
    setWikiTitleInput("");
    setWikiError(null);
    setWikiAddOpen(false);
  }

  function removeWikiLink(ticketKey: string, url: string) {
    const current = etrMap[ticketKey];
    if (!current) return;
    saveEtr({ ...etrMap, [ticketKey]: { ...current, wikiLinks: (current.wikiLinks ?? []).filter(w => w.url !== url) } });
  }

  function handleSelect(t: Ticket) {
    const isSame = selected?.key === t.key;
    setSelected(isSame ? null : t);
    setEditMode(false);
    setMemoEditMode(false);
    setMemoCollapsed(true);
    setMemoHistoryOpen(false);
    setRegenError(null);
    setShowFullDoneSchedule(false);
    setNoteInput("");
    setEtrInput("");
    setEtrError(null);
    if (!isSame) {
      setMemoText(getCurrentMemo(t.key)?.text ?? "");
      const p = getPlanningVal(planning[t.key]);
      setPlanningOpen(!(p.design === "완료" && p.dev === "완료"));
    }
  }

  if (fetching && tickets.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: "var(--bg-canvas)" }}>
        <div className="text-center">
          <svg className="w-8 h-8 animate-spin text-indigo-400 mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>JIRA에서 티켓 불러오는 중…</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-subtle)" }}>응답 없으면 20초 후 자동 종료됩니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg-canvas)", color: "var(--text-primary)" }}>
      {/* ── 리스트 패널 ── */}
      <div className={`${isDetailExpanded ? "shrink-0 overflow-hidden" : "flex-1 min-w-0"} px-3 py-8 overflow-hidden`} style={{ background: "var(--bg-canvas)", ...(isDetailExpanded ? { width: "176px" } : {}) }}>
        {isDetailExpanded && (
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-subtle)" }}>티켓</div>
        )}
        <div className={`mb-5 flex items-start justify-between ${isDetailExpanded ? "hidden" : ""}`}>
          <div>
            <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>전체 과제 현황</h2>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>Sub Group: 29CM-P Commerce Core</p>
          </div>
          <div className="flex items-center gap-3 mt-1">
            {priorityError && (
              <span className="text-xs text-red-400">
                {priorityError === "no_token" ? "시트 권한 없음 — 재로그인 필요" : `시트 오류(${priorityError})`}
              </span>
            )}
            {sheetSyncMsg && (
              <span className="text-xs text-green-600 font-medium">{sheetSyncMsg}</span>
            )}
            {syncedAt && (
              <span className="text-xs text-gray-400">
                JIRA 동기화:{" "}
                <span className="text-gray-600 font-medium">
                  {(() => {
                    const now = new Date();
                    const isToday = syncedAt.toDateString() === now.toDateString();
                    const time = syncedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
                    if (isToday) return `오늘 ${time}`;
                    const dow = ["일","월","화","수","목","금","토"][syncedAt.getDay()];
                    return `${syncedAt.getMonth()+1}/${syncedAt.getDate()}(${dow}) ${time}`;
                  })()}
                </span>
              </span>
            )}
            {hiddenMeta.length > 0 && (
              <button
                onClick={() => setShowHiddenPanel(v => !v)}
                title="숨긴 티켓 목록 보기 / 복원"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: showHiddenPanel ? "rgba(251,146,60,0.15)" : "var(--bg-item)",
                  border: `1px solid ${showHiddenPanel ? "#fb923c" : "var(--border-2)"}`,
                  color: showHiddenPanel ? "#fb923c" : "var(--text-muted)",
                }}
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                숨긴 티켓 {hiddenMeta.length}
              </button>
            )}
            <button
              onClick={forceRefresh}
              disabled={fetching}
              title="JIRA에서 즉시 재동기화 (서버 캐시 초기화)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
              style={{ background: "var(--bg-item)", border: "1px solid #30363d", color: "var(--text-primary)" }}
            >
              <svg className={`w-3 h-3 ${fetching ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {fetching ? "Syncing…" : "Jira Sync"}
            </button>
          </div>
        </div>
        {fetchError && (
          <div className="mb-4 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 rounded-lg text-xs text-red-600 dark:text-red-400 font-mono break-all">
            {fetchError}
          </div>
        )}

        {/* 숨긴 티켓 복원 패널 */}
        {showHiddenPanel && hiddenMeta.length > 0 && (
          <div className="mb-4 rounded-xl overflow-hidden" style={{ border: "1px solid rgba(251,146,60,0.3)", background: "rgba(251,146,60,0.05)" }}>
            <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid rgba(251,146,60,0.2)" }}>
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="#fb923c" strokeWidth="2.5">
                  <path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-xs font-semibold" style={{ color: "#fb923c" }}>숨긴 티켓</span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>— 복원하면 목록에 다시 표시됩니다</span>
              </div>
              <button
                onClick={() => setShowHiddenPanel(false)}
                className="text-xs transition-colors"
                style={{ color: "var(--text-subtle)" }}
              >✕</button>
            </div>
            <div className="divide-y" style={{ borderColor: "rgba(251,146,60,0.1)" }}>
              {hiddenMeta.map(m => (
                <div key={m.key} className="flex items-center gap-3 px-4 py-2.5">
                  <a
                    href={`${JIRA_BASE}${m.key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-xs font-mono font-semibold hover:underline"
                    style={{ color: "var(--text-muted)" }}
                    onClick={e => e.stopPropagation()}
                  >
                    {m.key}
                  </a>
                  <span className="flex-1 min-w-0 text-sm truncate" style={{ color: "var(--text-secondary)" }}>{m.summary}</span>
                  <button
                    onClick={() => restoreTicket(m.key)}
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                    style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", color: "#34d399" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(52,211,153,0.2)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(52,211,153,0.1)"; }}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    복원
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 과제 상태 탭 */}
        <div className={`flex gap-1.5 mb-5 ${isDetailExpanded ? "hidden" : ""}`}>
          {([
            { key: "전체",           label: "전체",           desc: "모든 과제 (ETR 제외)" },
            { key: "진행 중",        label: "진행 중",        desc: "플래닝 완료 · 진행 중" },
            { key: "플래닝 대기·검토", label: "플래닝 대기·검토", desc: "플래닝 대기 또는 검토 중" },
            { key: "완료",           label: "완료",           desc: "론치·배포 완료" },
            { key: "요청 검토 중",   label: "요청 검토 중",   desc: "ETR 티켓 — 검토 후 TM 전환" },
          ] as const).map(({ key, label, desc }) => {
            const active = planningTab === key;
            return (
              <button
                key={key}
                onClick={() => setPlanningTab(key)}
                title={desc}
                className="flex-1 py-2.5 px-3 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background: active
                    ? key === "전체" ? "var(--border)"
                    : key === "진행 중" ? "rgba(99,102,241,0.25)"
                    : key === "플래닝 대기·검토" ? "rgba(245,158,11,0.2)"
                    : key === "완료" ? "rgba(16,185,129,0.2)"
                    : "rgba(6,182,212,0.15)"   /* 요청 검토 중 — cyan */
                    : "var(--bg-overlay)",
                  border: `1px solid ${active
                    ? key === "전체" ? "var(--border-2)"
                    : key === "진행 중" ? "rgba(99,102,241,0.5)"
                    : key === "플래닝 대기·검토" ? "rgba(245,158,11,0.4)"
                    : key === "완료" ? "rgba(16,185,129,0.4)"
                    : "rgba(6,182,212,0.45)"
                    : "var(--border)"}`,
                  color: active
                    ? key === "진행 중" ? "#818cf8"
                    : key === "플래닝 대기·검토" ? "#fbbf24"
                    : key === "완료" ? "#34d399"
                    : key === "요청 검토 중" ? "#22d3ee"
                    : "var(--text-primary)"
                    : "var(--text-muted)",
                }}
              >
                {label}
                <span className={`ml-1.5 text-xs font-normal ${active ? "opacity-80" : "opacity-60"}`}>
                  ({planningCounts[key] ?? 0})
                </span>
              </button>
            );
          })}
        </div>

        {/* 빠른 필터 행: 검토필요 + 최근 2주 신규 */}
        {(() => {
          const reviewCount = preFiltered.filter(t => getPlanningVal(planning[t.key]).reviewNeeded).length;
          const newCount    = preFiltered.filter(t => isRecentTicket(t.key)).length;
          if (reviewCount === 0 && !reviewFilter && newCount === 0 && !newFilter) return null;
          return (
            <div className={`flex items-center gap-2 mb-4 ${isDetailExpanded ? "hidden" : ""}`}>
              {(reviewCount > 0 || reviewFilter) && (
                <button
                  onClick={() => setReviewFilter(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: reviewFilter ? "rgba(239,68,68,0.15)" : "var(--bg-overlay)",
                    border: `1px solid ${reviewFilter ? "#f87171" : "var(--border-2)"}`,
                    color: reviewFilter ? "#f87171" : "var(--text-muted)",
                    boxShadow: reviewFilter ? "0 0 0 1px #f87171" : "none",
                  }}
                >
                  ⚡ 검토필요
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                    style={{ background: reviewFilter ? "rgba(239,68,68,0.25)" : "var(--border)", color: reviewFilter ? "#f87171" : "var(--text-subtle)" }}>
                    {reviewCount}
                  </span>
                </button>
              )}
              {(newCount > 0 || newFilter) && (
                <button
                  onClick={() => setNewFilter(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: newFilter ? "rgba(56,189,248,0.15)" : "var(--bg-overlay)",
                    border: `1px solid ${newFilter ? "#38bdf8" : "var(--border-2)"}`,
                    color: newFilter ? "#38bdf8" : "var(--text-muted)",
                    boxShadow: newFilter ? "0 0 0 1px #38bdf8" : "none",
                  }}
                >
                  🆕 최근 2주 신규
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                    style={{ background: newFilter ? "rgba(56,189,248,0.25)" : "var(--border)", color: newFilter ? "#38bdf8" : "var(--text-subtle)" }}>
                    {newCount}
                  </span>
                </button>
              )}
              {(reviewFilter || newFilter) && (
                <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
                  {reviewFilter && newFilter ? "검토필요 + 신규 티켓만 표시 중" : reviewFilter ? "검토필요 티켓만 표시 중" : "최근 2주 신규 티켓만 표시 중"}
                </span>
              )}
            </div>
          );
        })()}

        {/* 아젠다 미팅 서브 뷰 토글 */}
        {agenda.size > 0 && (
          <div className="flex items-center gap-2 mb-4 p-2.5 bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-700/30 rounded-xl">
            <span className="text-xs text-orange-600 dark:text-orange-400 font-medium mr-1">미팅 모드:</span>
            <button
              onClick={() => setAgendaView(false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${!agendaView ? "bg-orange-500 text-white shadow-sm" : "bg-white dark:bg-transparent border border-orange-200 dark:border-orange-700/40 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20"}`}
            >
              플래닝 현황
            </button>
            <button
              onClick={() => setAgendaView(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${agendaView ? "bg-orange-500 text-white shadow-sm" : "bg-white dark:bg-transparent border border-orange-200 dark:border-orange-700/40 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20"}`}
            >
              🗓 아젠다 미팅
              <span className="ml-1 opacity-80">({agenda.size})</span>
            </button>
            {agendaView && (
              <button
                onClick={() => { saveAgenda(new Set()); setAgendaView(false); }}
                className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-transparent border border-red-200 dark:border-red-700/40 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
              >
                미팅 종료 ✕
              </button>
            )}
          </div>
        )}

        {/* 요약 카드 */}
        {/* 요약 카드 — 항상 전체 티켓(dedupedTickets) 기준 Jira 상태 분포 */}
        <div className={`grid grid-cols-4 gap-3 mb-5 ${isDetailExpanded ? "hidden" : ""}`}>
          {([
            { label: "전체",      filterKey: "전체",      count: totalAll,        numColor: "var(--text-primary)", desc: "등록된 전체 티켓" },
            { label: "기획·준비", filterKey: "계획/대기", count: totalPlanned,    numColor: "#fbbf24", desc: "기획중·디자인·HOLD 등" },
            { label: "개발·QA중", filterKey: "진행중",    count: totalInProgress, numColor: "#818cf8", desc: "개발중·QA중·In Progress" },
            { label: "완료",      filterKey: "완료",      count: totalDone,       numColor: "#34d399", desc: "론치·배포·완료 처리됨" },
          ]).map((s) => {
            const active = statusTab === s.filterKey;
            return (
              <button
                key={s.label}
                onClick={() => setStatusTab(active ? "전체" : s.filterKey as typeof statusTab)}
                title={s.desc}
                className="rounded-xl border px-4 py-3 text-left transition-all cursor-pointer"
                style={{
                  background: active ? "var(--bg-item)" : "var(--bg-overlay)",
                  borderColor: active ? "#7c3aed" : "var(--border)",
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{s.label}</p>
                  <p className="text-[10px]" style={{ color: "var(--text-subtle)" }}>{planningTab} 기준</p>
                </div>
                <p className="text-2xl font-bold" style={{ color: s.numColor }}>{s.count}</p>
              </button>
            );
          })}
        </div>

        {/* 필터 */}
        <div className={`flex items-center gap-2 mb-4 flex-wrap ${isDetailExpanded ? "hidden" : ""}`}>
          <MultiSelectDropdown label="분기" items={ALL_QUARTERS} selected={quarters} onToggle={v => setQuarters(p => toggle(p, v))} onClear={() => setQuarters(new Set())} />
          <MultiSelectDropdown label="레벨" items={ALL_LEVELS} selected={levels} onToggle={v => setLevels(p => toggle(p, v))} onClear={() => setLevels(new Set())} />
          <MultiSelectDropdown label="프로젝트" items={ALL_PROJECTS} selected={projects} onToggle={v => setProjects(p => toggle(p, v))} onClear={() => setProjects(new Set())} />
          <MultiSelectDropdown label="상태" items={ALL_STATUSES} selected={statuses} onToggle={v => setStatuses(p => toggle(p, v))} onClear={() => setStatuses(new Set())} />
          <MultiSelectDropdown label="담당자" items={allAssignees} selected={assigneeFilter} onToggle={v => setAssigneeFilter(p => toggle(p, v))} onClear={() => setAssigneeFilter(new Set())} />
          <MultiSelectDropdown label="도메인" items={allDomains} selected={domainFilter} onToggle={v => setDomainFilter(p => toggle(p, v))} onClear={() => setDomainFilter(new Set())} />
          <MultiSelectDropdown label="대상" items={allTargets} selected={targetFilter} onToggle={v => setTargetFilter(p => toggle(p, v))} onClear={() => setTargetFilter(new Set())} />

          <div className="w-px h-4 mx-1 shrink-0" style={{ background: "var(--border-2)" }} />

          {/* 정렬 */}
          <div className="relative" style={{ display: "inline-block" }}>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as typeof sortBy)}
              className="appearance-none pl-2.5 pr-7 py-1.5 rounded-lg text-xs font-medium cursor-pointer border transition-all"
              style={{ background: "var(--bg-item)", borderColor: "#7c3aed", color: "#a78bfa", outline: "none" }}
            >
              <option value="eta">ETA순</option>
              <option value="default">등록순</option>
              <option value="priority">우선순위 P1↑</option>
              <option value="startDate">시작일순</option>
            </select>
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px]" style={{ color: "#a78bfa" }}>▾</span>
          </div>

          {/* 검색 */}
          <div className="relative ml-1">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              type="text"
              placeholder="티켓 번호 · 제목 · 담당자"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-7 pr-3 py-1.5 rounded-lg text-xs border transition-all"
              style={{ background: "var(--bg-item)", borderColor: "var(--border-2)", color: "var(--text-primary)", outline: "none", width: "190px" }}
            />
          </div>

          {/* 티켓 추가 */}
          <div className="flex items-center gap-1.5 ml-1">
            <input
              type="text"
              placeholder="예: TM-1234, TM-5678"
              value={addKeyInput}
              onChange={e => { setAddKeyInput(e.target.value.toUpperCase()); setAddKeyError(null); }}
              onKeyDown={e => e.key === "Enter" && addTickets(addKeyInput)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-mono border transition-all"
              style={{ background: "var(--bg-item)", borderColor: "var(--border-2)", color: "var(--text-primary)", outline: "none", width: "180px" }}
            />
            {addKeyInput && (
              <button
                onClick={() => { setAddKeyInput(""); setAddKeyError(null); }}
                title="입력 초기화"
                className="flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold transition-colors shrink-0"
                style={{ color: "var(--text-muted)", background: "var(--border-2)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; (e.currentTarget as HTMLElement).style.background = "var(--text-subtle)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; (e.currentTarget as HTMLElement).style.background = "var(--border-2)"; }}
              >×</button>
            )}
            <button
              onClick={() => addTickets(addKeyInput)}
              disabled={addKeyLoading || !addKeyInput.trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
              style={{ background: "#7c3aed", color: "white" }}
            >
              {addKeyLoading ? (addKeyProgress ? `${addKeyProgress.current}/${addKeyProgress.total}` : "추가 중…") : "추가"}
            </button>
            {addKeyError && (() => {
              // 이미 등록된 티켓 키 추출 → 클릭 시 해당 행으로 스크롤
              const dupMatch = addKeyError.match(/^([A-Z][A-Z0-9]*-\d+)은\(는\) 이미 등록/);
              const dupKey   = dupMatch ? dupMatch[1] : null;
              const scrollTo = (key: string) => {
                // ETR 티켓이면 해당 탭으로, 나머지는 전체 탭으로 전환 후 스크롤
                setPlanningTab(key.startsWith("ETR-") ? "요청 검토 중" : "전체");
                setStatusTab("전체");
                setReviewFilter(false);
                setTimeout(() => {
                  document.querySelector(`[data-ticket-key="${key}"]`)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  setDuplicateKeys(new Set([key]));
                  // 하이라이트 끝나면 에러 문구도 함께 제거
                  setTimeout(() => {
                    setDuplicateKeys(new Set());
                    setAddKeyError(null);
                  }, 2500);
                }, 150);
              };
              return (
                <span className="text-xs flex items-center gap-1" style={{ color: "#f87171" }}>
                  {dupKey ? (
                    <>
                      <button
                        onClick={() => scrollTo(dupKey)}
                        className="underline underline-offset-2 font-semibold transition-opacity hover:opacity-70"
                        style={{ color: "#f87171" }}
                        title="목록에서 위치 확인"
                      >
                        {dupKey}
                      </button>
                      은(는) 이미 등록되어 있습니다 ↑
                    </>
                  ) : addKeyError}
                </span>
              );
            })()}
          </div>
        </div>

        {/* 아젠다 미팅 뷰 */}
        {agendaView && (
          <div className="rounded-xl border border-orange-200 dark:border-orange-700/30 overflow-hidden mb-4" style={{ background: "var(--bg-canvas)" }}>
            <div className="px-4 py-3 bg-orange-50 dark:bg-orange-900/15 border-b border-orange-200 dark:border-orange-700/30 flex items-center gap-2">
              <span className="text-sm font-bold text-orange-700 dark:text-orange-400">🗓 아젠다 미팅</span>
              <span className="text-xs text-orange-500 dark:text-orange-400/70">— 논의할 티켓을 순서대로 확인하고 플래닝 상태를 업데이트하세요</span>
            </div>
            {tickets.filter(t => agenda.has(t.key)).length === 0 ? (
              <div className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>아젠다에 등록된 티켓이 없습니다.</div>
            ) : (
              tickets.filter(t => agenda.has(t.key)).map((t, idx) => {
                const p = getPlanningVal(planning[t.key]);
                const isDiscussed = p.design === "완료" && p.dev === "완료";
                return (
                  <div key={t.key} className={`border-b border-orange-100 dark:border-orange-700/20 last:border-0 transition-colors ${isDiscussed ? "bg-green-50 dark:bg-green-900/10" : ""}`} style={isDiscussed ? {} : { background: "var(--bg-canvas)" }}>
                    <div className="flex items-start gap-3 px-4 py-3">
                      <span className="shrink-0 w-5 text-center text-xs text-orange-400 font-mono mt-1">{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <a
                            href={`${JIRA_BASE}${t.key}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-xs text-blue-500 hover:underline shrink-0"
                          >
                            {t.key}
                          </a>
                          <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{t.summary}</span>
                          {isDiscussed && (
                            <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-700/40">논의 완료</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-xs text-gray-500 dark:text-gray-500">디자인</span>
                          <div className="flex gap-1">
                            {TRACK_STATES.map(s => (
                              <button
                                key={s}
                                onClick={() => savePlanning(t.key, "design", s)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${p.design === s
                                  ? s === "완료" ? "bg-green-500 text-white border-green-500" : s === "검토중" ? "bg-violet-500 text-white border-violet-500" : "bg-gray-500 text-white border-gray-500"
                                  : "bg-white dark:bg-transparent text-gray-500 dark:text-gray-500 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500"}`}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                          <span className="text-xs text-gray-500 dark:text-gray-500 ml-2">개발</span>
                          <div className="flex gap-1">
                            {TRACK_STATES.map(s => (
                              <button
                                key={s}
                                onClick={() => savePlanning(t.key, "dev", s)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${p.dev === s
                                  ? s === "완료" ? "bg-green-500 text-white border-green-500" : s === "검토중" ? "bg-blue-500 text-white border-blue-500" : "bg-gray-500 text-white border-gray-500"
                                  : "bg-white dark:bg-transparent text-gray-500 dark:text-gray-500 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500"}`}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                          <button
                            onClick={() => toggleAgenda(t.key)}
                            className="ml-auto shrink-0 text-xs text-gray-400 dark:text-gray-500 hover:text-orange-400 transition-colors"
                            title="아젠다에서 제거"
                          >
                            ✕ 제거
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 최근 2주 신규 고정 섹션 — newFilter ON이면 중복이므로 숨김 */}
        {!newFilter && !isDetailExpanded && (() => {
          const recentInTab = preFiltered.filter(t => isRecentTicket(t.key));
          if (recentInTab.length === 0) return null;
          return (
            <div className="mb-3 rounded-xl overflow-hidden" style={{ border: "1px solid rgba(56,189,248,0.3)", background: "var(--bg-canvas)" }}>
              <button
                onClick={() => setNewSectionOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold transition-colors"
                style={{ background: "rgba(56,189,248,0.08)", borderBottom: newSectionOpen ? "1px solid rgba(56,189,248,0.2)" : "none", color: "#38bdf8" }}
              >
                <span className="flex items-center gap-2">
                  🆕 최근 2주 신규 추가
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: "rgba(56,189,248,0.2)", color: "#38bdf8" }}>
                    {recentInTab.length}
                  </span>
                </span>
                <svg className={`w-3.5 h-3.5 transition-transform ${newSectionOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {newSectionOpen && (
                <div>
                  {recentInTab.map(t => (
                    <div
                      key={t.key}
                      onClick={() => handleSelect(t)}
                      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors"
                      style={{ borderBottom: "1px solid #21262d" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-item)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ""; }}
                    >
                      <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(56,189,248,0.15)", color: "#38bdf8", border: "1px solid rgba(56,189,248,0.3)" }}>
                        {ticketAddedDates[t.key]?.slice(5).replace("-", "/")} 추가
                      </span>
                      <a href={`${JIRA_BASE}${t.key}`} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="font-mono text-sm font-semibold text-blue-400 hover:underline shrink-0">{t.key}</a>
                      <span className="text-base font-semibold truncate flex-1 min-w-0" style={{ color: "#f0f6fc" }}>{t.summary}</span>
                      <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>{t.assignee}</span>
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${STATUS_COLOR[t.status] ?? "bg-gray-100 text-gray-500"}`}>{t.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* 티켓 목록 */}
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #21262d", background: "var(--bg-canvas)" }}>
          {/* 헤더 */}
          <div className="flex items-center px-4 py-2.5 text-xs font-semibold" style={{ background: "var(--bg-overlay)", borderBottom: "1px solid #21262d", color: "var(--text-subtle)" }}>
            {isDetailExpanded ? (
              <span className="flex-1 min-w-0">티켓</span>
            ) : (
              <>
                <span className="w-6 shrink-0 text-center" title="아젠다 체크">🗓</span>
                <span className="w-8 shrink-0 text-center">#</span>
                <span className="w-32 shrink-0">티켓</span>
                <span className="flex-1 min-w-0">제목</span>
                <span className="w-20 shrink-0 text-center">레벨</span>
                <span className="w-16 shrink-0 text-center">프로젝트</span>
                <span className="w-20 shrink-0 text-center">담당자</span>
                <span className="w-36 shrink-0 text-center">상태</span>
                <span className="w-28 shrink-0 text-center">시작일</span>
                <span className="w-28 shrink-0 text-center">ETA</span>
                <span className="w-6 shrink-0" />
              </>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm" style={{ color: "var(--text-subtle)" }}>검색 결과가 없습니다.</div>
          ) : (
            filtered.map((t, idx) => {
              const isSelected = selected?.key === t.key;
              const isNew = newlyAddedKeys.has(t.key);
              const isDuplicate = duplicateKeys.has(t.key);
              const tp = getPlanningVal(planning[t.key]);
              const planningComplete = tp.design === "완료" && tp.dev === "완료";
              const ticketDone = ["론치완료", "완료", "배포완료"].includes(t.status);
              const showAgenda = !planningComplete && !ticketDone;

              // ETA 경고: 완료/진행중 상태가 아닌데 ETA가 경과·임박한 경우
              const todayStr = new Date().toISOString().split("T")[0];
              const in7Days  = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
              const hasEta   = t.eta && t.eta !== "-";
              const isNotProgressOrDone = !INPROGRESS_STATUSES.includes(t.status) && !PLANNING_DONE_STATUSES.has(t.status);
              const isEtaOverdue   = hasEta && t.eta! < todayStr && isNotProgressOrDone;
              const isEtaImminent  = hasEta && t.eta! >= todayStr && t.eta! <= in7Days && isNotProgressOrDone;
              const etaWarnLevel   = isEtaOverdue ? "overdue" : isEtaImminent ? "imminent" : null;

              const rowBg = isSelected ? "var(--bg-item)"
                : isDuplicate  ? "rgba(245,158,11,0.08)"
                : isNew        ? "rgba(16,185,129,0.08)"
                : isEtaOverdue ? "rgba(239,68,68,0.05)"
                : isEtaImminent ? "rgba(245,158,11,0.05)"
                : undefined;

              return (
                <div
                  key={t.key}
                  data-ticket-key={t.key}
                  className={`cursor-pointer transition-colors duration-700 ${isDuplicate ? "ring-1 ring-inset ring-amber-700/40" : ""}`}
                  style={{
                    borderBottom: "1px solid #21262d",
                    borderLeft: etaWarnLevel === "overdue" ? "3px solid #f87171"
                              : etaWarnLevel === "imminent" ? "3px solid #fbbf24"
                              : "3px solid transparent",
                    background: rowBg,
                  }}
                  onClick={() => handleSelect(t)}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "var(--bg-item)"; }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = rowBg ?? ""; }}
                >
                  {/* 메인 행 */}
                  <div
                    className="flex items-center px-4 py-3"
                  >
                    {isDetailExpanded ? (
                      /* 축소 뷰: 티켓 번호만 */
                      <a
                        href={`${JIRA_BASE}${t.key}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 min-w-0 font-mono text-xs text-blue-500 hover:underline truncate"
                      >
                        {t.key}
                      </a>
                    ) : (
                      /* 기본 뷰: 전체 컬럼 */
                      <>
                        {showAgenda ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleAgenda(t.key); }}
                            title={agenda.has(t.key) ? "아젠다에서 제거" : "아젠다에 추가"}
                            className={`w-6 shrink-0 flex items-center justify-center text-base transition-all rounded ${agenda.has(t.key) ? "opacity-100" : "opacity-20 hover:opacity-60"}`}
                          >
                            🗓
                          </button>
                        ) : (
                          <span className="w-6 shrink-0" />
                        )}
                        <span className="w-8 shrink-0 text-center text-xs font-mono" style={{ color: "var(--text-subtle)" }}>{idx + 1}</span>
                        <a
                          href={`${JIRA_BASE}${t.key}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="w-32 shrink-0 font-mono text-sm font-semibold text-blue-400 hover:text-blue-300 hover:underline"
                        >
                          {t.key}
                        </a>
                        {isNew && (
                          <span className="shrink-0 mr-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-300 animate-pulse">
                            추가됨
                          </span>
                        )}
                        {activePriorities[t.key] && (
                          <span className="shrink-0 mr-2 px-1.5 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200 font-mono">
                            P{activePriorities[t.key]}
                          </span>
                        )}
                        <span className="flex-1 min-w-0 text-base font-semibold truncate pr-3" style={{ color: "#f0f6fc" }}>{t.summary}</span>
                        <span className="w-20 shrink-0 flex justify-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${TYPE_COLOR[t.type] ?? "bg-gray-100 text-gray-500"}`}>
                            {t.type}
                          </span>
                        </span>
                        <span className="w-16 shrink-0 text-xs text-center" style={{ color: "var(--text-muted)" }}>{t.project}</span>
                        <span className="w-20 shrink-0 text-sm font-semibold text-center truncate" style={{ color: "var(--text-primary)" }}>{t.assignee}</span>
                        <span className="w-36 shrink-0 flex justify-center">
                          <span className={`inline-block px-2.5 py-1 rounded-full text-sm font-semibold whitespace-nowrap ${STATUS_COLOR[t.status] ?? "bg-gray-100 text-gray-500"}`}>
                            {t.status}
                          </span>
                        </span>
                        <span className="w-28 shrink-0 text-sm font-medium text-center" style={{ color: t.startDate ? "var(--text-primary)" : "var(--text-subtle)" }}>
                          {t.startDate ? formatDateWithDay(t.startDate) : "미정"}
                        </span>
                        <span className="w-28 shrink-0 text-sm font-medium text-center"
                          style={{ color: isEtaOverdue ? "#f87171" : isEtaImminent ? "#fbbf24" : (!t.eta || t.eta === "-") ? "var(--text-subtle)" : "var(--text-primary)",
                                   fontWeight: etaWarnLevel ? 700 : undefined }}>
                          {!t.eta || t.eta === "-" ? "미정" : formatDateWithDay(t.eta)}
                          {isEtaOverdue  && <span className="ml-1 text-[10px]">(!)</span>}
                          {isEtaImminent && <span className="ml-1 text-[10px]">▲</span>}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeTicket(t.key); }}
                          title="목록에서 제거"
                          className="w-6 shrink-0 flex justify-center items-center hover:text-red-400 transition-colors" style={{ color: "var(--text-subtle)" }}
                        >×</button>
                      </>
                    )}
                  </div>

                  {/* 마일스톤 서브 행 */}
                  {!isDetailExpanded && (() => {
                    const isTicketActive = INPROGRESS_STATUSES.includes(t.status) || DONE_STATUSES.includes(t.status);
                    const existingMap = Object.fromEntries(
                      (schedules[t.key] ?? [])
                        .filter(r => MILESTONE_ROLES.includes(r.role))
                        .map(r => [r.role, r])
                    );
                    const hasAnyMilestoneData = Object.keys(existingMap).length > 0;

                    // 플래닝 상태 먼저 계산 (서브행 표시 조건에 사용)
                    const p = getPlanningVal(planning[t.key]);
                    const planningBothDone = p.design === "완료" && p.dev === "완료";
                    // 플래닝이 완전히 종결(완료 or 대상아님)인 경우
                    const planningAllResolved =
                      (p.design === "완료" || p.design === "대상아님") &&
                      (p.dev   === "완료" || p.dev   === "대상아님");

                    // 숨김: 비활성 티켓 + 마일스톤 데이터 없음 + 플래닝 완전 종결
                    // → 그 외는 항상 표시 (대기중/대기중인 2756도 포함)
                    if (!isTicketActive && !hasAnyMilestoneData && planningAllResolved) return null;

                    const milestones: (RoleSchedule & { isMissing?: boolean })[] = MILESTONE_ROLES.map(role => {
                      if (existingMap[role]) return existingMap[role];
                      const defaultStatus = (isTicketActive && role === "Kick-Off")
                        ? "확인필요" as const
                        : "미정" as const;
                      return { role, person: "-", start: "", end: "", status: defaultStatus, isMissing: true };
                    });
                    const trackStyle = (state: string, track: "design" | "dev") => {
                      if (state === "완료")     return { dot: "#34d399", text: "#34d399", bg: "rgba(16,185,129,0.1)",  border: "rgba(16,185,129,0.25)" };
                      if (state === "검토중")   return track === "design"
                        ? { dot: "#ffffff", text: "#ffffff", bg: "rgba(124,58,237,0.75)", border: "rgba(167,139,250,0.8)", shadow: "0 0 0 1px rgba(167,139,250,0.4)" }
                        : { dot: "#ffffff", text: "#ffffff", bg: "rgba(37,99,235,0.75)",  border: "rgba(96,165,250,0.8)",  shadow: "0 0 0 1px rgba(96,165,250,0.4)" };
                      if (state === "대상아님") return { dot: "#6b7280", text: "#6b7280", bg: "rgba(75,85,99,0.08)",   border: "rgba(75,85,99,0.15)" };
                      /* 대기중 → 노란색 강조 */  return { dot: "#fbbf24", text: "#fbbf24", bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.3)" };
                    };
                    const ds = trackStyle(p.design, "design");
                    const dv = trackStyle(p.dev,    "dev");

                    return (
                      // 서브행: px-4(16) + w-6(24) + w-8(32) + w-32(128) = 200px → 타이틀 컬럼 시작에 정렬
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 pb-2.5 pr-4" style={{ paddingLeft: "200px" }}>
                        {/* 검토필요 배지 — 최우선 표시 */}
                        {p.reviewNeeded && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-bold"
                            style={{ background: "rgba(239,68,68,0.15)", border: "1px solid #f87171", color: "#f87171", boxShadow: "0 0 0 1px rgba(248,113,113,0.3)" }}>
                            ⚡ 검토필요
                          </span>
                        )}
                        {/* 마일스톤 — 버튼형 제거, 인라인 텍스트 스타일 */}
                        <span className="inline-flex items-center gap-2.5">
                        {milestones.map((r, mi) => {
                          const isDone      = r.status === "완료";
                          const isMissing   = !r.end || (r as { isMissing?: boolean }).isMissing;
                          const isNeedCheck = isMissing && r.status === "확인필요";
                          const hasDate     = !isMissing && !isDone;
                          const labelText   = isMissing ? r.status : shortDate(r.end);
                          const chipOpacity = isDone ? 0.5 : 1;
                          const dotColor    = isNeedCheck ? "#fb923c" : (MILESTONE_DOT_HEX[r.role] ?? "#6b7280");
                          const nameColor   = isNeedCheck ? "#fb923c" : (MILESTONE_DOT_HEX[r.role] ?? "#9ca3af");
                          // 날짜 확정 → 밝은 흰색 / 미정 → 충분히 밝은 회색 / 확인필요 → 주황
                          const dateColor   = hasDate ? "var(--text-primary)" : isNeedCheck ? "#fb923c" : "#9ca3af";
                          return (
                            <span
                              key={`${r.role}-${mi}`}
                              className="inline-flex items-center gap-1 text-[11px]"
                              style={{ opacity: chipOpacity }}
                            >
                              {mi > 0 && <span className="mr-1" style={{ color: "var(--border-2)" }}>·</span>}
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
                              <span className="font-medium" style={{ color: nameColor }}>{MILESTONE_KO[r.role] ?? r.role}</span>
                              {r.detail && (
                                <span className="opacity-60 max-w-[8rem] truncate" title={r.detail}>({r.detail})</span>
                              )}
                              <span className={hasDate ? "font-semibold" : ""} style={{ color: dateColor }}>{labelText}</span>
                              {isDone && <span style={{ color: "#34d399" }}>✓</span>}
                            </span>
                          );
                        })}
                        </span>

                        {/* 플래닝 상태 배지 */}
                        {(() => {
                          if (isTicketActive) {
                            // 진행중·완료 티켓: 플래닝 완료면 배지 없음 / 미완 트랙만 경고색 강조
                            if (planningBothDone) return null;
                            const wStyle = (state: string, track: "design" | "dev") => {
                              if (state === "검토중") return track === "design"
                                ? { dot: "#ffffff", text: "#ffffff", bg: "rgba(124,58,237,0.75)", border: "rgba(167,139,250,0.8)", shadow: "0 0 0 1px rgba(167,139,250,0.4)" }
                                : { dot: "#ffffff", text: "#ffffff", bg: "rgba(37,99,235,0.75)",  border: "rgba(96,165,250,0.8)",  shadow: "0 0 0 1px rgba(96,165,250,0.4)" };
                              // 대기중 → amber 경고
                              return { dot: "#fbbf24", text: "#fbbf24", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.35)" };
                            };
                            const pending: React.ReactNode[] = [];
                            if (p.design !== "완료" && p.design !== "대상아님") {
                              const ws = wStyle(p.design, "design");
                              pending.push(
                                <span key="pd" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium"
                                  style={{ background: ws.bg, color: ws.text, border: `1px solid ${ws.border}`, boxShadow: (ws as {shadow?:string}).shadow }}>
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.design === "검토중" ? "animate-pulse" : ""}`} style={{ background: ws.dot }} />
                                  Design · {p.design}
                                </span>
                              );
                            }
                            {
                              const devEntries = Object.entries(p.devTracks) as [DevTrackKey, TrackState][];
                              if (devEntries.length > 0) {
                                for (const [tk, state] of devEntries) {
                                  if (state !== "완료" && state !== "대상아님") {
                                    const ws = wStyle(state, "dev");
                                    pending.push(
                                      <span key={`pv-${tk}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium"
                                        style={{ background: ws.bg, color: ws.text, border: `1px solid ${ws.border}`, boxShadow: (ws as {shadow?:string}).shadow }}>
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${state === "검토중" ? "animate-pulse" : ""}`} style={{ background: ws.dot }} />
                                        {tk} · {state}
                                      </span>
                                    );
                                  }
                                }
                              } else if (p.dev !== "완료" && p.dev !== "대상아님") {
                                const ws = wStyle(p.dev, "dev");
                                pending.push(
                                  <span key="pv" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium"
                                    style={{ background: ws.bg, color: ws.text, border: `1px solid ${ws.border}`, boxShadow: (ws as {shadow?:string}).shadow }}>
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.dev === "검토중" ? "animate-pulse" : ""}`} style={{ background: ws.dot }} />
                                    Dev · {p.dev}
                                  </span>
                                );
                              }
                            }
                            if (pending.length === 0) return null;
                            return (
                              <>
                                <span className="mx-1 text-[10px]" style={{ color: "var(--border-2)" }}>|</span>
                                {pending}
                              </>
                            );
                          } else {
                            // 플래닝 대기·검토 티켓: D / Dev 항상 각각 표시
                            // 완료 트랙은 dim, 미완 트랙은 강조
                            return (
                              <>
                                <span className="mx-1 text-[10px]" style={{ color: "var(--border-2)" }}>|</span>
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium"
                                  style={{ background: ds.bg, color: ds.text, border: `1px solid ${ds.border}`, boxShadow: (ds as {shadow?:string}).shadow, opacity: p.design === "완료" || p.design === "대상아님" ? 0.4 : 1 }}>
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.design === "검토중" ? "animate-pulse" : ""}`} style={{ background: ds.dot }} />
                                  Design · {p.design}{p.design === "완료" ? " ✓" : ""}
                                </span>
                                {/* Dev: 서브 트랙 있으면 각각, 없으면 aggregate */}
                                {Object.keys(p.devTracks).length > 0
                                  ? (Object.entries(p.devTracks) as [DevTrackKey, TrackState][]).map(([tk, state]) => {
                                      const tvStyle = trackStyle(state, "dev");
                                      const isDone = state === "완료" || state === "대상아님";
                                      return (
                                        <span key={`tv-${tk}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium"
                                          style={{ background: tvStyle.bg, color: tvStyle.text, border: `1px solid ${tvStyle.border}`, boxShadow: (tvStyle as {shadow?:string}).shadow, opacity: isDone ? 0.4 : 1 }}>
                                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${state === "검토중" ? "animate-pulse" : ""}`} style={{ background: tvStyle.dot }} />
                                          {tk} · {state}{state === "완료" ? " ✓" : ""}
                                        </span>
                                      );
                                    })
                                  : (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium"
                                      style={{ background: dv.bg, color: dv.text, border: `1px solid ${dv.border}`, boxShadow: (dv as {shadow?:string}).shadow, opacity: p.dev === "완료" || p.dev === "대상아님" ? 0.4 : 1 }}>
                                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.dev === "검토중" ? "animate-pulse" : ""}`} style={{ background: dv.dot }} />
                                      Dev · {p.dev}{p.dev === "완료" ? " ✓" : ""}
                                    </span>
                                  )
                                }
                              </>
                            );
                          }
                        })()}
                      </div>
                    );
                  })()}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── 우측 상세 패널 ── */}
      {selected && (
        <div
          className={`shrink-0 sticky top-0 h-screen relative flex flex-col ${isDetailExpanded ? "flex-1" : ""}`}
          style={{ borderLeft: "1px solid #21262d", background: "var(--bg-canvas)", ...(isDetailExpanded ? {} : { width: sidebarWidth }) }}
        >
          {/* 드래그 핸들 + 펼치기/접기 버튼 */}
          <div
            onMouseDown={isResizing}
            className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-indigo-300 active:bg-indigo-400 transition-colors z-10"
          >
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setIsDetailExpanded(v => !v)}
              title={isDetailExpanded ? "접기" : "펼치기"}
              className="absolute top-1/2 -translate-y-1/2 -left-3 w-6 h-12 rounded-full flex items-center justify-center transition-all z-20 text-xs"
              style={{ background: "var(--bg-overlay)", border: "1px solid #30363d", color: "var(--text-muted)" }}
            >
              {isDetailExpanded ? "›" : "‹"}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-5">
            {/* 헤더 */}
            <div className="flex justify-between items-start mb-4">
              <div className="flex-1 pr-2">
                <h3 className="text-base font-bold leading-snug" style={{ color: "var(--text-primary)" }}>{selected.summary}</h3>
                {(() => {
                  const p = getPlanningVal(planning[selected.key]);
                  const showDesign = p.design === "검토중";
                  const showDev    = p.dev    === "검토중";
                  if (!showDesign && !showDev) return null;
                  return (
                    <div className="flex gap-1 mt-1.5">
                      {showDesign && (
                        <span className="px-1.5 py-0.5 rounded text-xs font-medium" style={{ background: "rgba(124,58,237,0.2)", color: "#a78bfa", border: "1px solid rgba(124,58,237,0.3)" }}>
                          Design 검토
                        </span>
                      )}
                      {showDev && (
                        <span className="px-1.5 py-0.5 rounded text-xs font-medium" style={{ background: "rgba(59,130,246,0.2)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.3)" }}>
                          Dev 검토
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
              <button
                onClick={() => { setSelected(null); setEditMode(false); }}
                className="text-lg leading-none shrink-0" style={{ color: "var(--text-muted)" }}
              >×</button>
            </div>

            {/* 메타 정보 */}
            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2">
                <a href={`${JIRA_BASE}${selected.key}`} target="_blank" rel="noopener noreferrer"
                  className="font-mono text-xs text-blue-500 hover:underline">{selected.key}</a>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[selected.status] ?? "bg-gray-100 text-gray-500"}`}>
                  {selected.status}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLOR[selected.type] ?? "bg-gray-100 text-gray-500"}`}>
                  {selected.type}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                {[
                  { label: "담당자",  value: selected.assignee },
                  { label: "프로젝트", value: selected.project },
                  { label: "시작일",  value: selected.startDate ? formatDateWithDay(selected.startDate) : "미정" },
                  { label: "ETA",     value: (!selected.eta || selected.eta === "-") ? "미정" : formatDateWithDay(selected.eta) },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <span style={{ color: "var(--text-muted)" }}>{label} </span>
                    <span className="font-medium" style={{ color: "var(--text-primary)" }}>{value || "-"}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 추가 메타 정보 */}
            <div className="rounded-lg px-3 py-2.5 mb-4 space-y-1.5 text-sm" style={{ background: "var(--bg-overlay)", border: "1px solid #21262d" }}>
              {[
                { label: "Main Subject",  value: selected.requestDept },
                { label: "요청부문",      value: selected.bodyRequestDept },
                { label: "요청 우선순위", value: selected.requestPriority },
                { label: "Story Points",  value: selected.storyPoints?.toString() },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-1">
                  <span className="w-28 shrink-0" style={{ color: "var(--text-muted)" }}>{label}</span>
                  <span className="font-medium" style={{ color: "var(--text-primary)" }}>{value || <span style={{ color: "var(--text-subtle)" }}>-</span>}</span>
                </div>
              ))}
              <div className="flex items-center gap-1">
                <span className="w-28 shrink-0" style={{ color: "var(--text-muted)" }}>상위 항목</span>
                {selected.parent
                  ? <a href={`${JIRA_BASE}${selected.parent}`} target="_blank" rel="noopener noreferrer"
                      className="font-mono text-blue-500 hover:underline">{selected.parent}</a>
                  : <span style={{ color: "var(--text-subtle)" }}>-</span>
                }
              </div>
              <div className="flex items-center gap-1">
                <span className="w-28 shrink-0" style={{ color: "var(--text-muted)" }}>Health Check</span>
                {selected.healthCheck
                  ? <HealthBadge value={selected.healthCheck} />
                  : <span style={{ color: "var(--text-subtle)" }}>-</span>
                }
              </div>
              <div className="flex items-center gap-1">
                <span className="w-28 shrink-0" style={{ color: "var(--text-muted)" }}>2-Pager</span>
                {selected.twoPagerUrl
                  ? <a href={selected.twoPagerUrl} target="_blank" rel="noopener noreferrer"
                      className="text-blue-500 hover:underline truncate">링크 열기</a>
                  : <span style={{ color: "var(--text-subtle)" }}>-</span>
                }
              </div>
              <div className="flex items-center gap-1">
                <span className="w-28 shrink-0" style={{ color: "var(--text-muted)" }}>PRD Link</span>
                {selected.prdUrl
                  ? <a href={selected.prdUrl} target="_blank" rel="noopener noreferrer"
                      className="text-blue-500 hover:underline truncate">링크 열기</a>
                  : <span style={{ color: "var(--text-subtle)" }}>-</span>
                }
              </div>
            </div>

            {/* 요구사항 출처 */}
            <div className="rounded-lg px-3 py-2.5 mb-4 text-xs" style={{ background: "var(--bg-overlay)", border: "1px solid #21262d" }}>
              <p className="font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>요구사항 출처</p>

              {/* 출처 선택 */}
              <div className="flex gap-1.5 mb-3">
                {(["자체발의", "ELT", "ETR"] as const).map(src => {
                  const active = etrMap[selected.key]?.source === src;
                  const label =
                    src === "자체발의" ? "자체발의" :
                    src === "ELT"     ? "ELT 요구사항" :
                                        "외부 부서 요청";
                  // 선택됨: 색조만 남기고 조용하게
                  const activeStyle =
                    src === "자체발의" ? { background: "rgba(99,102,241,0.12)", borderColor: "rgba(99,102,241,0.35)", color: "#818cf8" } :
                    src === "ELT"     ? { background: "rgba(245,158,11,0.12)", borderColor: "rgba(245,158,11,0.35)", color: "#fbbf24" } :
                                        { background: "rgba(59,130,246,0.12)", borderColor: "rgba(59,130,246,0.35)", color: "#60a5fa" };
                  // 미선택: 테두리·텍스트 더 밝게 → 클릭 유도
                  const inactiveStyle = { background: "var(--bg-item)", borderColor: "var(--text-subtle)", color: "var(--text-secondary)" };
                  return (
                    <button
                      key={src}
                      onClick={() => setEtrSource(selected.key, src)}
                      className="flex-1 py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-all"
                      style={active ? activeStyle : inactiveStyle}
                    >{label}</button>
                  );
                })}
              </div>

              {/* ETR 선택 시 하위 영역 */}
              {etrMap[selected.key]?.source === "ETR" && (
                <>
                  {/* 연결된 ETR 티켓 목록 */}
                  {(etrMap[selected.key]?.etrTickets ?? []).length > 0 ? (
                    <div className="space-y-1.5 mb-2">
                      {(etrMap[selected.key]?.etrTickets ?? []).map(t => {
                        const st = t.status ?? "";
                        const stStyle =
                          DONE_STATUSES.includes(st)       ? { bg: "rgba(16,185,129,0.15)", color: "#34d399", border: "rgba(16,185,129,0.35)" } :
                          INPROGRESS_STATUSES.includes(st) ? { bg: "rgba(129,140,248,0.15)", color: "#818cf8", border: "rgba(129,140,248,0.35)" } :
                          PLANNED_STATUSES.includes(st)    ? { bg: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "rgba(251,191,36,0.35)" } :
                                                             { bg: "rgba(75,85,99,0.2)",    color: "#9ca3af", border: "rgba(75,85,99,0.4)" };
                        return (
                          <div key={t.key} className="rounded-lg px-3 py-2.5" style={{ background: "var(--bg-canvas)", border: "1px solid #30363d" }}>
                            {/* 요약 텍스트 — 가장 눈에 띄게 */}
                            {(t.summary || t.requestDept) && (
                              <p className="text-xs font-medium mb-1.5 leading-snug" style={{ color: "var(--text-primary)" }}>
                                {t.requestDept && <span className="mr-1" style={{ color: "var(--text-muted)" }}>[{t.requestDept}]</span>}
                                {t.summary}
                              </p>
                            )}
                            {/* 메타: 키 + 상태 + 삭제 */}
                            <div className="flex items-center gap-2">
                              <a
                                href={`${JIRA_BASE}${t.key}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-[11px] hover:underline shrink-0"
                                style={{ color: "#60a5fa" }}
                              >{t.key}</a>
                              {st && (
                                <span className="rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0" style={{ background: stStyle.bg, color: stStyle.color, border: `1px solid ${stStyle.border}` }}>{st}</span>
                              )}
                              <button
                                onClick={() => removeEtr(selected.key, t.key)}
                                className="ml-auto hover:text-red-400 transition-colors shrink-0 text-[13px]" style={{ color: "var(--text-subtle)" }}
                              >×</button>
                            </div>
                            {!t.summary && !t.requestDept && (
                              <p className="text-[11px] italic" style={{ color: "var(--text-subtle)" }}>정보 없음</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-orange-400 mb-2">외부 요청 티켓 연결 필요</p>
                  )}

                  {/* 티켓 추가 입력 */}
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      placeholder="예: ETR-123, OPS-456"
                      value={etrInput}
                      onChange={(e) => { setEtrInput(e.target.value.toUpperCase()); setEtrError(null); }}
                      onKeyDown={(e) => e.key === "Enter" && addEtr(selected.key, etrInput)}
                      className="flex-1 rounded px-2 py-1 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" style={{ background: "var(--bg-canvas)", border: "1px solid #30363d", color: "var(--text-primary)" }}
                    />
                    <button
                      onClick={() => addEtr(selected.key, etrInput)}
                      disabled={!etrInput.trim() || etrLoading.size > 0}
                      className="px-2.5 py-1 rounded font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                    >{etrLoading.size > 0 ? "조회중…" : "연결"}</button>
                  </div>
                  {etrError && <p className="mt-1 text-red-500">{etrError}</p>}
                </>
              )}

              {/* 관련 주요 문서 연결 섹션 */}
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid #21262d" }}>
                {/* 헤더: 타이틀 + 추가 버튼 */}
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0" style={{ color: "#818cf8" }}>
                      <path fillRule="evenodd" d="M8.914 6.025a.75.75 0 0 1 1.06 0 3.5 3.5 0 0 1 0 4.95l-2 2a3.5 3.5 0 0 1-5.396-4.402.75.75 0 0 1 1.251.827 2 2 0 0 0 3.085 2.514l2-2a2 2 0 0 0 0-2.828.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                      <path fillRule="evenodd" d="M7.086 9.975a.75.75 0 0 1-1.06 0 3.5 3.5 0 0 1 0-4.95l2-2a3.5 3.5 0 0 1 5.396 4.402.75.75 0 0 1-1.251-.827 2 2 0 0 0-3.085-2.514l-2 2a2 2 0 0 0 0 2.828.75.75 0 0 1 0 1.06Z" clipRule="evenodd" />
                    </svg>
                    관련 주요 문서 연결
                  </p>
                  <button
                    onClick={() => { setWikiAddOpen(v => !v); setWikiError(null); setWikiInput(""); setWikiTitleInput(""); }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors"
                    style={wikiAddOpen
                      ? { background: "rgba(124,58,237,0.15)", color: "#a78bfa", border: "1px solid rgba(124,58,237,0.4)" }
                      : { background: "var(--border)", color: "var(--text-muted)", border: "1px solid #30363d" }}
                  >
                    {wikiAddOpen ? "✕ 취소" : "+ 추가"}
                  </button>
                </div>

                {/* 등록된 문서 목록 */}
                {(etrMap[selected.key]?.wikiLinks ?? []).length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {(etrMap[selected.key]?.wikiLinks ?? []).map(w => (
                      <div key={w.url} className="rounded-lg px-3 py-2.5 group" style={{ background: "var(--bg-canvas)", border: "1px solid #30363d" }}>
                        <div className="flex items-start gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#818cf8" }}>
                            <path fillRule="evenodd" d="M8.914 6.025a.75.75 0 0 1 1.06 0 3.5 3.5 0 0 1 0 4.95l-2 2a3.5 3.5 0 0 1-5.396-4.402.75.75 0 0 1 1.251.827 2 2 0 0 0 3.085 2.514l2-2a2 2 0 0 0 0-2.828.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                            <path fillRule="evenodd" d="M7.086 9.975a.75.75 0 0 1-1.06 0 3.5 3.5 0 0 1 0-4.95l2-2a3.5 3.5 0 0 1 5.396 4.402.75.75 0 0 1-1.251-.827 2 2 0 0 0-3.085-2.514l-2 2a2 2 0 0 0 0 2.828.75.75 0 0 1 0 1.06Z" clipRule="evenodd" />
                          </svg>
                          <div className="flex-1 min-w-0">
                            <a
                              href={w.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-xs font-medium hover:underline leading-snug"
                              style={{ color: "var(--text-primary)" }}
                              title={w.url}
                            >{w.title}</a>
                            <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-subtle)" }}>{w.url}</p>
                          </div>
                          <button
                            onClick={() => removeWikiLink(selected.key, w.url)}
                            className="hover:text-red-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100 text-[13px]" style={{ color: "var(--text-subtle)" }}
                          >×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 입력 폼 — 추가 버튼 클릭 시에만 노출 */}
                {wikiAddOpen && (
                  <div className="space-y-1.5 rounded-lg p-2.5" style={{ background: "var(--bg-canvas)", border: "1px solid #30363d" }}>
                    <input
                      autoFocus
                      type="text"
                      placeholder="URL (https://...)"
                      value={wikiInput}
                      onChange={(e) => { setWikiInput(e.target.value); setWikiError(null); }}
                      onKeyDown={(e) => e.key === "Enter" && addWikiLink(selected.key)}
                      className="w-full rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500" style={{ background: "var(--bg-overlay)", border: "1px solid #30363d", color: "var(--text-primary)" }}
                    />
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        placeholder="제목 (비우면 URL에서 자동 추출)"
                        value={wikiTitleInput}
                        onChange={(e) => setWikiTitleInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addWikiLink(selected.key)}
                        className="flex-1 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500" style={{ background: "var(--bg-overlay)", border: "1px solid #30363d", color: "var(--text-primary)" }}
                      />
                      <button
                        onClick={() => addWikiLink(selected.key)}
                        disabled={!wikiInput.trim()}
                        className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-40 transition-colors"
                        style={{ background: "#7c3aed", color: "#fff" }}
                      >저장</button>
                    </div>
                    {wikiError && <p className="text-red-500 text-[11px]">{wikiError}</p>}
                  </div>
                )}

                {/* 문서 없고 폼도 닫혀있을 때 */}
                {(etrMap[selected.key]?.wikiLinks ?? []).length === 0 && !wikiAddOpen && (
                  <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>연결된 문서가 없습니다</p>
                )}
              </div>
            </div>

            <div className="pt-4" style={{ borderTop: "1px solid #21262d" }}>
              {/* 주요 내용 요약 */}
              <div className="mb-4">
                {/* 헤더 */}
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>주요 내용 요약</p>
                  <div className="flex items-center gap-2">
                    {/* AI 재생성 버튼 */}
                    {!memoEditMode && (
                      <button
                        onClick={() => regenerateSummary(selected.key)}
                        disabled={summaryLoading.has(selected.key)}
                        className="flex items-center gap-1 text-xs hover:text-indigo-400 disabled:opacity-40 transition-colors" style={{ color: "var(--text-muted)" }}
                        title="AI로 요약 재생성"
                      >
                        <svg className={`w-3 h-3 ${summaryLoading.has(selected.key) ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        AI 재생성
                      </button>
                    )}
                    {/* 편집 / 저장·취소 */}
                    {!memoEditMode ? (
                      <button
                        onClick={() => { setMemoText(getCurrentMemo(selected.key)?.text ?? ""); setMemoEditMode(true); }}
                        className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                      >{getCurrentMemo(selected.key) ? "편집" : "입력"}</button>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => { saveMemo(selected.key, memoText); setMemoEditMode(false); }}
                          className="text-xs bg-indigo-600 text-white px-2.5 py-1 rounded-lg hover:bg-indigo-700 font-medium"
                        >저장</button>
                        <button onClick={() => setMemoEditMode(false)}
                          className="text-xs px-2 py-1 hover:opacity-80" style={{ color: "var(--text-muted)" }}>취소</button>
                      </div>
                    )}
                  </div>
                </div>

                {/* AI 에러 메시지 */}
                {regenError && !memoEditMode && !summaryLoading.has(selected.key) && (
                  <div className="mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
                    {regenError}
                  </div>
                )}

                {/* 본문 */}
                {memoEditMode ? (
                  <textarea
                    value={memoText}
                    onChange={(e) => setMemoText(e.target.value)}
                    placeholder="주요 내용, 이슈, 결정 사항 등을 입력하세요"
                    rows={6}
                    className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" style={{ background: "var(--bg-canvas)", border: "1px solid #30363d", color: "var(--text-primary)" }}
                  />
                ) : summaryLoading.has(selected.key) ? (
                  <div className="flex items-center gap-2 text-xs text-indigo-400 bg-indigo-50 rounded-lg px-3 py-2">
                    <svg className="animate-spin h-3.5 w-3.5 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    AI가 티켓 내용을 분석하고 있습니다… (최대 30초 소요)
                  </div>
                ) : getCurrentMemo(selected.key) ? (
                  <>
                    {/* 현재 버전 */}
                    {(() => {
                      const cur = getCurrentMemo(selected.key)!;
                      const lines = cur.text.split("\n");
                      const needsCollapse = lines.length > 3;
                      const displayText = needsCollapse && memoCollapsed
                        ? lines.slice(0, 3).join("\n")
                        : cur.text;
                      return (
                        <div className="overflow-visible">
                          <div className="text-sm whitespace-pre-wrap leading-relaxed rounded-lg px-3 py-2.5 mb-1" style={{ color: "var(--text-primary)", background: "var(--bg-overlay)" }}>
                            {displayText}
                          </div>
                          {needsCollapse && (
                            <button
                              onClick={() => setMemoCollapsed(c => !c)}
                              className="text-xs text-indigo-400 hover:text-indigo-600 mb-1.5 transition-colors"
                            >
                              {memoCollapsed ? "더 보기 ▾" : "접기 ▴"}
                            </button>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                              {cur.isAI && <span className="px-1 py-0.5 rounded border" style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8", borderColor: "rgba(99,102,241,0.3)" }}>AI</span>}
                              {cur.author}{cur.date ? ` · ${cur.date}` : ""}
                            </span>
                            {(memoHistory[selected.key]?.length ?? 0) > 1 && (
                              <button
                                onClick={() => setMemoHistoryOpen(o => !o)}
                                className="text-xs hover:opacity-80 transition-colors" style={{ color: "var(--text-muted)" }}
                              >
                                {memoHistoryOpen ? "히스토리 닫기" : `이전 버전 ${(memoHistory[selected.key]?.length ?? 1) - 1}개`}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* 히스토리 */}
                    {memoHistoryOpen && (memoHistory[selected.key]?.length ?? 0) > 1 && (
                      <div className="mt-3 space-y-2 pt-3" style={{ borderTop: "1px solid #21262d" }}>
                        <p className="text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>이전 버전</p>
                        {[...(memoHistory[selected.key] ?? [])].reverse().slice(1).map((v, i) => (
                          <div key={i} className="rounded-lg overflow-visible opacity-70" style={{ border: "1px solid #21262d" }}>
                            <div className="flex items-center justify-between px-3 py-1.5 rounded-t-lg" style={{ background: "var(--bg-overlay)", borderBottom: "1px solid #21262d" }}>
                              <span className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                                {v.isAI && <span className="px-1 py-0.5 rounded text-xs" style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>AI</span>}
                                {v.author}
                              </span>
                              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{v.date}</span>
                            </div>
                            <div className="text-sm whitespace-pre-wrap leading-relaxed px-3 py-2" style={{ color: "var(--text-muted)" }}>{v.text}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs italic" style={{ color: "var(--text-subtle)" }}>입력된 내용이 없습니다</p>
                )}
              </div>

              {/* 메모 */}
              <div className="mb-4 pt-4" style={{ borderTop: "1px solid #21262d" }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>메모</p>

                {(ticketNotes[selected.key] ?? []).length > 0 ? (() => {
                  type Group = { author: string; date: string; items: { text: string; idx: number }[] };
                  const groups: Group[] = [];
                  (ticketNotes[selected.key] ?? []).forEach((note, idx) => {
                    const day = note.date.slice(0, 10);
                    const last = groups[groups.length - 1];
                    if (last && last.author === note.author && last.date === day) {
                      last.items.push({ text: note.text, idx });
                    } else {
                      groups.push({ author: note.author, date: day, items: [{ text: note.text, idx }] });
                    }
                  });
                  return (
                    <div className="space-y-2 mb-2">
                      {groups.map((g, gi) => (
                        <div key={gi} className="rounded-lg overflow-hidden" style={{ border: "1px solid #21262d" }}>
                          <div className="flex items-center justify-between px-3 py-1.5" style={{ background: "var(--bg-overlay)", borderBottom: "1px solid #21262d" }}>
                            <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{g.author}</span>
                            <span className="text-xs" style={{ color: "var(--text-muted)" }}>{g.date}</span>
                          </div>
                          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                            {g.items.map(({ text, idx }) => (
                              <div key={idx} className="group flex items-start gap-2 px-3 py-2">
                                <p className="flex-1 text-sm whitespace-pre-wrap leading-relaxed" style={{ color: "var(--text-primary)" }}>{text}</p>
                                <button
                                  onClick={() => deleteTicketNote(selected.key, idx)}
                                  className="shrink-0 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" style={{ color: "var(--text-subtle)" }}
                                >삭제</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })() : (
                  <p className="text-xs italic mb-2" style={{ color: "var(--text-subtle)" }}>등록된 메모가 없습니다</p>
                )}

                <div className="flex flex-col gap-1.5">
                  <textarea
                    value={ticketNoteInput}
                    onChange={(e) => setTicketNoteInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        addTicketNote(selected.key, ticketNoteInput);
                        setTicketNoteInput("");
                      }
                    }}
                    placeholder="메모를 입력하세요 (⌘+Enter로 등록)"
                    rows={2}
                    className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" style={{ background: "var(--bg-canvas)", border: "1px solid #30363d", color: "var(--text-primary)" }}
                  />
                  <button
                    onClick={() => { addTicketNote(selected.key, ticketNoteInput); setTicketNoteInput(""); }}
                    disabled={!ticketNoteInput.trim()}
                    className="self-end text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
                  >등록</button>
                </div>
              </div>

              {/* 플래닝 상태 */}
              <div className="pt-4 mb-4" style={{ borderTop: "1px solid #21262d" }}>
                <button
                  onClick={() => setPlanningOpen(o => !o)}
                  className="flex items-center justify-between w-full mb-2 group"
                >
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>플래닝 상태</p>
                    {(() => {
                      const p = getPlanningVal(planning[selected.key]);
                      const allDone = (p.design === "완료" || p.design === "대상아님") && (p.dev === "완료" || p.dev === "대상아님");
                      if (!allDone) return null;
                      return (
                        <div className="flex gap-1">
                          <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">플래닝 완료</span>
                          {getRoles(selected).length === 0 && (
                            <span className="text-xs font-medium text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">일정 등록 필요</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  <svg
                    className={`w-3.5 h-3.5 transition-transform ${planningOpen ? "rotate-180" : ""}`} style={{ color: "var(--text-muted)" }}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  >
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>

                {planningOpen && (
                  <>
                <div className="space-y-1.5">
                  {/* Design 행 */}
                  {(() => {
                    const p = getPlanningVal(planning[selected.key]);
                    const current = p.design;
                    return (
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium w-12 shrink-0 text-violet-500">Design</span>
                        {TRACK_STATES.map((s) => {
                          const active = current === s;
                          const activeStyle =
                            s === "완료"     ? { background: "rgba(16,185,129,0.2)",  borderColor: "#34d399", color: "#34d399",  boxShadow: "0 0 0 1px #34d399" } :
                            s === "검토중"   ? { background: "rgba(124,58,237,0.2)",  borderColor: "#a78bfa", color: "#a78bfa", boxShadow: "0 0 0 1px #a78bfa" } :
                            s === "대상아님" ? { background: "var(--bg-item-alt)", borderColor: "var(--text-primary)", color: "var(--text-primary)", boxShadow: "0 0 0 1px #e6edf3" } :
                                               { background: "var(--bg-item-alt)", borderColor: "var(--text-secondary)", color: "var(--text-secondary)", boxShadow: "0 0 0 1px #c9d1d9" };
                          const inactiveStyle = { background: "var(--bg-overlay)", borderColor: "var(--border-2)", color: "var(--text-subtle)", boxShadow: "none" };
                          return (
                            <button key={s} onClick={() => savePlanning(selected.key, "design", s)}
                              className="flex-1 py-1.5 px-2 rounded-lg text-xs font-medium border transition-all hover:opacity-90"
                              style={active ? activeStyle : inactiveStyle}>{s}</button>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* Dev 트랙 선택 + 서브 트랙 */}
                  {(() => {
                    const p = getPlanningVal(planning[selected.key]);
                    const hasAny = Object.keys(p.devTracks).length > 0;
                    return (
                      <div className="pt-1">
                        {/* Dev 헤더 + 트랙 토글 */}
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm font-medium w-12 shrink-0 text-blue-500">Dev</span>
                          <div className="flex gap-1 flex-wrap">
                            {DEV_TRACK_KEYS.map(tk => {
                              const isActive = tk in p.devTracks;
                              return (
                                <button
                                  key={tk}
                                  onClick={() => toggleDevTrack(selected.key, tk)}
                                  className="text-[11px] font-semibold px-2 py-0.5 rounded-full border transition-all"
                                  style={isActive
                                    ? { background: "rgba(59,130,246,0.2)", borderColor: "#60a5fa", color: "#60a5fa" }
                                    : { background: "var(--bg-overlay)", borderColor: "var(--border-2)", color: "var(--text-subtle)" }}
                                >
                                  {isActive ? `${tk} ×` : `+ ${tk}`}
                                </button>
                              );
                            })}
                          </div>
                          {/* 트랙 없을 때 레거시 dev 상태 표시 */}
                          {!hasAny && (
                            <span className="text-[11px] ml-1" style={{ color: "var(--text-subtle)" }}>
                              트랙 미설정 · 현재: {p.dev}
                            </span>
                          )}
                        </div>

                        {/* 선택된 트랙별 상태 버튼 */}
                        {hasAny && (
                          <div className="space-y-1 pl-14">
                            {DEV_TRACK_KEYS.filter(tk => tk in p.devTracks).map(tk => {
                              const current = p.devTracks[tk]!;
                              return (
                                <div key={tk} className="flex items-center gap-1.5">
                                  <span className="text-xs font-semibold w-6 shrink-0" style={{ color: "#60a5fa" }}>{tk}</span>
                                  {TRACK_STATES.map(s => {
                                    const active = current === s;
                                    const activeStyle =
                                      s === "완료"     ? { background: "rgba(16,185,129,0.2)",  borderColor: "#34d399", color: "#34d399",  boxShadow: "0 0 0 1px #34d399" } :
                                      s === "검토중"   ? { background: "rgba(59,130,246,0.2)",  borderColor: "#60a5fa", color: "#60a5fa",  boxShadow: "0 0 0 1px #60a5fa" } :
                                      s === "대상아님" ? { background: "var(--bg-item-alt)", borderColor: "var(--text-primary)", color: "var(--text-primary)", boxShadow: "0 0 0 1px #e6edf3" } :
                                                         { background: "var(--bg-item-alt)", borderColor: "var(--text-secondary)", color: "var(--text-secondary)", boxShadow: "0 0 0 1px #c9d1d9" };
                                    const inactiveStyle = { background: "var(--bg-overlay)", borderColor: "var(--border-2)", color: "var(--text-subtle)", boxShadow: "none" };
                                    return (
                                      <button key={s} onClick={() => saveDevTrack(selected.key, tk, s)}
                                        className="flex-1 py-1 px-1.5 rounded-lg text-[11px] font-medium border transition-all hover:opacity-90"
                                        style={active ? activeStyle : inactiveStyle}>{s}</button>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* 검토필요 토글 */}
                {(() => {
                  const p = getPlanningVal(planning[selected.key]);
                  return (
                    <div className="mt-3 pt-3" style={{ borderTop: "1px solid #21262d" }}>
                      <button
                        onClick={() => toggleReviewNeeded(selected.key)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-semibold transition-all"
                        style={p.reviewNeeded ? {
                          background: "rgba(239,68,68,0.12)",
                          border: "1px solid #f87171",
                          color: "#f87171",
                          boxShadow: "0 0 0 1px rgba(248,113,113,0.25)",
                        } : {
                          background: "var(--bg-overlay)",
                          border: "1px solid #30363d",
                          color: "var(--text-subtle)",
                        }}
                      >
                        <span className="flex items-center gap-1.5">
                          <span>⚡</span>
                          <span>{p.reviewNeeded ? "검토필요 — 스프린트 미팅 논의 대상" : "검토필요 표시"}</span>
                        </span>
                        <span className="text-[10px] font-normal opacity-60">
                          {p.reviewNeeded ? "클릭하여 해제" : "클릭하여 표시"}
                        </span>
                      </button>
                      {p.reviewNeeded && (
                        <p className="mt-1.5 text-[11px]" style={{ color: "var(--text-subtle)" }}>
                          우선순위 또는 임박한 ETA를 고려해 스프린트 미팅에서 논의할 후보로 지정됨
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* 플래닝 코멘트 */}
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>플래닝 코멘트</p>

                  {(planningNotes[selected.key] ?? []).length > 0 ? (() => {
                    type Group = { author: string; date: string; items: { text: string; idx: number }[] };
                    const groups: Group[] = [];
                    (planningNotes[selected.key] ?? []).forEach((note, idx) => {
                      const day = note.date.slice(0, 10);
                      const last = groups[groups.length - 1];
                      if (last && last.author === note.author && last.date === day) {
                        last.items.push({ text: note.text, idx });
                      } else {
                        groups.push({ author: note.author, date: day, items: [{ text: note.text, idx }] });
                      }
                    });
                    return (
                      <div className="space-y-2 mb-2">
                        {groups.map((g, gi) => (
                          <div key={gi} className="rounded-lg overflow-hidden" style={{ border: "1px solid #21262d" }}>
                            <div className="flex items-center justify-between px-3 py-1.5" style={{ background: "var(--bg-overlay)", borderBottom: "1px solid #21262d" }}>
                              <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{g.author}</span>
                              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{g.date}</span>
                            </div>
                            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                              {g.items.map(({ text, idx }) => (
                                <div key={idx} className="group flex items-start gap-2 px-3 py-2">
                                  <p className="flex-1 text-sm whitespace-pre-wrap leading-relaxed" style={{ color: "var(--text-primary)" }}>{text}</p>
                                  <button
                                    onClick={() => deletePlanningNote(selected.key, idx)}
                                    className="shrink-0 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" style={{ color: "var(--text-subtle)" }}
                                  >삭제</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })() : (
                    <p className="text-xs italic mb-2" style={{ color: "var(--text-subtle)" }}>등록된 코멘트가 없습니다</p>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <textarea
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          addPlanningNote(selected.key, noteInput);
                          setNoteInput("");
                        }
                      }}
                      placeholder="논의 내용을 입력하세요 (⌘+Enter로 등록)"
                      rows={2}
                      className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" style={{ background: "var(--bg-canvas)", border: "1px solid #30363d", color: "var(--text-primary)" }}
                    />
                    <button
                      onClick={() => { addPlanningNote(selected.key, noteInput); setNoteInput(""); }}
                      disabled={!noteInput.trim()}
                      className="self-end text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
                    >등록</button>
                  </div>
                </div>
                  </>
                )}
              </div>

              <div className="pt-4" style={{ borderTop: "1px solid #21262d" }}>
              {/* 작업별 일정 헤더 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>작업별 일정</p>
                </div>
                {!editMode ? (
                  <button
                    onClick={() => startEdit()}
                    className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                  >편집</button>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex rounded-lg overflow-hidden text-xs" style={{ border: "1px solid #30363d" }}>
                      <button
                        onClick={() => setEditRows(prev => {
                          const milestones = prev.filter(r => MILESTONE_ROLES.includes(r.role));
                          const works = prev.filter(r => !MILESTONE_ROLES.includes(r.role)).sort((a, b) => {
                            if (!a.start && !b.start) return 0;
                            if (!a.start) return 1;
                            if (!b.start) return -1;
                            return a.start.localeCompare(b.start);
                          });
                          return [...milestones, ...works];
                        })}
                        className="px-2 py-1 hover:opacity-80 transition-colors" style={{ color: "var(--text-muted)" }}
                      >오래된순</button>
                      <button
                        onClick={() => setEditRows(prev => {
                          const milestones = prev.filter(r => MILESTONE_ROLES.includes(r.role));
                          const works = prev.filter(r => !MILESTONE_ROLES.includes(r.role)).sort((a, b) => {
                            if (!a.start && !b.start) return 0;
                            if (!a.start) return 1;
                            if (!b.start) return -1;
                            return b.start.localeCompare(a.start);
                          });
                          return [...milestones, ...works];
                        })}
                        className="px-2 py-1 hover:opacity-80 transition-colors" style={{ color: "var(--text-muted)", borderLeft: "1px solid #30363d" }}
                      >최신순</button>
                    </div>
                    <button onClick={saveEdit}
                      className="text-xs bg-indigo-600 text-white px-2.5 py-1 rounded-lg hover:bg-indigo-700 font-medium">저장</button>
                    <button onClick={() => { setEditMode(false); setEditError(null); }}
                      className="text-xs px-2 py-1 hover:opacity-80" style={{ color: "var(--text-muted)" }}>취소</button>
                  </div>
                )}
              </div>

              {/* 플래닝 완료 + 일정 미등록 안내 */}
              {(() => {
                const p = getPlanningVal(planning[selected.key]);
                if (p.design === "완료" && p.dev === "완료" && getRoles(selected).length === 0 && !editMode) {
                  return (
                    <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5 mb-3 text-xs">
                      <span className="text-orange-700">플래닝이 완료됐어요. 작업별 일정을 입력해주세요.</span>
                      <button
                        onClick={() => startEdit()}
                        className="ml-3 shrink-0 px-2.5 py-1 rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600 transition-colors"
                      >일정 입력</button>
                    </div>
                  );
                }
                return null;
              })()}

              {/* 편집 모드 */}
              {editMode ? (
                <div className="space-y-2">
                  {/* 상단 작업 추가 버튼 */}
                  <button
                    onClick={() => setEditRows(prev => [newRow(), ...prev])}
                    className="w-full text-xs font-medium text-indigo-400 hover:text-indigo-300 rounded-lg py-1.5 transition-colors" style={{ background: "rgba(99,102,241,0.07)", border: "1px dashed rgba(99,102,241,0.3)" }}
                  >+ 작업 추가</button>
                  {editRows.map((row, i) => {
                    const custom    = isCustomRole(row.role);
                    const errRole   = !!editError && !row.role;
                    const errPerson = !!editError && !row.person;
                    const errStart  = !!editError && row.status !== "미정" && !row.start;
                    const errEnd    = !!editError && row.status !== "미정" && !row.end;
                    const errBorder = "border-red-400";
                    const okBorder  = "border-gray-300";
                    const isFocused   = editFocusKey === makeEditFocusKey(row);
                    const isMilestone = MILESTONE_ROLES.includes(row.role);
                    return (
                      <div
                        key={i}
                        ref={el => { editRowRefs.current[i] = el; }}
                        className={`rounded-lg p-2.5 space-y-1.5 transition-colors ${isFocused ? "ring-2 ring-indigo-500" : ""} ${isMilestone ? "ring-1" : ""}`}
                        style={{
                          background: isFocused ? "#1c2440" : "var(--bg-overlay)",
                          ...(isMilestone && !isFocused ? { ringColor: "#818cf8", borderColor: "rgba(129,140,248,0.2)" } : {}),
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          {/* 작업 프리셋 선택 */}
                          <select
                            value={custom ? "직접입력" : row.role}
                            onChange={(e) => {
                              setEditError(null);
                              if (e.target.value === "직접입력") {
                                updateRow(i, "role", "");
                              } else {
                                updateRow(i, "role", e.target.value);
                              }
                            }}
                            className={`text-xs border ${errRole ? errBorder : okBorder} rounded px-1.5 py-1 shrink-0 w-24`} style={{ background: "var(--bg-canvas)", color: "var(--text-primary)" }}
                          >
                            <optgroup label="마일스톤">
                              {MILESTONE_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </optgroup>
                            <optgroup label="팀 작업">
                              {PRESET_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </optgroup>
                            <option value="직접입력">직접입력</option>
                          </select>
                          {/* 직접입력 시: 작업명 입력 */}
                          {custom && (
                            <input
                              value={row.role}
                              onChange={(e) => { setEditError(null); updateRow(i, "role", e.target.value); }}
                              placeholder="작업명"
                              className={`text-xs border ${errRole ? errBorder : okBorder} rounded px-1.5 py-1 w-24 shrink-0`} style={{ background: "var(--bg-canvas)", color: "var(--text-primary)" }}
                            />
                          )}
                          {/* 담당자 */}
                          <input
                            value={row.person}
                            onChange={(e) => { setEditError(null); updateRow(i, "person", e.target.value); }}
                            placeholder="담당자명"
                            className={`text-xs border ${errPerson ? errBorder : okBorder} rounded px-1.5 py-1 w-28 shrink-0`} style={{ background: "var(--bg-canvas)", color: "var(--text-primary)" }}
                          />
                          {/* 상태 — 현재 값에 따라 색상 강조 */}
                          {(() => {
                            const statusColor =
                              row.status === "완료"     ? { bg: "rgba(16,185,129,0.15)",  border: "#34d399",  color: "#34d399"  } :
                              row.status === "진행중"   ? { bg: "rgba(124,58,237,0.15)",  border: "#a78bfa",  color: "#a78bfa"  } :
                              row.status === "예정"     ? { bg: "rgba(59,130,246,0.15)",  border: "#60a5fa",  color: "#60a5fa"  } :
                              row.status === "확인필요" ? { bg: "rgba(251,146,60,0.15)",  border: "#fb923c",  color: "#fb923c"  } :
                              /* 미정 */                  { bg: "rgba(75,85,99,0.15)",    border: "#6b7280",  color: "#9ca3af"  };
                            return (
                              <select
                                value={row.status}
                                onChange={(e) => updateRow(i, "status", e.target.value as RoleSchedule["status"])}
                                className="text-xs rounded px-2 py-1 w-24 shrink-0 font-medium"
                                style={{ background: statusColor.bg, border: `1px solid ${statusColor.border}`, color: statusColor.color }}
                              >
                                {STATUS_OPTIONS.map(s => <option key={s} style={{ background: "var(--bg-item)", color: "var(--text-primary)" }}>{s}</option>)}
                              </select>
                            );
                          })()}
                          {/* 삭제 — 마일스톤은 고정 행이므로 비활성화 */}
                          {isMilestone
                            ? <span className="w-4 shrink-0" />
                            : <button onClick={() => { setEditError(null); setEditRows(prev => prev.filter((_, idx) => idx !== i)); }}
                                className="hover:text-red-400 text-base leading-none shrink-0" style={{ color: "var(--text-subtle)" }}>×</button>
                          }
                        </div>
                        {/* 상세 작업 (프리셋 선택 시에만 표시) */}
                        {!custom && (
                          <div className="flex items-center gap-1.5 pl-1" style={{ borderLeft: "2px solid #30363d" }}>
                            <span className="text-xs shrink-0" style={{ color: "var(--text-subtle)" }}>└</span>
                            <input
                              value={row.detail ?? ""}
                              onChange={(e) => updateRow(i, "detail", e.target.value)}
                              placeholder="상세 작업명 (선택)"
                              className="text-xs rounded px-1.5 py-1 flex-1 min-w-0" style={{ background: "var(--bg-canvas)", border: "1px solid #21262d", color: "var(--text-primary)" }}
                            />
                            <input
                              value={row.detailPerson ?? ""}
                              onChange={(e) => updateRow(i, "detailPerson", e.target.value)}
                              placeholder="담당자 (선택)"
                              className="text-xs rounded px-1.5 py-1 w-20 shrink-0" style={{ background: "var(--bg-canvas)", border: "1px solid #21262d", color: "var(--text-primary)" }}
                            />
                          </div>
                        )}
                        {row.status === "미정" ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-orange-400 italic">기간 산정중 — 날짜 확정 후 상태를 변경해주세요</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs w-6 shrink-0" style={{ color: "var(--text-muted)" }}>시작</span>
                            <input
                              type="date"
                              value={row.start}
                              onChange={(e) => {
                                setEditError(null);
                                const newStart = e.target.value;
                                setEditRows(prev => prev.map((r, idx) => {
                                  if (idx !== i) return r;
                                  // 종료일이 비어있거나 시작일보다 이전이면 종료일도 동기화
                                  const newEnd = (!r.end || r.end < newStart) ? newStart : r.end;
                                  return { ...r, start: newStart, end: newEnd };
                                }));
                              }}
                              className={`text-xs border ${errStart ? errBorder : okBorder} rounded px-2 py-1.5 flex-1`} style={{ background: "var(--bg-canvas)", color: "var(--text-primary)" }}
                            />
                            <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>~</span>
                            <input
                              type="date"
                              value={row.end}
                              min={row.start || undefined}
                              onChange={(e) => { setEditError(null); updateRow(i, "end", e.target.value); }}
                              className={`text-xs border ${errEnd ? errBorder : okBorder} rounded px-2 py-1.5 flex-1`} style={{ background: "var(--bg-canvas)", color: "var(--text-primary)" }}
                            />
                            <label className="flex items-center gap-1 text-xs shrink-0 cursor-pointer select-none hover:opacity-80" style={{ color: "var(--text-muted)" }}>
                              <input
                                type="checkbox"
                                checked={!!row.start && row.end === row.start}
                                onChange={(e) => { if (e.target.checked && row.start) updateRow(i, "end", row.start); }}
                                className="w-3 h-3 accent-indigo-500"
                              />
                              동일
                            </label>
                            <label className="flex items-center gap-1 text-xs text-orange-400 shrink-0 whitespace-nowrap rounded-md px-2 py-0.5" style={{ background: "rgba(251,146,60,0.15)", border: "1px solid rgba(251,146,60,0.3)" }}>
                              🏖 휴가
                              <input
                                type="number"
                                min={0}
                                max={99}
                                value={row.vacationDays ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value === "" ? undefined : Math.max(0, parseInt(e.target.value, 10));
                                  setEditRows(prev => prev.map((r, idx) => idx === i ? { ...r, vacationDays: v } : r));
                                }}
                                placeholder="0"
                                className="w-10 text-xs rounded px-1.5 py-0.5 text-center" style={{ background: "var(--bg-canvas)", border: "1px solid rgba(251,146,60,0.3)", color: "#fb923c" }}
                              />
                              일
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button
                    onClick={() => setEditRows(prev => [...prev, newRow()])}
                    className="w-full text-xs font-medium text-indigo-400 hover:text-indigo-300 rounded-lg py-2 transition-colors" style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)" }}
                  >+ 작업 추가</button>
                  {editError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{editError}</p>
                  )}
                  <div className="flex justify-end items-center gap-2 pt-1" style={{ borderTop: "1px solid #21262d" }}>
                    <button onClick={saveEdit}
                      className="text-xs bg-indigo-600 text-white px-2.5 py-1 rounded-lg hover:bg-indigo-700 font-medium">저장</button>
                    <button onClick={() => { setEditMode(false); setEditError(null); }}
                      className="text-xs px-2 py-1 hover:opacity-80" style={{ color: "var(--text-muted)" }}>취소</button>
                  </div>
                </div>
              ) : (
                /* 뷰 모드: Gantt */
                <>
                  {getRoles(selected).length === 0 && (planning[selected.key] ?? "스프린트 대기중") === "플래닝 완료" && (
                    <p className="mb-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                      작업별 일정과 담당자를 입력해주세요.
                    </p>
                  )}
                  {(() => {
                    const isDone = ["론치완료", "완료", "배포완료"].includes(selected.status);
                    const allRoles = getRoles(selected);
                    const isSummary = isDone && !showFullDoneSchedule;
                    const displayRoles = isSummary
                      ? allRoles.filter(r => MILESTONE_ROLES.includes(r.role))
                      : allRoles;
                    return (
                      <>
                        {isDone && allRoles.length > 0 && (
                          <div className="mb-2 flex items-center justify-between rounded-lg px-3 py-1.5" style={{ background: "var(--bg-overlay)", border: "1px solid #21262d" }}>
                            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                              ✅ 론치 완료 — {isSummary ? "킥오프 · 배포 · 론치 일정만 요약 표시" : "전체 일정 표시 중"}
                            </span>
                            <button
                              onClick={() => setShowFullDoneSchedule(v => !v)}
                              className="text-xs text-indigo-500 hover:text-indigo-700 font-medium shrink-0 ml-3"
                            >
                              {isSummary ? "전체 보기" : "요약 보기"}
                            </button>
                          </div>
                        )}
                        <GanttChart
                          roles={displayRoles}
                          forceShowPastDone={isDetailExpanded}
                          extendedView={isDetailExpanded}
                          fitToContent={isDone && !isDetailExpanded}
                          ticketDone={isDone}
                          ticketActive={INPROGRESS_STATUSES.includes(selected.status) || isDone}
                          onEditRow={r => startEdit(makeEditFocusKey(r))}
                        />
                      </>
                    );
                  })()}
                </>
              )}
            </div>
            </div>
          </div>
          </div>{/* overflow-y-auto */}
        </div>
      )}
    </div>
  );
}
