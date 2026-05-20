"use client";
import { useState, useMemo, useEffect, useCallback, useRef, Fragment } from "react";
import TicketCopyButton from "@/app/components/TicketCopyButton";
import { Tooltip } from "@/app/components/Tooltip";
import { ActivityEntry } from "@/lib/activity";
import { getActionItems } from "@/lib/action-items";
import {
  type TransitionKind,
  type TransitionResult,
  type TicketSnapshot,
  type SnapshotSet,
  TRANSITION_META,
  TRANSITION_GROUPS,
  STRONG_SIGNAL_KINDS,
  buildTicketSnapshot,
  computeAllTransitions,
  selectCompareSnapshot,
  summarizeTransitions,
} from "@/lib/transitions";
import type { WeeklyNote, UpdateCandidate, ScheduleSource, WeeklySourceText } from "@/lib/weekly-types";
import { filterVisibleTickets } from "@/lib/ticket-utils";

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
  // Weekly sync source metadata (optional, backward compatible)
  source?: ScheduleSource;
  sourceWeek?: string;
  manualLocked?: boolean;
  mergeKey?: string;
  lastSeenAt?: string;
  confidence?: "high" | "medium" | "low";
  // Phase taxonomy + resource team 분리 (optional, backward compatible).
  // 기존 row는 없을 수 있음 → infer via inferPhase(role) helper로 fallback.
  phase?: "Kick-Off" | "기획" | "디자인" | "개발" | "QA" | "Release" | "Launch" | "기타";
  resourceTeam?: string | null;
};

// 기존 row에 phase가 없을 때 role 문자열에서 phase를 추정.
// weekly-parser의 extractPhaseAndResource와 일관된 룰 (lib import는 client bundle 부담 → 인라인).
function inferPhase(role: string): RoleSchedule["phase"] {
  const s = (role ?? "").trim();
  if (!s) return undefined;
  if (/kick[-\s]?off|킥\s*오프/i.test(s)) return "Kick-Off";
  if (/release|릴리즈|릴리스|배포/i.test(s)) return "Release";
  if (/launch|론치|런치|오픈/i.test(s))      return "Launch";
  if (/\bqa\b|qc|테스트|test|검수|검증/i.test(s)) return "QA";
  if (/디자인|design|\bui\b|\bux\b/i.test(s)) return "디자인";
  if (/be[-\s]?pp|be[-\s]?sp|be[-\s]?ce|be[-\s]?cfe|fe[-\s]?cfe|fe[-\s]?dfe|fe[-\s]?sotatek|\bbe\b|\bfe\b|메가존|sotatek|core|platform|engineering|\bcfe\b|\bdfe\b|\bsp\b|\bpp\b|mobile|모바일|\bda\b|\bcse\b/i.test(s)
      || /개발|코드\s*리뷰|development|api|^dev$/i.test(s)) return "개발";
  if (/기획|planning|요구사항|정책|product|requirement/i.test(s)) return "기획";
  return undefined;
}

// 기존 row에서 resourceTeam 추정 — role이 phase 단어 그 자체이면 null, 아니면 role.
function inferResourceTeam(role: string): string | null {
  const s = (role ?? "").trim();
  if (!s) return null;
  if (/^(kick[-\s]?off|킥\s*오프|기획|디자인|design|\bqa\b|release|릴리즈|launch|론치|개발|dev)$/i.test(s)) return null;
  return s;
}

// Phase 표시 라벨 (한국어 통일)
const PHASE_LABEL: Record<NonNullable<RoleSchedule["phase"]>, string> = {
  "Kick-Off": "Kick-Off",
  "기획":     "기획",
  "디자인":   "디자인",
  "개발":     "개발",
  "QA":       "QA",
  "Release":  "Release",
  "Launch":   "Launch",
  "기타":     "기타",
};

// Gantt 정렬용 phase 순서 (운영 단계 흐름순)
const PHASE_ORDER: Record<NonNullable<RoleSchedule["phase"]>, number> = {
  "Kick-Off": 0,
  "기획":     1,
  "디자인":   2,
  "개발":     3,
  "QA":       4,
  "Release":  5,
  "Launch":   6,
  "기타":     7,
};

// Focus Queue + Split View 공통: phase 배지 색상 토큰
const PHASE_QUEUE_STYLE: Record<NonNullable<RoleSchedule["phase"]>, { bg: string; color: string }> = {
  "Kick-Off": { bg: "rgba(129,140,248,0.18)", color: "#a5b4fc" },
  "기획":     { bg: "rgba(99,102,241,0.18)",  color: "#818cf8" },
  "디자인":   { bg: "rgba(168,85,247,0.18)",  color: "#c084fc" },
  "개발":     { bg: "rgba(59,130,246,0.18)",  color: "#60a5fa" },
  "QA":       { bg: "rgba(34,197,94,0.18)",   color: "#4ade80" },
  "Release":  { bg: "rgba(249,115,22,0.18)",  color: "#fb923c" },
  "Launch":   { bg: "rgba(16,185,129,0.18)",  color: "#10b981" },
  "기타":     { bg: "rgba(148,163,184,0.18)", color: "#94a3b8" },
};

// ETA urgency 토큰 (overdue / imminent / normal)
const ETA_URGENCY_COLOR = {
  overdue:  "#f87171",
  imminent: "#fbbf24",
  normal:   "var(--text-muted)" as const,
};

// 단일 row가 cleanup 자격 미달인지 판정 (Gantt 노출 차단 + Cleanup panel 후보)
// 정책: manual schedule(source != jira_weekly)은 절대 cleanup 후보 안 됨.
function isCleanupCandidate(row: RoleSchedule): { isCleanup: boolean; reason?: string } {
  if (row.source !== "jira_weekly") return { isCleanup: false };
  const phase = row.phase ?? inferPhase(row.role);
  const EXEC = new Set(["예정", "진행중", "완료"]);
  const NON_SCHEDULE_RE = /PTG plan|yellow 유지|green 전환|red 유지|red 전환|blocker|리소스 부족|리소스 재산정|정책 이슈|조건부 진행|전제 조건|선행 조건/i;
  const combined = `${row.role} ${row.detail ?? ""} ${row.detailPerson ?? ""}`;
  if (!phase || phase === "기타") return { isCleanup: true, reason: `phase "${phase ?? "(없음)"}" — 운영 단계 인식 실패` };
  if (!EXEC.has(row.status))    return { isCleanup: true, reason: `status "${row.status}" — 실행성 아님` };
  if (NON_SCHEDULE_RE.test(combined)) return { isCleanup: true, reason: "non_schedule_indicator — 설명/조건성 문장" };
  if (!row.start && !row.end)   return { isCleanup: true, reason: "no date — 날짜 미확정" };
  if (row.confidence === "low") return { isCleanup: true, reason: "low confidence" };
  return { isCleanup: false };
}

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

// 제목 규칙: [도메인][대상] 제목
// 예) [결제][29CM] 주문 API 개선
function extractTarget(summary: string): string | null {
  // 두 번째 [...]에서 대상 추출 (두 태그 사이 공백 허용)
  const m = summary.match(/^\[[^\]]+\]\s*\[([^\]]+)\]/);
  return m && TARGET_LABELS.has(m[1]) ? m[1] : null;
}

function extractDomain(summary: string): string {
  // 첫 번째 [...]에서 도메인 추출
  const m = summary.match(/^\[([^\]]+)\]/);
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
  // Placeholder section 펼치기 — 기본 접힘 (확정 일정 signal 우선)
  const [showPlaceholders, setShowPlaceholders] = useState(false);

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

  // Gantt 본문은 cleanup 자격 미달 row 제외 (Cleanup panel에서만 표시).
  // 정렬: phase order → 시작일 → resourceTeam → 종료일
  const qualifiedRoles = (roles ?? []).filter(r => !isCleanupCandidate(r).isCleanup);
  const sortedRoles = [...qualifiedRoles].sort((a, b) => {
    const ap = a.phase ?? inferPhase(a.role) ?? "기타";
    const bp = b.phase ?? inferPhase(b.role) ?? "기타";
    const pa = PHASE_ORDER[ap] ?? 99;
    const pb = PHASE_ORDER[bp] ?? 99;
    if (pa !== pb) return pa - pb;
    const aS = a.start ? new Date(a.start).getTime() : Infinity;
    const bS = b.start ? new Date(b.start).getTime() : Infinity;
    if (aS !== bS) return aS - bS;
    const ar = a.resourceTeam ?? inferResourceTeam(a.role) ?? "";
    const br = b.resourceTeam ?? inferResourceTeam(b.role) ?? "";
    if (ar !== br) return ar.localeCompare(br);
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

  // Placeholder 분리 — 미정 / 확인필요 / 날짜 없음 row는 secondary로 다운그레이드.
  // 사용자 정책: 확정 일정 signal을 placeholder가 덮지 않게.
  const isPlaceholderRow = (r: RoleSchedule): boolean => {
    const noDate = !r.start && !r.end;
    const softStatus = r.status === "미정" || r.status === "확인필요";
    return softStatus || noDate;
  };
  const confirmedRoles   = visibleRoles.filter(r => !isPlaceholderRow(r));
  const placeholderRoles = visibleRoles.filter(isPlaceholderRow);

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

      {/* 롤 바 목록 — 확정 일정 우선 (Weekly 반영 / 진행중 / 완료) */}
      <div className="relative">
        {confirmedRoles.length > 0 ? confirmedRoles.map((r, i) => {
          const endMs   = r.end   ? new Date(r.end).getTime()   : null;
          const startMs = r.start ? new Date(r.start).getTime() : null;
          const overdue   = endMs   !== null && endMs   < TODAY_MS && r.status !== "완료";
          const notStarted = startMs !== null && startMs < TODAY_MS && r.status === "예정";
          return (
          <div key={`${r.role}-${r.person}-${i}`} className="mb-2.5 group/ganttrow">
            <div className="flex items-start">
              {/* 좌측: phase (primary) + resourceTeam (sublabel) + person, 세부작업 */}
              <div className="w-48 shrink-0 pt-0.5">
                {(() => {
                  // phase가 있으면 phase를 라벨로, 없으면 role에서 inferPhase
                  // resourceTeam이 있고 phase와 다르면 sublabel로
                  const phase = r.phase ?? inferPhase(r.role);
                  const resourceTeam = r.resourceTeam ?? inferResourceTeam(r.role);
                  const primary = phase ? PHASE_LABEL[phase] : r.role;
                  const showSubResource = !!resourceTeam && resourceTeam !== primary;
                  const isMilestone = MILESTONE_ROLES.includes(r.role)
                    || phase === "Kick-Off" || phase === "Release" || phase === "Launch";
                  return (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-block w-2 h-2 rounded-sm shrink-0 ${ROLE_COLOR[r.role] ?? "bg-gray-400"}`} />
                        <span
                          className={`text-sm font-medium shrink-0 whitespace-nowrap ${showSubResource ? "" : "w-20"} ${isMilestone ? "font-semibold" : ""}`}
                          style={{ color: isMilestone ? "#818cf8" : "var(--text-muted)" }}
                          title={resourceTeam ? `${primary} · ${resourceTeam}` : primary}
                        >
                          {primary}
                        </span>
                        <span className="text-sm whitespace-nowrap" style={{ color: "#9ca3af" }} title={r.person}>{r.person}</span>
                        {/* Weekly-derived 강조 배지 — source=jira_weekly + sourceWeek 있을 때 */}
                        {r.source === "jira_weekly" && r.sourceWeek && (
                          <span
                            className="text-[9px] font-semibold px-1 py-0.5 rounded shrink-0 ml-1"
                            style={{ background: "rgba(129,140,248,0.18)", color: "#a5b4fc", border: "1px solid rgba(129,140,248,0.35)" }}
                            title={`Weekly에서 반영 — ${r.sourceWeek}${r.lastSeenAt ? ` · 최근 갱신 ${new Date(r.lastSeenAt).toLocaleDateString("ko-KR")}` : ""}`}
                          >
                            🟣 {r.sourceWeek}
                          </span>
                        )}
                      </div>
                      {showSubResource && (
                        <p className="text-[10.5px] mt-0.5 pl-3.5 leading-tight" style={{ color: "var(--text-muted)" }} title={resourceTeam ?? undefined}>
                          {resourceTeam}
                        </p>
                      )}
                    </>
                  );
                })()}
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
                  <p className="inline-flex items-center gap-1 text-[11px] whitespace-nowrap mt-0.5 px-1.5 py-0.5 rounded" style={{ background: "var(--bg-overlay)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                    <span>{formatDateWithDay(r.start)}</span>
                    <span style={{ color: "var(--text-subtle)" }}>~</span>
                    <span>{formatDateWithDay(r.end)}</span>
                    {(() => {
                      const total = calcWorkingDays(r.start, r.end);
                      const vac = r.vacationDays ?? 0;
                      const net = Math.max(0, total - vac);
                      return vac > 0
                        ? <><span className="ml-1 font-semibold text-indigo-400">{net}영업일</span><span className="text-orange-400 text-[10px]">(-{vac}휴가)</span></>
                        : <span className="ml-1 font-semibold text-indigo-400">{total}영업일</span>;
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
            <p className="text-xs text-gray-500 py-2">
              {placeholderRoles.length > 0
                ? "확정 일정 없음 — 아래 미확정 일정을 검토하거나 새 일정을 입력해주세요"
                : "일정 데이터 없음 — 작업별 일정 입력 시 표시됩니다"}
            </p>
          </div>
        )}
      </div>

      {/* ── Placeholder section (미확정 일정) ───────────────────────── */}
      {/* 정책: 미정/확인필요/날짜 없음 row는 secondary로 다운그레이드.
              기본 접힘 — 확정 일정 signal이 우선. */}
      {placeholderRoles.length > 0 && (
        <div className="mt-3" style={{ borderTop: "1px dashed var(--border)", paddingTop: "8px" }}>
          <button
            onClick={() => setShowPlaceholders(v => !v)}
            className="flex items-center gap-1.5 text-xs font-medium transition-colors px-2 py-1 rounded-md"
            style={{
              color: showPlaceholders ? "var(--text-secondary)" : "var(--text-subtle)",
              background: "transparent",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-item)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <span style={{ display: "inline-block", width: 0, transform: showPlaceholders ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>▸</span>
            <span>미확정 일정</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: "rgba(148,163,184,0.15)", color: "#94a3b8" }}>
              {placeholderRoles.length}
            </span>
            <span className="text-[10px]" style={{ color: "var(--text-subtle)" }}>
              미정 / 확인필요 / 날짜 미입력
            </span>
          </button>
          {showPlaceholders && (
            <div className="mt-2 grid gap-y-1 px-2" style={{ gridTemplateColumns: "auto auto 1fr auto", opacity: 0.65 }}>
              {placeholderRoles.map((r, i) => {
                const phase = r.phase ?? inferPhase(r.role);
                const resourceTeam = r.resourceTeam ?? inferResourceTeam(r.role);
                const primary = phase ? PHASE_LABEL[phase] : r.role;
                const showSub = !!resourceTeam && resourceTeam !== primary;
                return (
                  <Fragment key={`ph-${r.role}-${r.person}-${i}`}>
                    <div className="flex items-center gap-1.5 pr-3 py-0.5">
                      <span className={`inline-block w-1.5 h-1.5 rounded-sm shrink-0 ${ROLE_COLOR[r.role] ?? "bg-gray-500"}`} style={{ opacity: 0.6 }} />
                      <span className="text-[11px] font-medium whitespace-nowrap" style={{ color: "var(--text-muted)" }} title={showSub ? `${primary} · ${resourceTeam}` : primary}>
                        {primary}
                        {showSub && <span className="ml-1 text-[10px]" style={{ color: "var(--text-subtle)" }}>· {resourceTeam}</span>}
                      </span>
                    </div>
                    <span className="text-[11px] whitespace-nowrap pr-3 py-0.5" style={{ color: "var(--text-subtle)" }}>
                      {r.person && r.person !== "-" ? r.person : ""}
                    </span>
                    <span className="text-[11px] py-0.5" style={{ color: "var(--text-subtle)" }}>
                      {r.start && r.end ? `${r.start} ~ ${r.end}` : r.start || r.end || "날짜 미입력"}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0 ml-2" style={{ background: "var(--bg-canvas)", color: "var(--text-muted)", border: "1px solid var(--border-2)" }}>
                      {r.status}
                    </span>
                  </Fragment>
                );
              })}
            </div>
          )}
        </div>
      )}

      {pastDoneRoles.length > 0 && (
        <div className="mt-4" style={{ borderTop: "1px dashed var(--border)", paddingTop: "10px" }}>
          <button
            onClick={() => setShowPastDone(v => !v)}
            className="flex items-center gap-1.5 text-xs font-medium transition-colors px-2 py-1 rounded-md"
            style={{
              color: "var(--text-subtle)",
              background: effectiveShowPastDone ? "var(--bg-overlay)" : "transparent",
            }}
          >
            <span style={{ fontSize: 10 }}>{effectiveShowPastDone ? "▾" : "▸"}</span>
            <span>지난 완료 일정</span>
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: "var(--bg-overlay)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
              {pastDoneRoles.length}
            </span>
          </button>
          {effectiveShowPastDone && (
            <div className="mt-2 rounded-lg p-2.5 opacity-60" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
              <div className="grid gap-y-1" style={{ gridTemplateColumns: "auto auto auto 1fr" }}>
                {pastDoneRoles.map((r, i) => (
                  <Fragment key={`past-${r.role}-${r.person}-${i}`}>
                    {/* role: phase + (resourceTeam) */}
                    <div className="flex items-center gap-1.5 pr-3 py-0.5">
                      <span className={`inline-block w-1.5 h-1.5 rounded-sm shrink-0 ${ROLE_COLOR[r.role] ?? "bg-gray-500"}`} />
                      {(() => {
                        const phase = r.phase ?? inferPhase(r.role);
                        const resourceTeam = r.resourceTeam ?? inferResourceTeam(r.role);
                        const primary = phase ? PHASE_LABEL[phase] : r.role;
                        const showSub = !!resourceTeam && resourceTeam !== primary;
                        return (
                          <span className="text-xs font-medium whitespace-nowrap" style={{ color: "var(--text-muted)" }} title={showSub ? `${primary} · ${resourceTeam}` : primary}>
                            {primary}
                            {showSub && (
                              <span className="ml-1 text-[10px]" style={{ color: "var(--text-subtle)" }}>· {resourceTeam}</span>
                            )}
                          </span>
                        );
                      })()}
                    </div>
                    {/* person */}
                    <span className="text-xs whitespace-nowrap pr-3 py-0.5" style={{ color: "var(--text-muted)" }} title={r.person}>{r.person}</span>
                    {/* date */}
                    <span className="text-xs whitespace-nowrap pr-3 py-0.5" style={{ color: "var(--text-subtle)" }}>
                      {r.start && r.end ? (
                        <>
                          {formatDateWithDay(r.start)} ~ {formatDateWithDay(r.end)}
                          {(() => {
                            const total = calcWorkingDays(r.start, r.end);
                            const vac = r.vacationDays ?? 0;
                            const net = Math.max(0, total - vac);
                            return vac > 0
                              ? <><span className="ml-1.5" style={{ color: "var(--text-subtle)" }}>{net}영업일</span><span className="ml-1 text-orange-400 text-[10px]">(-{vac}휴가)</span></>
                              : <span className="ml-1.5" style={{ color: "var(--text-subtle)" }}>{total}영업일</span>;
                          })()}
                        </>
                      ) : ""}
                    </span>
                    {/* detail */}
                    <span className="text-xs py-0.5 min-w-0 truncate" style={{ color: "var(--text-subtle)" }} title={r.detail ?? ""}>
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

type DevTrackKey = "SP" | "PP" | "CFE" | "Mobile" | "DFE" | "QA" | "기타";
const DEV_TRACK_KEYS: DevTrackKey[] = ["SP", "PP", "CFE", "Mobile", "DFE", "QA", "기타"];

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

type PlanningSummaryState = "확인필요" | "검토중" | "플래닝 완료" | "대기중" | "대상아님";

function getPlanningStateSummary(val: unknown): PlanningSummaryState {
  const p = getPlanningVal(val);
  if (p.reviewNeeded) return "확인필요";
  const allNA   = p.design === "대상아님" && p.dev === "대상아님";
  if (allNA) return "대상아님";
  const allDone = (p.design === "완료" || p.design === "대상아님") && (p.dev === "완료" || p.dev === "대상아님");
  if (allDone) return "플래닝 완료";
  if (p.design === "검토중" || p.dev === "검토중") return "검토중";
  return "대기중";
}

/** 상태별 tooltip 문구 — [현재 상태] / [필요한 행동] */
const PLANNING_BADGE_TIPS: Record<PlanningSummaryState, string> = {
  "플래닝 완료": "디자인·개발 플래닝이 모두 완료됐습니다.\n스프린트 배정 또는 세부 일정 입력으로 이동하세요.",
  "확인필요":   "스프린트 미팅 검토 대상입니다.\n우선순위·범위 확인 후 담당 PM이 해제해주세요.",
  "검토중":     "플래닝 검토가 진행 중입니다.\n디자인 또는 개발팀의 검토를 기다리는 상태입니다.",
  "대기중":     "플래닝이 아직 시작되지 않았습니다.\n준비 완료 시 해당 팀을 검토중으로 변경하세요.",
  "대상아님":   "플래닝 대상에서 제외된 과제입니다.",
};

function PlanningBadge({ state, size = "xs" }: { state: PlanningSummaryState; size?: "xs" | "sm" }) {
  const textSize = size === "xs" ? "text-[11px]" : "text-xs";
  const tip = PLANNING_BADGE_TIPS[state];

  // 완료 → green을 유지하되 채도 낮춤 (운영 중 불필요한 시각 노이즈 감소)
  if (state === "플래닝 완료") return (
    <Tooltip content={tip}>
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${textSize} font-medium cursor-default`}
        style={{ background: "rgba(16,185,129,0.07)", color: "#6ee7b7", border: "1px solid rgba(52,211,153,0.18)" }}>✓ 완료</span>
    </Tooltip>
  );
  // 확인필요(=reviewNeeded) → critical red (가장 강한 강조)
  if (state === "확인필요") return (
    <Tooltip content={tip}>
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${textSize} font-bold cursor-default`}
        style={{ background: "rgba(239,68,68,0.15)", border: "1px solid #f87171", color: "#f87171" }}>⚡ 검토필요</span>
    </Tooltip>
  );
  // 검토중 → amber (blue 제거 — blue는 진행중/operational 전용)
  if (state === "검토중") return (
    <Tooltip content={tip}>
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${textSize} font-medium cursor-default`}
        style={{ background: "rgba(245,158,11,0.11)", border: "1px solid rgba(251,191,36,0.45)", color: "#fbbf24" }}>
        <span className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse" style={{ background: "#f59e0b" }} />검토중
      </span>
    </Tooltip>
  );
  // 대상아님 → neutral muted (시각 우선순위 최하)
  if (state === "대상아님") return (
    <Tooltip content={tip}>
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${textSize} font-medium cursor-default`}
        style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", color: "var(--text-subtle)" }}>대상아님</span>
    </Tooltip>
  );
  // 대기중 → neutral (amber 제거 — 시작 전 상태, 즉각 조치 불필요)
  return (
    <Tooltip content={tip}>
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${textSize} font-medium cursor-default`}
        style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", color: "var(--text-muted)" }}>대기중</span>
    </Tooltip>
  );
}

// ── 팀 단위 Planning 상태 compact 표시 ────────────────────────────────────────

/** 상태 우선순위 (낮을수록 먼저 표시) */
const PLAN_STATE_PRIO: Record<string, number> = {
  "확인필요": 0, "검토중": 1, "대기중": 2, "완료": 9, "대상아님": 9,
};

/** Design + Dev 트랙별 { team, state } 목록 */
function getPlanningTeamEntries(val: unknown): { team: string; state: TrackState; isDesign: boolean }[] {
  const p = getPlanningVal(val);
  const result: { team: string; state: TrackState; isDesign: boolean }[] = [];
  result.push({ team: "Design", state: p.design, isDesign: true });
  const activeTracks = DEV_TRACK_KEYS.filter(tk => tk in p.devTracks);
  if (activeTracks.length > 0) {
    for (const tk of activeTracks) {
      result.push({ team: tk, state: p.devTracks[tk]!, isDesign: false });
    }
  } else {
    // 레거시 dev 단일 상태
    result.push({ team: "Dev", state: p.dev, isDesign: false });
  }
  return result;
}

/** 목록 서브행 — 팀 단위 플래닝 상태 compact badges */
function PlanningCompactBadges({ planVal, maxVisible = 3 }: { planVal: unknown; maxVisible?: number }) {
  const p = getPlanningVal(planVal);
  const allEntries = getPlanningTeamEntries(planVal);

  // tooltip: 전체 상태 표시 — 행 레벨 native title (compact row에서 사용)
  const STATE_SHORT: Record<TrackState, string> = {
    "대기중":   "대기중 (플래닝 미시작)",
    "검토중":   "검토중 (플래닝 진행 중)",
    "완료":     "완료",
    "대상아님": "대상아님",
  };
  const tooltipText = [
    p.reviewNeeded ? "⚡ 검토필요 — 스프린트 미팅 논의 대상" : null,
    ...allEntries.map(e => `${e.team}: ${STATE_SHORT[e.state] ?? e.state}`),
  ].filter(Boolean).join("\n");

  // 표시 대상: 완료·대상아님 제외 — 순서 고정 (Design → SP → PP → CFE → 기타)
  const visible = allEntries
    .filter(e => e.state !== "완료" && e.state !== "대상아님");

  // 전부 완료·대상아님 + reviewNeeded 없음 → ✓ (muted — 완료 상태는 시각 노이즈 최소)
  if (visible.length === 0 && !p.reviewNeeded) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium"
        title={tooltipText}
        style={{ background: "rgba(16,185,129,0.05)", color: "var(--text-subtle)", border: "1px solid rgba(52,211,153,0.15)" }}>✓</span>
    );
  }

  const items: React.ReactNode[] = [];

  // reviewNeeded → ⚡ 최우선 badge (팀 prefix 없이)
  const rnSlot = p.reviewNeeded ? 1 : 0;
  if (p.reviewNeeded) {
    items.push(
      <span key="__rn" className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-bold shrink-0"
        style={{ background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(248,113,113,0.4)" }}>
        ⚡ 검토필요
      </span>
    );
  }

  // 팀 배지 — 남은 슬롯 만큼
  const slots = maxVisible - rnSlot;
  const toShow = visible.slice(0, slots);
  const overflow = visible.length - toShow.length;

  for (const entry of toShow) {
    const isReview = entry.state === "검토중";
    const isWait   = entry.state === "대기중";
    // 검토중 = amber (Design·Dev 구분 없이 통일 — color spec: amber=attention)
    // 대기중 = neutral (amber 제거 — 시작 전 상태, 즉각 조치 불필요)
    const color  = isReview ? "#fbbf24" : isWait ? "var(--text-muted)" : "var(--text-muted)";
    const bg     = isReview ? "rgba(245,158,11,0.10)" : isWait ? "var(--bg-overlay)" : "var(--bg-overlay)";
    const border = isReview ? "rgba(251,191,36,0.42)" : isWait ? "var(--border-2)"  : "var(--border-2)";
    items.push(
      <span key={entry.team}
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
        style={{ background: bg, color, border: `1px solid ${border}` }}>
        <span style={{ color: "var(--text-subtle)", fontWeight: 500 }}>{entry.team}</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span>{entry.state}</span>
        {isReview && <span className="ml-0.5 w-1 h-1 rounded-full shrink-0 animate-pulse" style={{ background: "#f59e0b" }} />}
      </span>
    );
  }

  if (overflow > 0) {
    items.push(
      <span key="__ov" className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
        style={{ background: "var(--bg-overlay)", color: "var(--text-subtle)", border: "1px solid var(--border-2)" }}>
        +{overflow}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 flex-wrap" title={tooltipText}>
      {items}
    </span>
  );
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
  const [planningKpiFilter, setPlanningKpiFilter] = useState<{ team: string; status: TrackState } | null>(null); // 상단 KPI 카드 클릭 필터
  const [ticketAddedDates, setTicketAddedDates] = useState<Record<string, string>>({}); // key → "YYYY-MM-DD"
  const [planningTab, setPlanningTab] = useState("진행 중");
  const [kvLoaded, setKvLoaded]     = useState(false);
  const [kvSaveStatus, setKvSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const kvSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 우측 상세 패널 탭
  const [detailTab, setDetailTab] = useState<"overview" | "ops" | "activity">("overview");
  // owner_dashboard deep-link context — 어떤 action에서 진입했는지 추적
  // focusForKey: 어떤 ticket key에 대한 context인지 (다른 row 클릭 시 context 유지 안 함)
  const [focusForKey,      setFocusForKey]      = useState<string | null>(null);
  const [focusContext,     setFocusContext]      = useState<string | null>(null);
  const [sectionHighlight, setSectionHighlight] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const planningMigratedRef         = useRef(false);
  // hiddenKeys의 최신값을 항상 참조할 수 있는 ref (stale closure 방지)
  const hiddenKeysRef = useRef<Set<string>>(new Set());
  // selected 이전값 추적 — URL sync 시 "초기 null→null"과 "명시적 deselect" 구분에 사용
  const prevSelectedRef = useRef<Ticket | null>(null);
  // deep-link 처리 완료 여부 — tickets가 바뀔 때마다 재실행되는 것을 방지
  // match가 찾아져서 setSelected까지 실행된 이후에만 true로 설정
  const deepLinkProcessedRef = useRef(false);
  // Focus Mode 2-column 스크롤 대상 ref
  const focusLeftColRef  = useRef<HTMLDivElement>(null);
  const focusRightColRef = useRef<HTMLDivElement>(null);
  // Action Resolve 피드백 — Focus Mode에서 action 수가 줄면 toast 표시
  const [resolveToast, setResolveToast]   = useState<{ count: number } | null>(null);
  const prevActionCountRef = useRef<Record<string, number>>({});
  // ── Weekly Notes (Jira Weekly 공유사항 Delta Sync) ────────────
  const [weeklyNotes,      setWeeklyNotes]      = useState<Record<string, WeeklyNote[]>>({});
  // Phase B: ticket별 Weekly 원문 (customfield_10625 / description section / comment 중 선택된 본문)
  const [weeklySourceTexts, setWeeklySourceTexts] = useState<Record<string, WeeklySourceText>>({});
  // 우측 상세 패널 Weekly 원문 expand/collapse 상태 (ticket별)
  const [weeklyExpanded, setWeeklyExpanded] = useState<Record<string, boolean>>({});
  const [updateCandidates, setUpdateCandidates] = useState<UpdateCandidate[]>([]);
  // ── Transition Visibility (이번 주 변화 모드) ──────────────────
  const [changesMode,           setChangesMode]           = useState(false);
  const [changesExpanded,       setChangesExpanded]       = useState(false);  // 기본값: 접힘
  const [transitionFilter,      setTransitionFilter]      = useState<TransitionKind | "all" | "newly_added">("all");
  const [compareSnapshot,       setCompareSnapshot]       = useState<SnapshotSet | null>(null);
  const [transitionMap,         setTransitionMap]         = useState<Map<string, TransitionKind[]>>(new Map());
  const [transitionNewlyAdded,  setTransitionNewlyAdded]  = useState<Set<string>>(new Set());
  const [snapshotsLoaded,       setSnapshotsLoaded]       = useState(false);
  const [snapshotCount,         setSnapshotCount]         = useState(0);
  const [baselineAt,            setBaselineAt]            = useState<string | null>(null);
  const [baselineSaving,        setBaselineSaving]        = useState(false);
  // Workspace Navigation Context — 진입 경로/이전 상태 추적 (page reload 시 초기화 OK)
  const workspaceNavRef = useRef<{
    source: string | null;         // "owner_dashboard" | null
    fromOwnerDashboard: boolean;   // source=owner_dashboard && mode=focus로 진입했는지
    entryFocus: string | null;     // 진입 시 focus= 파라미터
    prevPtab: string | null;       // Focus 진입 전 planningTab (복귀 시 복원용)
    prevScrollY: number;           // Focus 진입 전 window.scrollY (복귀 시 복원용)
  }>({ source: null, fromOwnerDashboard: false, entryFocus: null, prevPtab: null, prevScrollY: 0 });
  // 플래닝 코멘트 (key → PlanningNote[])
  const [planningNotes, setPlanningNotes] = useState<Record<string, PlanningNote[]>>({});
  const [noteInput, setNoteInput]         = useState("");
  // 티켓 메모 (key → PlanningNote[])
  const [ticketNotes, setTicketNotes]     = useState<Record<string, PlanningNote[]>>({});
  const [ticketNoteInput, setTicketNoteInput] = useState("");
  const [planningOpen, setPlanningOpen] = useState(true);


  // 요구사항 출처 (key → TicketRequestInfo)
  const [etrMap, setEtrMap]       = useState<Record<string, TicketRequestInfo>>({});
  const [etrInput, setEtrInput]   = useState("");
  const [etrError, setEtrError]   = useState<string | null>(null);
  const [etrLoading, setEtrLoading] = useState<Set<string>>(new Set());
  const [wikiInput, setWikiInput] = useState("");
  const [wikiTitleInput, setWikiTitleInput] = useState("");
  const [wikiError, setWikiError] = useState<string | null>(null);
  const [wikiAddOpen, setWikiAddOpen] = useState(false);
  const [wikiEditUrl, setWikiEditUrl] = useState<string | null>(null); // 수정 중인 항목의 원래 URL
  const [wikiEditInput, setWikiEditInput] = useState("");
  const [wikiEditTitleInput, setWikiEditTitleInput] = useState("");
  const [sheetSyncMsg, setSheetSyncMsg] = useState<string | null>(null);
  // Phase 2: Weekly Sync orchestration 진행 상황 토스트
  const [weeklySyncMsg, setWeeklySyncMsg] = useState<string | null>(null);
  // Phase 4: Update Candidate Review 모달 / 진행 중인 candidateId set
  const [candidatePanelOpen, setCandidatePanelOpen] = useState(false);
  const [candidatesInFlight, setCandidatesInFlight] = useState<Set<string>>(new Set());
  // Phase C: checkbox 선택 / kind 필터
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [candidateKindFilter, setCandidateKindFilter] = useState<"all" | "schedule" | "action" | "risk" | "note">("all");
  // Phase D: Cleanup 패널 (자격 미달 jira_weekly row 정리)
  const [cleanupPanelOpen, setCleanupPanelOpen] = useState(false);
  const [selectedCleanupIds, setSelectedCleanupIds] = useState<Set<string>>(new Set());
  const [cleanupInFlight, setCleanupInFlight] = useState<Set<string>>(new Set());

  // 정렬
  const [sortBy, setSortBy] = useState<"default" | "priority" | "startDate" | "eta" | "ticketNo">("eta");
  const [statusTab, setStatusTab] = useState<"전체" | "완료" | "진행중" | "계획/대기" | "기획" | "디자인" | "준비중" | "개발" | "QA">("전체");

  // 사용자 직접 추가 티켓 관리
  const [addKeyInput, setAddKeyInput]     = useState("");
  const [addKeyLoading, setAddKeyLoading] = useState(false);
  const [addKeyError, setAddKeyError]     = useState<string | null>(null);
  const [addKeyProgress, setAddKeyProgress] = useState<{ current: number; total: number } | null>(null);
  const [newlyAddedKeys, setNewlyAddedKeys] = useState<Set<string>>(new Set());
  const [duplicateKeys, setDuplicateKeys] = useState<Set<string>>(new Set());
  // customKeys: 모든 티켓이 TICKET_KEYS(코드)로 관리되므로 더 이상 사용 안 함
  const [hiddenKeys, setHiddenKeys]       = useState<Set<string>>(new Set());
  // hidden key hydrate 완료 여부 — render gate (flicker 방지)
  // localStorage cache hit이면 cache에 동봉된 hiddenKeys로 즉시 true,
  // cache miss면 mainFetch가 KV에서 cc-hidden-keys 도착시 true.
  const [hiddenLoaded, setHiddenLoaded]   = useState(false);
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
      return filterVisibleTickets([...data.tickets, ...extraByKey.values()], hidden);
    });
    setSyncedAt(at);
    try {
      // cache hit 시 즉시 hidden 필터링 가능하도록 hiddenKeys도 함께 저장
      localStorage.setItem(
        TICKET_CACHE_KEY,
        JSON.stringify({
          tickets: data.tickets,
          fetchedAt: at.toISOString(),
          hiddenKeys: [...hidden],
        }),
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
        const cached = JSON.parse(raw) as {
          tickets: Ticket[];
          fetchedAt: string;
          hiddenKeys?: string[];
        };
        if (cached.tickets.length > 0 && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_MAX_MS) {
          // cache에 동봉된 hiddenKeys로 즉시 hydrate → flicker 방지
          // mainFetch가 KV에서 최신 hiddenKeys를 받으면 잠시 후 갱신됨 (stale 보정).
          const cachedHidden = new Set<string>(cached.hiddenKeys ?? []);
          hiddenKeysRef.current = cachedHidden;
          setHiddenKeys(cachedHidden);
          setHiddenLoaded(true);
          setTickets(prev => {
            const jiraKeys = new Set(cached.tickets.map((t: Ticket) => t.key));
            const existingExtra = prev.filter(t => !jiraKeys.has(t.key));
            const extraByKey = new Map<string, Ticket>(existingExtra.map(t => [t.key, t]));
            return filterVisibleTickets([...cached.tickets, ...extraByKey.values()], cachedHidden);
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

      // 모든 티켓이 TICKET_KEYS(코드)로 관리되므로 커스텀 KV 로드 불필요
      // JIRA 배치 재조회 결과를 그대로 사용

      // 화면 반영 + localStorage 갱신
      const at = data.fetchedAt ? new Date(data.fetchedAt) : new Date();
      const hiddenSync = hiddenKeys;
      setTickets((data.tickets as Ticket[]).filter(t => !hiddenSync.has(t.key)));
      setSyncedAt(at);
      // Transition snapshot 저장 (오늘 1회, 비동기)
      saveTransitionSnapshot(data.tickets as Ticket[], planning, hiddenSync);
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

        const allNewTickets = data.tickets as Ticket[];

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

      // ─── Weekly Sync orchestration (Phase 2) ──────────────────
      // fire-and-forget: Jira Sync UI는 즉시 끝나고, weekly 흐름은 background에서 진행.
      // 활성 ticket만 (완료 제외) 대상. 5개씩 chunk로 병렬.
      // 흐름: jira-weekly-source → weekly-sync POST → KV reload.
      void (async () => {
        const DONE_FOR_WEEKLY = new Set(["론치완료", "완료", "배포완료"]);
        const hiddenForSync = hiddenSync;  // 위에서 forceRefresh가 잡아둔 hidden set
        const activeAll = (data.tickets as Ticket[]).filter(t => !DONE_FOR_WEEKLY.has(t.status));
        const targets = activeAll.filter(t => !hiddenForSync.has(t.key));
        const skippedHidden = activeAll.length - targets.length;
        if (targets.length === 0) {
          if (skippedHidden > 0) {
            console.log(`[WeeklySync] all targets hidden, skipped=${skippedHidden}`);
          }
          return;
        }

        // 진행 중 토스트도 사용자용 단순 메시지. hidden 등 정보는 console로.
        setWeeklySyncMsg("Weekly Sync 중…");
        if (skippedHidden > 0) {
          console.log(`[WeeklySync] start — targets=${targets.length} (hidden ${skippedHidden} 제외)`);
        }

        let parsedTotal = 0;
        let updatedTotal = 0;
        let candidatesTotal = 0;
        let appliedTotal = 0;
        let foundMarkerTotal = 0;
        let skippedNoMarker = 0;
        let skippedCommentOnly = 0;  // customfield/description 없이 comment fallback만 있는 경우
        let errorTotal = 0;

        // Phase B: ticket별 Weekly 원문 수집 (KV cc-weekly-source-text에 누적 저장)
        const collectedSources: Record<string, WeeklySourceText> = {};
        const nowIso = new Date().toISOString();

        const chunkSize = 5;
        for (let i = 0; i < targets.length; i += chunkSize) {
          const chunk = targets.slice(i, i + chunkSize);
          await Promise.all(chunk.map(async (t) => {
            try {
              const srcRes = await fetch(`/api/jira-weekly-source?key=${encodeURIComponent(t.key)}`);
              if (!srcRes.ok) { errorTotal++; return; }
              const src = await srcRes.json();
              if (!src.foundMarker || !src.text) { skippedNoMarker++; return; }
              foundMarkerTotal++;

              // 원문 수집 — Weekly Summary 표시는 source 무관 (history도 보존)
              collectedSources[t.key] = {
                ticketKey: t.key,
                text: src.text,
                source: src.source ?? "",
                policyReason: src.policyReason ?? "",
                sourceWeek: src.parseSummary?.sourceWeek ?? "",
                sourceUpdatedAt: src.sourceUpdatedAt ?? "",
                savedAt: nowIso,
              };

              // 정책: schedule merge는 customfield(LIVE SoT) 또는 description weekly section만.
              // automation comment는 IMMUTABLE history → schedule row append 금지.
              if (src.source === "comment") {
                skippedCommentOnly++;
                console.log(`[WeeklySync] ${t.key} src=comment (history only) — merge skipped`);
                return;
              }

              const syncRes = await fetch("/api/weekly-sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ticketKey: t.key, weeklyText: src.text }),
              });
              if (!syncRes.ok) { errorTotal++; return; }
              const result = await syncRes.json();

              const parsedCnt = src.parseSummary?.schedulesCount ?? 0;
              parsedTotal      += parsedCnt;
              updatedTotal     += result.schedulesUpdated  ?? 0;
              candidatesTotal  += result.updateCandidates  ?? 0;
              appliedTotal     += result.appliedUpdates    ?? 0;

              console.log(
                `[WeeklySync] ${t.key} src=${src.source} ` +
                `parsed=${parsedCnt} updated=${result.schedulesUpdated ?? 0} ` +
                `candidates=${result.updateCandidates ?? 0} ` +
                (result.isIdempotent ? "(idempotent)" : ""),
              );
            } catch (e) {
              errorTotal++;
              console.error(`[WeeklySync] ${t.key} error:`, e);
            }
          }));
        }

        // 원문 수집 결과를 cc-weekly-source-text KV에 합쳐 저장 (read-modify-write 1회)
        if (Object.keys(collectedSources).length > 0) {
          try {
            const existRes = await fetch("/api/kv?keys=cc-weekly-source-text");
            const existData = await existRes.json();
            const existing = (existData["cc-weekly-source-text"] && typeof existData["cc-weekly-source-text"] === "object" && !Array.isArray(existData["cc-weekly-source-text"]))
              ? existData["cc-weekly-source-text"] as Record<string, WeeklySourceText>
              : {};
            const merged: Record<string, WeeklySourceText> = { ...existing, ...collectedSources };
            await fetch("/api/kv", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: "cc-weekly-source-text", value: merged }),
            });
          } catch (e) {
            console.warn("[WeeklySync] cc-weekly-source-text save failed:", e);
          }
        }

        // 사용자 토스트는 운영 액션만 — debug count는 console로만.
        const msg =
          errorTotal > 0 && candidatesTotal === 0
            ? `Weekly Sync 일부 실패 (${errorTotal}건)`
            : candidatesTotal > 0
              ? `⚡ 검토 필요한 일정 변경 ${candidatesTotal}건`
              : `Weekly Sync 완료`;
        setWeeklySyncMsg(msg);
        setTimeout(() => setWeeklySyncMsg(null), 8_000);
        console.log(
          `[WeeklySync] DONE total ${targets.length} | ` +
          `found=${foundMarkerTotal} parsed=${parsedTotal} ` +
          `updated=${updatedTotal} applied=${appliedTotal} ` +
          `candidates=${candidatesTotal} skippedHidden=${skippedHidden} ` +
          `skippedCommentOnly=${skippedCommentOnly} ` +
          `skippedNoMarker=${skippedNoMarker} errors=${errorTotal}`,
        );

        // KV reload — weekly-notes, update-candidates, schedules, source-text
        try {
          const r = await fetch("/api/kv?keys=cc-weekly-notes,cc-update-candidates,cc-schedules,cc-weekly-source-text");
          const d2 = await r.json();
          if (d2["cc-weekly-notes"] && typeof d2["cc-weekly-notes"] === "object" && !Array.isArray(d2["cc-weekly-notes"]))
            setWeeklyNotes(d2["cc-weekly-notes"] as Record<string, WeeklyNote[]>);
          if (Array.isArray(d2["cc-update-candidates"]))
            setUpdateCandidates(d2["cc-update-candidates"] as UpdateCandidate[]);
          if (d2["cc-schedules"]) setSchedules(d2["cc-schedules"]);
          if (d2["cc-weekly-source-text"] && typeof d2["cc-weekly-source-text"] === "object" && !Array.isArray(d2["cc-weekly-source-text"]))
            setWeeklySourceTexts(d2["cc-weekly-source-text"] as Record<string, WeeklySourceText>);
        } catch (e) {
          console.warn("[WeeklySync] KV reload failed:", e);
        }
      })().catch(e => console.error("[WeeklySync] orchestration failed:", e));
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

  // Phase D: cleanup 후보 추출 — source=jira_weekly + 자격 미달 row.
  // 자동 삭제 금지. 사용자가 명시적으로 선택 후 삭제.
  type CleanupCandidate = {
    id: string;
    ticketKey: string;
    rowKey: string;        // 삭제 시 row 매칭용 합성 키
    row: RoleSchedule;
    reason: string;
  };
  function makeRowKey(r: RoleSchedule): string {
    return r.mergeKey ?? `${r.role}|||${r.start ?? ""}|||${r.end ?? ""}|||${r.person ?? ""}`;
  }
  function buildCleanupCandidates(): CleanupCandidate[] {
    // isCleanupCandidate(row) helper로 통일 — Gantt 필터와 cleanup panel이 동일 정책.
    const out: CleanupCandidate[] = [];
    for (const [ticketKey, rows] of Object.entries(schedules)) {
      const arr = Array.isArray(rows) ? rows : [];
      for (const row of arr) {
        const check = isCleanupCandidate(row);
        if (!check.isCleanup) continue;
        const rowKey = makeRowKey(row);
        out.push({
          id: `${ticketKey}::${rowKey}`,
          ticketKey, rowKey, row,
          reason: check.reason ?? "qualification failed",
        });
      }
    }
    return out;
  }
  // cleanup 단일 row 삭제 (race-safe: KV read → filter → write)
  const deleteCleanupRow = useCallback(async (ticketKey: string, rowKey: string, id: string) => {
    setCleanupInFlight(prev => { const n = new Set(prev); n.add(id); return n; });
    // optimistic
    setSchedules(prev => {
      const arr = (prev[ticketKey] ?? []).filter(r => makeRowKey(r) !== rowKey);
      return { ...prev, [ticketKey]: arr };
    });
    try {
      const r = await fetch("/api/kv?keys=cc-schedules");
      const d = await r.json();
      const all: Record<string, RoleSchedule[]> =
        d["cc-schedules"] && typeof d["cc-schedules"] === "object" && !Array.isArray(d["cc-schedules"])
          ? d["cc-schedules"] : {};
      const arr = (all[ticketKey] ?? []).filter(rr => makeRowKey(rr) !== rowKey);
      const merged = { ...all, [ticketKey]: arr };
      await fetch("/api/kv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "cc-schedules", value: merged }),
      });
      console.log(`[cleanup] deleted ${ticketKey}/${rowKey}`);
    } catch (e) {
      console.error(`[cleanup] delete failed ${ticketKey}/${rowKey}:`, e);
      // revert: KV에서 다시 받아 setSchedules
      try {
        const r2 = await fetch("/api/kv?keys=cc-schedules");
        const d2 = await r2.json();
        if (d2["cc-schedules"]) setSchedules(d2["cc-schedules"]);
      } catch {}
    } finally {
      setCleanupInFlight(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, []);

  // Phase C: WeeklyNote 후보(action/risk/note)를 resolved 처리.
  // cc-weekly-notes KV의 ticketKey 배열에서 해당 noteId의 status를 "resolved"로 갱신.
  // 일정 후보(UpdateCandidate)는 별도 resolveCandidate가 처리.
  const resolveNote = useCallback(async (ticketKey: string, noteId: string) => {
    setCandidatesInFlight(prev => { const next = new Set(prev); next.add(noteId); return next; });
    // optimistic
    setWeeklyNotes(prev => {
      const arr = prev[ticketKey] ?? [];
      const updated = arr.map(n => n.id === noteId ? { ...n, status: "resolved" as const } : n);
      return { ...prev, [ticketKey]: updated };
    });
    try {
      // read-modify-write (race-safe: KV current 값 읽고 patch 적용 후 저장)
      const r = await fetch("/api/kv?keys=cc-weekly-notes");
      const d = await r.json();
      const all: Record<string, WeeklyNote[]> =
        d["cc-weekly-notes"] && typeof d["cc-weekly-notes"] === "object" && !Array.isArray(d["cc-weekly-notes"])
          ? d["cc-weekly-notes"] : {};
      const arr = all[ticketKey] ?? [];
      const patched = arr.map(n => n.id === noteId ? { ...n, status: "resolved" as const } : n);
      const merged = { ...all, [ticketKey]: patched };
      await fetch("/api/kv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "cc-weekly-notes", value: merged }),
      });
      console.log(`[resolveNote] ${ticketKey}/${noteId} → resolved`);
    } catch (e) {
      console.error(`[resolveNote] ${ticketKey}/${noteId} failed:`, e);
      // revert (optimistic 되돌림)
      setWeeklyNotes(prev => {
        const arr = prev[ticketKey] ?? [];
        const reverted = arr.map(n => n.id === noteId ? { ...n, status: "open" as const } : n);
        return { ...prev, [ticketKey]: reverted };
      });
    } finally {
      setCandidatesInFlight(prev => { const next = new Set(prev); next.delete(noteId); return next; });
    }
  }, []);

  // Phase 4: Update Candidate 승인/기각 처리
  // PUT /api/weekly-sync → optimistic update → 실패 시 revert + KV reload
  const resolveCandidate = useCallback(async (candidateId: string, action: "apply" | "dismiss") => {
    setCandidatesInFlight(prev => {
      const next = new Set(prev);
      next.add(candidateId);
      return next;
    });
    // optimistic: candidate를 resolved로 표시
    setUpdateCandidates(prev => prev.map(c =>
      c.id === candidateId
        ? { ...c, resolved: true, resolvedAt: new Date().toISOString() }
        : c,
    ));
    try {
      const res = await fetch("/api/weekly-sync", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, action }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // apply의 경우 cc-schedules가 갱신됐으므로 함께 재로드
      const keys = action === "apply"
        ? "cc-schedules,cc-update-candidates"
        : "cc-update-candidates";
      const kvRes = await fetch(`/api/kv?keys=${keys}`);
      const d = await kvRes.json();
      if (action === "apply" && d["cc-schedules"]) setSchedules(d["cc-schedules"]);
      if (Array.isArray(d["cc-update-candidates"]))
        setUpdateCandidates(d["cc-update-candidates"] as UpdateCandidate[]);
      console.log(`[resolveCandidate] ${candidateId} ${action} → ok`);
    } catch (e) {
      console.error(`[resolveCandidate] ${candidateId} ${action} failed:`, e);
      // revert
      setUpdateCandidates(prev => prev.map(c =>
        c.id === candidateId ? { ...c, resolved: false, resolvedAt: undefined } : c,
      ));
    } finally {
      setCandidatesInFlight(prev => {
        const next = new Set(prev);
        next.delete(candidateId);
        return next;
      });
    }
  }, []);

  // ─── Phase C: DisplayCandidate (UpdateCandidate + WeeklyNote 통합) ─────
  type CandKind = "schedule" | "action" | "risk" | "note";
  type CandConf = "high" | "medium" | "low";
  type DisplayCandidate = {
    id: string;
    kind: CandKind;
    confidence: CandConf;
    ticketKey: string;
    ticketSummary: string;
    sourceWeek?: string;
    // schedule (UpdateCandidate)
    role?: string;
    field?: string;
    oldValue?: string;
    newValue?: string;
    autoApply?: boolean;
    // note/action/risk
    content?: string;
    severity?: string;
    actionCategory?: string;
    reason?: string;        // 왜 candidate가 됐는지
    declineReason?: string; // schedule 자격 박탈 사유 (있을 때)
  };

  const KIND_LABEL: Record<CandKind, string> = {
    schedule: "일정 후보",
    action:   "액션 후보",
    risk:     "리스크/메모",
    note:     "참고만",
  };
  const KIND_STYLE: Record<CandKind, { bg: string; color: string; border: string }> = {
    schedule: { bg: "rgba(16,185,129,0.10)",  color: "#10b981", border: "rgba(16,185,129,0.35)" },
    action:   { bg: "rgba(251,191,36,0.10)",  color: "#fbbf24", border: "rgba(251,191,36,0.35)" },
    risk:     { bg: "rgba(239,68,68,0.10)",   color: "#f87171", border: "rgba(239,68,68,0.35)" },
    note:     { bg: "rgba(100,116,139,0.08)", color: "#94a3b8", border: "rgba(100,116,139,0.30)" },
  };
  const CONF_STYLE: Record<CandConf, { bg: string; color: string; label: string }> = {
    high:   { bg: "rgba(16,185,129,0.12)",  color: "#10b981", label: "high" },
    medium: { bg: "rgba(129,140,248,0.12)", color: "#818cf8", label: "medium" },
    low:    { bg: "rgba(148,163,184,0.12)", color: "#94a3b8", label: "low" },
  };

  function buildDisplayCandidates(): DisplayCandidate[] {
    const titleByKey = new Map(tickets.map(t => [t.key, t.summary]));
    const out: DisplayCandidate[] = [];

    // 일정 후보: UpdateCandidate
    for (const c of updateCandidates) {
      if (c.resolved) continue;
      const role = c.mergeKey.split("::")[1] ?? "";
      out.push({
        id: c.id,
        kind: "schedule",
        confidence: c.autoApply ? "high" : "medium",
        ticketKey: c.ticketKey,
        ticketSummary: titleByKey.get(c.ticketKey) ?? "",
        sourceWeek: c.sourceWeek,
        role,
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
        autoApply: c.autoApply,
        reason: c.autoApply
          ? `기존 ${role}/${c.field} 값과 Weekly 값 차이 — 자동 적용 가능 (conflict 1건)`
          : `기존 ${role}/${c.field} 값과 Weekly 값 충돌 — 검토 필요 (conflict 2건+ 또는 manual locked)`,
      });
    }

    // action/risk/note: WeeklyNote (status=open만)
    for (const [ticketKey, notes] of Object.entries(weeklyNotes)) {
      for (const n of notes) {
        if (n.status === "resolved") continue;
        const kind: CandKind =
          n.type === "next_action" ? "action" :
          n.type === "risk"        ? "risk"   :
                                     "note";
        const confidence: CandConf =
          kind === "risk"   ? (n.severity === "high" ? "high" : n.severity === "medium" ? "medium" : "low") :
          kind === "action" ? "medium" :
                              "low"; // progress
        out.push({
          id: n.id,
          kind,
          confidence,
          ticketKey,
          ticketSummary: titleByKey.get(ticketKey) ?? "",
          sourceWeek: n.sourceWeek,
          content: n.content,
          severity: n.severity,
          actionCategory: n.actionCategory,
          reason:
            kind === "risk"   ? `Weekly에서 감지된 리스크 (severity=${n.severity ?? "medium"})` :
            kind === "action" ? `Weekly의 "다음 액션" 항목 (category=${n.actionCategory ?? "unknown"})` :
                                "Weekly의 진행상황 메모 — 자동 일정 반영 비추천",
        });
      }
    }
    return out;
  }

  function sortDisplayCandidates(cands: DisplayCandidate[]): DisplayCandidate[] {
    // 우선순위: high schedule → medium schedule → action → risk → low confidence(아무 kind)
    const CONF_ORDER: Record<CandConf, number> = { high: 0, medium: 1, low: 2 };
    const KIND_ORDER: Record<CandKind, number> = { schedule: 0, action: 1, risk: 2, note: 3 };
    return [...cands].sort((a, b) => {
      // schedule이면 confidence별, 아니면 schedule 다음
      const aIsSched = a.kind === "schedule" ? 0 : 1;
      const bIsSched = b.kind === "schedule" ? 0 : 1;
      if (aIsSched !== bIsSched) return aIsSched - bIsSched;
      // schedule끼리는 confidence 우선
      if (a.kind === "schedule" && b.kind === "schedule") {
        return CONF_ORDER[a.confidence] - CONF_ORDER[b.confidence];
      }
      // 다른 kind끼리: action → risk → note, low는 뒤로
      if (a.confidence === "low" && b.confidence !== "low") return 1;
      if (a.confidence !== "low" && b.confidence === "low") return -1;
      return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    });
  }

  // ─── Phase D2: 자동 감지된 액션 영역 (Weekly Summary 아래) ────────
  // 정책 변경:
  //   - Weekly Summary는 원문 그대로 (컨텍스트 유지)
  //   - 이 박스는 "실제 follow-up이 필요한 액션"만 — 원문 line 복제 금지
  //   - progress(참고) 섹션 제거 — 단순 설명/상황 line은 표시 안 함
  //   - parser가 RISK_INDICATORS / LOW_CONFIDENCE_KEYWORDS 매칭된 line만 action/risk로 분류
  function renderActionRiskBox(ticketKey: string) {
    const notes = (weeklyNotes[ticketKey] ?? []).filter(n => n.status === "open");
    const risks   = notes.filter(n => n.type === "risk");
    const actions = notes.filter(n => n.type === "next_action");
    // progress 노트는 의도적으로 표시 안 함 (단순 설명 line 중복 방지)
    const totalShown = risks.length + actions.length;
    if (totalShown === 0) return null;

    const Section = (props: {
      label: string;
      color: string;
      items: typeof notes;
    }) => props.items.length === 0 ? null : (
      <div className="text-[11px]">
        <div className="font-semibold mb-1" style={{ color: props.color }}>
          {props.label} <span className="ml-1 opacity-60">({props.items.length})</span>
        </div>
        <ul className="space-y-0.5 pl-3" style={{ color: "var(--text-secondary)" }}>
          {props.items.map((n, i) => (
            <li key={i} className="list-disc list-outside leading-relaxed">{n.content}</li>
          ))}
        </ul>
      </div>
    );

    return (
      <div className="mb-4 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border-2)" }}>
        <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border-2)", background: "var(--bg-overlay)" }}>
          <span className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
            자동 감지된 액션
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(251,191,36,0.10)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.30)" }}>
            {totalShown}건
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            follow-up 필요 · Gantt 자동 반영 안 됨
          </span>
        </div>
        <div className="px-3 py-2.5 space-y-2.5">
          <Section label="리스크"    color="#ef4444" items={risks}   />
          <Section label="액션 필요" color="#fbbf24" items={actions} />
        </div>
      </div>
    );
  }

  // Phase B: Weekly 요약 카드 (Split View / Focus Mode 공통 렌더링)
  // ticket별 cc-weekly-source-text 원문 우선, 없으면 weeklyNotes 합성 legacy.
  // 데이터 없으면 null 반환 → 호출처에서 layout gap 없이 그냥 사라짐.
  function renderWeeklySummary(ticketKey: string) {
    const src = weeklySourceTexts[ticketKey];
    const notes = weeklyNotes[ticketKey] ?? [];
    if (!src && notes.length === 0) return null;

    // 1순위: 원문 그대로
    if (src && src.text) {
      const PREVIEW_LINES = 5;
      const lines = src.text.split("\n");
      const isLong = lines.length > PREVIEW_LINES || src.text.length > 320;
      const expanded = !!weeklyExpanded[ticketKey];
      const preview = isLong && !expanded
        ? lines.slice(0, PREVIEW_LINES).join("\n")
        : src.text;
      const sourceLabel =
        src.source === "customfield" ? "Weekly 공유사항 field" :
        src.source === "description" ? "description section"   :
        src.source === "comment"     ? "automation comment"    :
        src.source;
      return (
        <div className="mb-4 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border-2)" }}>
          <div className="px-3 py-2 flex items-center gap-2 flex-wrap" style={{ borderBottom: "1px solid var(--border-2)", background: "var(--bg-overlay)" }}>
            <span className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>최근 Weekly 요약</span>
            {src.sourceWeek && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(129,140,248,0.12)", color: "#818cf8", border: "1px solid rgba(129,140,248,0.25)" }}>
                {src.sourceWeek}
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--bg-canvas)", color: "var(--text-muted)", border: "1px solid var(--border-2)" }}>
              {sourceLabel}
            </span>
          </div>
          <div className="px-3 py-2.5">
            <pre
              className="text-[11.5px] leading-relaxed font-sans"
              style={{ color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}
            >{preview}{isLong && !expanded ? " …" : ""}</pre>
            {isLong && (
              <button
                type="button"
                onClick={() => setWeeklyExpanded(prev => ({ ...prev, [ticketKey]: !prev[ticketKey] }))}
                className="mt-2 text-[11px] hover:underline transition-colors"
                style={{ color: "#818cf8" }}
              >
                {expanded ? "접기" : `더 보기 (전체 ${lines.length}줄)`}
              </button>
            )}
          </div>
        </div>
      );
    }

    // legacy: 원문 KV 없음 → notes 기반 합성
    const weeks = [...new Set(notes.map(n => n.sourceWeek))];
    const latestWeek = weeks.sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0)).at(-1)!;
    const latestNotes = notes.filter(n => n.sourceWeek === latestWeek);
    const progress = latestNotes.filter(n => n.type === "progress");
    const risks    = latestNotes.filter(n => n.type === "risk");
    const actions  = latestNotes.filter(n => n.type === "next_action" && n.status === "open");
    return (
      <div className="mb-4 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border-2)" }}>
        <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border-2)", background: "var(--bg-overlay)" }}>
          <span className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>최근 Weekly 요약</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(129,140,248,0.12)", color: "#818cf8", border: "1px solid rgba(129,140,248,0.25)" }}>{latestWeek}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--bg-canvas)", color: "var(--text-muted)", border: "1px solid var(--border-2)" }}>legacy</span>
        </div>
        <div className="px-3 py-2 space-y-1.5">
          {progress.length > 0 && (
            <div className="text-[11px]">
              <div className="font-medium mb-0.5" style={{ color: "var(--text-muted)" }}>진행</div>
              <ul className="list-disc pl-4 space-y-0.5" style={{ color: "var(--text-secondary)" }}>
                {progress.map((n, i) => <li key={i}>{n.content}</li>)}
              </ul>
            </div>
          )}
          {risks.length > 0 && (
            <div className="text-[11px]">
              <div className="font-medium mb-0.5" style={{ color: "#ef4444" }}>리스크</div>
              <ul className="list-disc pl-4 space-y-0.5" style={{ color: "var(--text-secondary)" }}>
                {risks.map((n, i) => <li key={i}>{n.content}</li>)}
              </ul>
            </div>
          )}
          {actions.length > 0 && (
            <div className="text-[11px]">
              <div className="font-medium mb-0.5" style={{ color: "#fbbf24" }}>다음 액션</div>
              <ul className="list-disc pl-4 space-y-0.5" style={{ color: "var(--text-secondary)" }}>
                {actions.map((n, i) => <li key={i}>{n.content}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Jira Sync 이후 스냅샷 저장 (오늘 하루 1회, 비동기 — 실패해도 무시)
  const saveTransitionSnapshot = useCallback((
    liveTickets: Ticket[],
    latestPlanning: Record<string, unknown>,
    hiddenSet: Set<string>,
  ) => {
    const snaptickets: Record<string, TicketSnapshot> = {};
    for (const t of liveTickets) {
      if (hiddenSet.has(t.key)) continue;
      snaptickets[t.key] = buildTicketSnapshot(t.key, t.status, t.eta, latestPlanning[t.key]);
    }
    fetch("/api/transitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickets: snaptickets }),
    }).catch(() => {});
    // 저장 후 changesMode가 켜져 있으면 스냅샷 목록 갱신
    setSnapshotsLoaded(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 티켓 키 직접 추가: 입력 → JIRA 단건 조회 → 상태 + localStorage 갱신
  async function addTicket(key: string) {
    const trimmed = key.trim().toUpperCase();
    if (!trimmed) return;
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(trimmed)) {
      setAddKeyError("올바른 형식이 아닙니다. 예: TM-1234");
      return;
    }
    if (tickets.some(t => t.key === trimmed)) {
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
        setTickets(prev => [...prev, newTicket]);

        // JIRA startDate → 킥오프 자동 등록 (기존 일정 없을 때만)
        if (newTicket.startDate && !schedules[trimmed]?.find(r => r.role === "Kick-Off")) {
          const kickoffRow: RoleSchedule = {
            role: "Kick-Off",
            person: "-",
            start: newTicket.startDate,
            end: newTicket.startDate,
            status: "예정",
          };
          const newTicketSchedule = [kickoffRow, ...(schedules[trimmed] ?? []).filter(r => r.role !== "Kick-Off")];
          setSchedules(prev => ({ ...prev, [trimmed]: newTicketSchedule }));
          // subKey 방식: 해당 티켓만 업데이트
          fetch("/api/kv", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: "cc-schedules", subKey: trimmed, value: newTicketSchedule }),
          }).catch(() => {});
        }

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

        // ─── GitHub에 tickets-data.ts 커밋 (영구 저장) ──────────────────────
        // fire-and-forget: UI는 즉시 반영, GitHub 커밋은 백그라운드
        fetch("/api/tickets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "add", key: trimmed }),
        }).catch(() => {});

        setAddKeyInput("");
        // 스마트 탭 이동: 티켓 상태 기반으로 적절한 탭 자동 이동
        const smartTab = (() => {
          if (trimmed.startsWith("ETR-")) return "요청 검토 중";
          if (["론치완료", "완료", "배포완료"].includes(newTicket.status)) return "완료";
          if (["개발중", "In Progress", "QA중"].includes(newTicket.status)) return "진행 중";
          return "플래닝 대기·검토";
        })();
        setPlanningTab(smartTab);
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
    const dupKeys = keys.filter(k => tickets.some(t => t.key === k));
    const newKeys = keys.filter(k => !tickets.some(t => t.key === k));

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
      setTickets(prev => [...prev, ...fetched]);

      // JIRA startDate → 킥오프 자동 등록 (기존 일정 없을 때만)
      const ticketsWithStart = fetched.filter(t => t.startDate && !schedules[t.key]?.find(r => r.role === "Kick-Off"));
      if (ticketsWithStart.length > 0) {
        // subKey 방식: 각 티켓 별로 개별 업데이트 (전체 덮어쓰기 방지)
        for (const t of ticketsWithStart) {
          const kickoffRow: RoleSchedule = {
            role: "Kick-Off",
            person: "-",
            start: t.startDate!,
            end: t.startDate!,
            status: "예정",
          };
          const newTicketSchedule = [kickoffRow, ...(schedules[t.key] ?? []).filter(r => r.role !== "Kick-Off")];
          setSchedules(prev => ({ ...prev, [t.key]: newTicketSchedule }));
          fetch("/api/kv", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: "cc-schedules", subKey: t.key, value: newTicketSchedule }),
          }).catch(() => {});
        }
      }

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

      // ─── GitHub에 tickets-data.ts 커밋 (영구 저장) — 각 키 순차 커밋 ────────
      (async () => {
        for (const t of fetched) {
          await fetch("/api/tickets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "add", key: t.key }),
          }).catch(() => {});
        }
      })();

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
      // 스마트 탭 이동: 첫 번째 티켓 기준으로 적절한 탭 선택
      const firstTicket = fetched[0];
      const bulkSmartTab = (() => {
        if (firstTicket.key.startsWith("ETR-")) return "요청 검토 중";
        if (["론치완료", "완료", "배포완료"].includes(firstTicket.status)) return "완료";
        if (["개발중", "In Progress", "QA중"].includes(firstTicket.status)) return "진행 중";
        return "플래닝 대기·검토";
      })();
      setPlanningTab(bulkSmartTab);
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

    // kvLoaded 이전에는 로컬 상태가 KV와 불일치 → KV 쓰기 차단 (데이터 유실 방지)
    if (!kvLoaded) {
      console.warn("[hideTicket] kvLoaded=false, KV 쓰기 차단 — 잠시 후 다시 시도하세요.");
      return;
    }

    setTickets(prev => prev.filter(t => t.key !== key));
    if (selected?.key === key) { setSelected(null); setEditMode(false); }

    // ── cc-hidden-keys: KV에서 직접 읽어 병합 (로컬 stale state 의존 제거) ──
    // 로컬 state 업데이트는 즉각 반영용; KV 저장은 서버 현재값 기준으로 안전하게 처리
    const newHiddenKeys = new Set([...hiddenKeys, key]);
    hiddenKeysRef.current = newHiddenKeys;
    setHiddenKeys(newHiddenKeys);

    // cc-hidden-keys: KV 현재값 읽기 → key 추가 → 저장 (race-safe)
    fetch("/api/kv?keys=cc-hidden-keys,cc-hidden-meta")
      .then(r => r.json())
      .then(data => {
        const serverHidden: string[] = Array.isArray(data["cc-hidden-keys"]) ? data["cc-hidden-keys"] : [];
        const serverMeta: { key: string; summary: string }[] = Array.isArray(data["cc-hidden-meta"]) ? data["cc-hidden-meta"] : [];
        const mergedHidden = Array.from(new Set([...serverHidden, key]));
        const mergedMeta = [
          ...serverMeta.filter((m: { key: string }) => m.key !== key),
          ...(removedTicket ? [{ key: removedTicket.key, summary: removedTicket.summary }] : [{ key, summary: key }]),
        ];
        setHiddenMeta(mergedMeta);
        fetch("/api/kv", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "cc-hidden-keys", value: mergedHidden }) }).catch(() => {});
        fetch("/api/kv", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "cc-hidden-meta", value: mergedMeta }) }).catch(() => {});
      })
      .catch(() => {
        // fallback: 로컬 state 기준으로 저장
        fetch("/api/kv", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "cc-hidden-keys", value: [...newHiddenKeys] }) }).catch(() => {});
        fetch("/api/kv", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "cc-hidden-meta", value: newHiddenMeta }) }).catch(() => {});
      });

    // ⚠️ cc-custom-keys / cc-custom-tickets 는 여기서 절대 건드리지 않음
    // 숨김 처리는 cc-hidden-keys 관리만의 책임 — customKeys 상태가 stale일 경우
    // cc-custom-keys를 []로 덮어써 전체 데이터가 유실되는 버그 방지

    // Activity 기록 (fire-and-forget)
    fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verb: "hidden",
        ticketKey: key,
        actor: userName,
        at: new Date().toISOString(),
      }),
    }).catch(() => {});
  }

  // 숨긴 티켓 복원
  async function restoreTicket(key: string) {
    // hiddenKeys / hiddenMeta에서 제거
    const newHiddenKeys = new Set([...hiddenKeys].filter(k => k !== key));
    const newHiddenMeta = hiddenMeta.filter(m => m.key !== key);
    hiddenKeysRef.current = newHiddenKeys;
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

    // Activity 기록 (fire-and-forget)
    fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verb: "unhidden",
        ticketKey: key,
        actor: userName,
        at: new Date().toISOString(),
      }),
    }).catch(() => {});
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

    // ?ticket= URL sync — prevSelectedRef로 null→null(초기) vs non-null→null(명시적 해제) 구분
    //
    // 왜 isFirstSelectedRender가 아니라 prevSelectedRef를 쓰는가:
    // React 18 StrictMode는 development에서 effects를 mount→cleanup→remount 이중 실행.
    // "isFirstRender" ref는 첫 번째 mount에서 false로 바뀌지만 ref 값이 remount에 보존되므로
    // 두 번째 mount에서 guard가 작동하지 않고 ticket= 이 삭제된다.
    //
    // prevSelectedRef 방식:
    // - null → null  (초기 mount, StrictMode remount): URL 변경 안 함 ✅
    // - null → Ticket (deep-link 또는 클릭):           ticket= 추가 ✅
    // - Ticket → null (명시적 deselect):               ticket= 제거 ✅
    const prevSelected = prevSelectedRef.current;
    prevSelectedRef.current = selected;

    if (selected) {
      // 티켓 선택 — ticket= 파라미터를 현재 URL에 추가/갱신
      const params = new URLSearchParams(window.location.search);
      params.set("ticket", selected.key);
      const newUrl = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
      window.history.replaceState(window.history.state, "", newUrl);
    } else if (prevSelected !== null) {
      // 명시적 deselect (non-null → null) — ticket= 제거
      const params = new URLSearchParams(window.location.search);
      params.delete("ticket");
      const newUrl = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
      window.history.replaceState(window.history.state, "", newUrl);
    }
    // else: null → null (초기 마운트 / StrictMode remount) — URL 변경 없음
  }, [selected]);

  // 진입 시 ?ticket= / ?ptab= / ?tab= / ?focus= / ?source= URL 파라미터 처리
  // ⚠️ deepLinkParamsRef(렌더 시점 캡처) 대신 useEffect 내부에서 window.location.search를 읽음.
  //    이유: Next.js App Router 클라이언트 내비게이션은 React 트랜지션(startTransition) 사용.
  //    컴포넌트 렌더가 history.pushState보다 먼저 발생할 수 있어 렌더 시점 캡처가 빈 값일 수 있음.
  //    useEffect는 커밋(commit) 이후 실행되므로 이 시점에는 window.location이 반드시 최신.
  //    selected useEffect의 null→null 방어(prevSelectedRef)가 적용되어 있어 ticket= 삭제 없음.
  useEffect(() => {
    if (tickets.length === 0) return;
    // 이미 처리 완료된 경우 skip (tickets 변경마다 중복 실행 방지)
    if (deepLinkProcessedRef.current) return;

    // useEffect 내부에서 읽기 → Next.js 내비게이션 커밋 이후 항상 최신 URL 보장
    const params      = new URLSearchParams(window.location.search);
    const ticketParam = params.get("ticket");
    const ptabParam   = params.get("ptab");   // lifecycle 탭 (planningTab)
    const tabParam    = params.get("tab");    // detail panel 탭
    const focusParam  = params.get("focus");
    const sourceParam = params.get("source");
    const modeParam   = params.get("mode");   // "focus" → Focus Mode 자동 진입

    if (!ticketParam) return;

    if (process.env.NODE_ENV === "development") {
      console.debug("[TicketBoard] deepLink 처리 시작", {
        ticket:     ticketParam,
        ptab:       ptabParam,
        tab:        tabParam,
        focus:      focusParam,
        source:     sourceParam,
        ticketsLen: tickets.length,
        currentUrl: window.location.href,
      });
    }

    const match = tickets.find(t => t.key === ticketParam);

    if (!match) {
      if (process.env.NODE_ENV === "development") {
        console.debug("[TicketBoard] deepLink: match 없음 (다음 tickets 변경 시 재시도)", { ticketParam });
      }
      return; // match 없으면 processed 표시 안 함 — 다음 로드 때 재시도
    }

    // ── 1. lifecycle 탭 결정 ─────────────────────────────────────────────────
    // priority: ?ptab= query > ticket.status 기반 자동 계산
    const VALID_PTABS = ["전체", "진행 중", "플래닝 대기·검토", "요청 검토 중", "완료"];

    function calcPlanningTab(status: string): string {
      const DONE_T     = ["론치완료", "완료", "배포완료", "개발완료"];
      const ACTIVE_T   = [
        "개발중", "QA", "QA중", "진행중", "In Progress", "In Review",
        "디자인중", "개발 진행중", "검수중", "기획중", "기획완료", "디자인완료",
      ];
      const ETR_T      = ["요청 검토 중", "ETR 검토"];
      const PLANNING_T = ["준비중", "대기중", "SUGGESTED", "Backlog", "플래닝 대기"];
      if (DONE_T.includes(status))     return "완료";
      if (ETR_T.includes(status))      return "요청 검토 중";
      if (ACTIVE_T.includes(status))   return "진행 중";
      if (PLANNING_T.includes(status)) return "플래닝 대기·검토";
      return "전체";
    }

    const targetTab =
      (ptabParam && VALID_PTABS.includes(ptabParam))
        ? ptabParam
        : calcPlanningTab(match.status);

    // lifecycle 탭 먼저 적용 (preFiltered 재계산이 setSelected보다 앞서야 함)
    setPlanningTab(targetTab);

    // ── 2. detail panel 탭 ──────────────────────────────────────────────────
    if (tabParam === "ops" || tabParam === "overview") {
      setDetailTab(tabParam);
    }

    // ── 3. owner_dashboard deep-link context 저장 ───────────────────────────
    if (sourceParam === "owner_dashboard" && focusParam) {
      setFocusForKey(ticketParam);
      setFocusContext(focusParam);
    }

    // ── 3b. workspaceNavRef — 진입 경로 기록 ────────────────────────────────
    workspaceNavRef.current = {
      source:              sourceParam,
      fromOwnerDashboard:  sourceParam === "owner_dashboard" && modeParam === "focus",
      entryFocus:          focusParam,
      prevPtab:            planningTab, // 진입 전 탭 상태 보존
      prevScrollY:         window.scrollY,
    };

    // ── 3c. mode=focus 자동 진입 (owner_dashboard → Focus Mode 직행) ─────────
    const autoFocus = sourceParam === "owner_dashboard" && modeParam === "focus";

    // ── 4. selected 설정 + scroll ────────────────────────────────────────────
    // deepLinkProcessedRef = true: match를 찾아 처리에 진입했으므로 중복 실행 차단
    deepLinkProcessedRef.current = true;

    if (process.env.NODE_ENV === "development") {
      console.debug("[TicketBoard] deepLink: match 발견, setSelected 예약", {
        ticketParam, matchKey: match.key, targetTab: (ptabParam ?? "auto"), tabParam,
      });
    }

    // setTimeout(0): planningTab state 업데이트 flush 후 다음 프레임에서 selected 설정
    // → preFiltered에 티켓이 포함된 상태로 상세 패널 오픈
    setTimeout(() => {
      if (process.env.NODE_ENV === "development") {
        console.debug("[TicketBoard] deepLink: setSelected 실행", { matchKey: match.key, autoFocus });
      }
      setSelected(match);

      // mode=focus (owner_dashboard → Focus Mode 직행)
      if (autoFocus) {
        // Focus 진입 전 scroll/ptab 저장 (진입 시점 기준)
        workspaceNavRef.current.prevScrollY = window.scrollY;
        workspaceNavRef.current.prevPtab    = planningTab;
        setIsDetailExpanded(true);
        // Focus Mode에서는 row 스크롤 불필요 — 워크스페이스 패널이 primary
        return;
      }

      // 렌더 완료 후 row 가시성 확인
      setTimeout(() => {
        const el = document.querySelector<Element>(`[data-ticket-key="${ticketParam}"]`);
        if (el) {
          // 정상 — 해당 row로 스크롤
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          // Fallback: 필터/탭 조건 때문에 안 보이면 "전체" 탭으로 재시도
          if (process.env.NODE_ENV === "development") {
            console.debug("[TicketBoard] deepLink: row DOM 없음 — 전체 탭으로 fallback", { ticketParam });
          }
          setPlanningTab("전체");
          setTimeout(() => {
            document.querySelector(`[data-ticket-key="${ticketParam}"]`)
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 200);
        }
      }, 200);
    }, 0);
  }, [tickets]); // eslint-disable-line react-hooks/exhaustive-deps

  // focus context 기반 섹션 자동 스크롤 + 하이라이트
  // selected ticket이 focusForKey와 일치할 때만 동작 (다른 row 클릭 시 무시)
  useEffect(() => {
    if (!selected || !focusContext || selected.key !== focusForKey) return;
    // planning 관련 focus → planningOpen 강제 열기
    if (focusContext === "planning") setPlanningOpen(true);
    // 탭 렌더 완료 후 스크롤 (detailTab 세팅 → 렌더 → 350ms 후)
    // Focus Mode(isDetailExpanded)에서는 data-fm-section, 일반에서는 data-focus-section 사용
    const timer = setTimeout(() => {
      // Focus Mode: 우측 컬럼의 data-fm-section 우선 탐색
      const fmKey =
        focusContext === "planning" || focusContext === "review-needed" ? "planning" :
        focusContext === "schedule" || focusContext === "no-schedule" || focusContext === "no-launch" ? "schedule" :
        null;
      const el =
        (fmKey && document.querySelector<HTMLElement>(`[data-fm-section="${fmKey}"]`)) ??
        document.querySelector<HTMLElement>(`[data-focus-section="${focusContext}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        setSectionHighlight(focusContext);
        // 3.5초 후 highlight 자동 해제
        setTimeout(() => setSectionHighlight(null), 3500);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [selected?.key, focusContext]); // eslint-disable-line react-hooks/exhaustive-deps

  // TODO [ACTIVITY]: Activity 탭 비노출 중 — detailTab이 "activity"로 복원되면 overview로 fallback.
  // 고도화 완료 시: setDetailTab("overview") 제거 → 아래 주석 fetch 로직 복원.
  useEffect(() => {
    if (!selected || detailTab !== "activity") return;
    // Activity 탭이 숨겨져 있으므로 overview로 강제 전환
    setDetailTab("overview");
    // [복원용] 아래 코드를 다시 활성화하면 Activity 탭 데이터 로드 재개
    // setActivityLoading(true);
    // fetch(`/api/activity?ticketKey=${encodeURIComponent(selected.key)}`)
    //   .then(r => r.json())
    //   .then(d => { if (Array.isArray(d.entries)) setActivityLog(d.entries); })
    //   .catch(() => {})
    //   .finally(() => setActivityLoading(false));
  }, [selected?.key, detailTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ESC → 집중 보기 해제
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isDetailExpanded) {
        setIsDetailExpanded(false);
        window.history.replaceState({ ...(window.history.state ?? {}), expanded: false }, "");
        // ESC: prevPtab 복원 + scroll 복원 + selected row scrollIntoView
        const { prevPtab, prevScrollY } = workspaceNavRef.current;
        if (prevPtab && prevPtab !== planningTab) setPlanningTab(prevPtab);
        window.scrollTo({ top: prevScrollY, behavior: "instant" as ScrollBehavior });
        if (selected) {
          setTimeout(() => {
            document.querySelector<Element>(`[data-ticket-key="${selected.key}"]`)
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 80);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isDetailExpanded, selected]);

  // Action Resolve 감지 — Focus Mode에서 selected ticket의 action 수 감소 시 toast
  useEffect(() => {
    if (!selected || !isDetailExpanded) return;
    const actions = getActionItems(
      selected,
      planning[selected.key],
      schedules[selected.key] ?? selected.roles ?? [],
      etrMap[selected.key]
    );
    const prev = prevActionCountRef.current[selected.key];
    const curr = actions.length;
    if (prev !== undefined && curr < prev) {
      const resolved = prev - curr;
      setResolveToast({ count: resolved });
      const timer = setTimeout(() => setResolveToast(null), 3500);
      return () => clearTimeout(timer);
    }
    prevActionCountRef.current[selected.key] = curr;
  }, [ // eslint-disable-line react-hooks/exhaustive-deps
    selected?.key,
    isDetailExpanded,
    schedules[selected?.key ?? ""],
    planning[selected?.key ?? ""],
    etrMap[selected?.key ?? ""],
  ]);

  // TicketBoard 언마운트 시 SidebarNav 복원 (detail-panel open:false 발행)
  // 이유: selected → null 전환 없이 페이지 이동 시(예: owner_dashboard로 back)
  //       SidebarNav가 "닫힘" 상태로 남아 sidebar가 접힌 채 남는 문제를 방지.
  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent("detail-panel", { detail: { open: false } }));
    };
  }, []);

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
    // 공유 데이터: KV에서 로드 (두 요청으로 분리 — 메인 데이터 / 커스텀 티켓)
    // 1) 메인 메타데이터 (상대적으로 작은 데이터)
    const mainFetch = fetch("/api/kv?keys=cc-planning,cc-schedules,cc-memos,cc-memos-v2,cc-planning-notes,cc-ticket-notes,cc-etr,cc-hidden-keys,cc-hidden-meta,cc-ticket-added-dates,cc-weekly-notes,cc-update-candidates,cc-weekly-source-text")
      .then((r) => r.json())
      .then((data) => {
        if (data["cc-planning"])   setPlanning(data["cc-planning"]);
        if (data["cc-schedules"])  setSchedules(data["cc-schedules"]);
        if (data["cc-memos"])      setMemos(data["cc-memos"]);
        if (data["cc-memos-v2"])   setMemoHistory(data["cc-memos-v2"]);
        if (data["cc-etr"])        setEtrMap(data["cc-etr"]);
        if (data["cc-planning-notes"]) setPlanningNotes(data["cc-planning-notes"]);
        if (data["cc-ticket-notes"])   setTicketNotes(data["cc-ticket-notes"]);
        if (data["cc-weekly-notes"] && typeof data["cc-weekly-notes"] === "object" && !Array.isArray(data["cc-weekly-notes"]))
          setWeeklyNotes(data["cc-weekly-notes"] as Record<string, WeeklyNote[]>);
        if (Array.isArray(data["cc-update-candidates"]))
          setUpdateCandidates(data["cc-update-candidates"] as UpdateCandidate[]);
        if (data["cc-weekly-source-text"] && typeof data["cc-weekly-source-text"] === "object" && !Array.isArray(data["cc-weekly-source-text"]))
          setWeeklySourceTexts(data["cc-weekly-source-text"] as Record<string, WeeklySourceText>);

        // hidden keys: KV에서만 로드
        const kvHidden: string[] = Array.isArray(data["cc-hidden-keys"]) ? data["cc-hidden-keys"] : [];
        const kvHiddenSet = new Set(kvHidden);
        hiddenKeysRef.current = kvHiddenSet;
        setHiddenKeys(kvHiddenSet);
        if (kvHidden.length > 0) {
          setTickets(prev => filterVisibleTickets(prev, kvHiddenSet));
        }
        // hidden hydrate 완료 표시 — render gate 해제
        setHiddenLoaded(true);

        // hidden meta (복원용 티켓 정보): KV에서만 로드
        const kvMeta: { key: string; summary: string }[] = Array.isArray(data["cc-hidden-meta"]) ? data["cc-hidden-meta"] : [];
        setHiddenMeta(kvMeta);

        // custom keys: KV에서만 로드
        // cc-ticket-added-dates: 신규 티켓 추가 날짜 추적
        const savedDates: Record<string, string> = data["cc-ticket-added-dates"] ?? {};
        setTicketAddedDates(savedDates);
      })
      .catch(() => {});

    // 모든 티켓이 TICKET_KEYS(코드)로 관리되므로 cc-custom-tickets KV 로드 불필요
    // mainFetch 완료 후 kvLoaded = true
    mainFetch.then(() => setKvLoaded(true)).catch(() => setKvLoaded(true));
  }, []);

  // ── 브라우저 히스토리 관리 ─────────────────────────────────────
  // 정의:
  //   탭 전환          → pushState  (뒤로가기: 이전 탭 복원)
  //   티켓 상세 열기   → pushState  (뒤로가기: 패널 닫힘)
  //   티켓 간 전환     → replaceState (뒤로가기: 패널 닫힘, 중간 티켓 스택 미생성)
  //   패널 닫기(X/토글)→ history.back() (pushState 역방향 소비)
  //   펼치기/접기 토글 → replaceState (현재 항목 갱신, 별도 스택 미생성)
  //   페이지 최초 진입 → replaceState (히스토리 오염 없음)
  // expanded 를 state에 포함: ticket=null 복원 시 항상 false, 티켓 열림 복원 시 저장값 사용

  // 최초 진입 시 현재 상태를 replaceState로 기록
  // ?ticket= 파라미터가 URL에 있으면 ticket: null 대신 실제 키 값을 보존.
  // → 뒤로가기/앞으로가기(popstate) 시 history state에서 티켓을 복원할 수 있음.
  useEffect(() => {
    const initialTicket = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("ticket")
      : null;
    window.history.replaceState({ tab: planningTab, ticket: initialTicket, expanded: false }, "");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 탭 전환 — 유저 액션 전용 래퍼 (pushState 포함)
  function changeTab(newTab: string) {
    setPlanningTab(newTab);
    window.history.pushState({ tab: newTab, ticket: null, expanded: false }, "");
  }

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

  function saveSchedule(ticketKey: string, rows: RoleSchedule[]) {
    const updated = { ...schedules, [ticketKey]: rows };
    setSchedules(updated);

    // 저장 상태 → saving
    if (kvSaveTimerRef.current) clearTimeout(kvSaveTimerRef.current);
    setKvSaveStatus("saving");

    // subKey 방식: 서버가 현재 값을 읽어 해당 티켓만 교체 → race condition 최소화
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-schedules", subKey: ticketKey, value: rows }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({ error: "알 수 없는 오류" }));
          console.error("[saveSchedule] KV 저장 실패:", err);
          setKvSaveStatus("error");
        } else {
          setKvSaveStatus("saved");
        }
        kvSaveTimerRef.current = setTimeout(() => setKvSaveStatus("idle"), 3000);
      })
      .catch((e) => {
        console.error("[saveSchedule] 네트워크 오류:", e);
        setKvSaveStatus("error");
        kvSaveTimerRef.current = setTimeout(() => setKvSaveStatus("idle"), 3000);
      });
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
    // Activity 기록 (fire-and-forget)
    fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verb: "schedule_updated",
        ticketKey: selected.key,
        actor: userName,
        at: new Date().toISOString(),
        meta: { rows: editRows.length },
      }),
    }).catch(() => {});
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
    // hidden hydrate 전에는 derived state를 모두 빈 결과로 두어 flicker 방지.
    // cache hit는 loadTickets에서 hiddenLoaded를 즉시 true로 만들기 때문에 영향 없음.
    // cache miss / 첫 진입에는 fetching 표시가 떠 있으므로 빈 상태가 자연스러움.
    if (!hiddenLoaded) return [];
    const seen = new Set<string>();
    // 안전망: tickets state가 어떤 경로로든 hidden을 포함했다면 여기서 제거.
    const visible = filterVisibleTickets(tickets, hiddenKeys);
    return visible.filter(t => {
      if (seen.has(t.key)) return false;
      seen.add(t.key);
      return true;
    });
  }, [tickets, hiddenLoaded, hiddenKeys]);

  // popstate: 뒤로가기/앞으로가기 시 상태 복원 (dedupedTickets 선언 후 배치)
  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      const s = e.state as { tab?: string; ticket?: string | null; expanded?: boolean } | null;
      if (!s) return;
      if (s.tab) setPlanningTab(s.tab);
      if (s.ticket) {
        const t = dedupedTickets.find(t => t.key === s.ticket);
        if (t) {
          setSelected(t);
          setDetailTab("overview");
          setIsDetailExpanded(s.expanded ?? false);
          setEditMode(false);
          setMemoEditMode(false);
          setMemoText(getCurrentMemo(t.key)?.text ?? "");
        }
      } else {
        // history state에 ticket이 없더라도 현재 URL에 ?ticket=이 있으면 패널을 닫지 않음.
        // 이유: deep-link 진입 직후 initial replaceState가 {ticket: null}로 기록되면
        //        popstate 발생 시 잘못 패널을 닫는 상황 방지.
        //        (initial replaceState는 이제 URL ticket을 보존하지만 이중 방어)
        const currentTicket = new URLSearchParams(window.location.search).get("ticket");
        if (!currentTicket) {
          setSelected(null);
          setDetailTab("overview");
          setIsDetailExpanded(false); // 패널 닫힐 때 항상 expanded 리셋 — 공백 방지
          setEditMode(false);
          setMemoEditMode(false);
        }
        // currentTicket이 있으면 패널 상태를 그대로 유지 (deep-link 보호)
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [dedupedTickets]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sidebar 홈 클릭 → ticket workspace 완전 reset.
  // SidebarNav가 dispatch한 "home-navigate" CustomEvent를 listen.
  // navigation cleanup + UI cleanup을 동기화 — URL은 Link href="/"가 자체 처리.
  useEffect(() => {
    function handler() {
      // 1) ticket selection / detail panel / focus mode
      setSelected(null);
      setIsDetailExpanded(false);
      setFocusForKey(null);
      setFocusContext(null);
      // 2) ticket edit / memo 상태
      setEditMode(false);
      setMemoEditMode(false);
      setEditFocusKey(null);
      // 3) candidate / cleanup 패널
      setCandidatePanelOpen(false);
      setCleanupPanelOpen(false);
      setSelectedCandidateIds(new Set());
      setSelectedCleanupIds(new Set());
      setCandidateKindFilter("all");
      // 4) workspace navigation context (owner_dashboard source 등)
      workspaceNavRef.current = {
        source: null,
        fromOwnerDashboard: false,
        entryFocus: null,
        prevPtab: null,
        prevScrollY: 0,
      };
      // 5) detail-panel 닫힘 알림 → SidebarNav visible 복원
      window.dispatchEvent(new CustomEvent("detail-panel", { detail: { open: false } }));
      console.log("[home-navigate] workspace state reset complete");
    }
    window.addEventListener("home-navigate", handler);
    return () => window.removeEventListener("home-navigate", handler);
  }, []);

  const planningCounts = useMemo(() => {
    // "전체"는 ETR 제외 (preFiltered와 동일 기준, 탭 카운트 = 실제 표시 행 수 일치)
    const nonEtrCount = dedupedTickets.filter(t => !t.key.startsWith("ETR-")).length;
    const counts: Record<string, number> = { "전체": nonEtrCount, "진행 중": 0, "플래닝 대기·검토": 0, "완료": 0, "요청 검토 중": 0 };
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

  // 요약 카드·필터 기준 — 상단 탭 planningCounts와 동일하게 PLANNING_DONE_STATUSES 사용
  const DONE_STATUSES      = [...PLANNING_DONE_STATUSES];
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
      // planning KPI 클릭 필터 (플래닝 대기·검토 탭에서만 적용)
      if (planningKpiFilter && planningTab === "플래닝 대기·검토") {
        const kp = getPlanningVal(planning[t.key]);
        if (planningKpiFilter.team === "디자인") {
          if (kp.design !== planningKpiFilter.status) return false;
        } else if (planningKpiFilter.team === "Dev(전체)") {
          if (Object.keys(kp.devTracks).length > 0 || kp.dev !== planningKpiFilter.status) return false;
        } else {
          if (kp.devTracks[planningKpiFilter.team as DevTrackKey] !== planningKpiFilter.status) return false;
        }
      }
      return true;
    });
  }, [dedupedTickets, planningTab, quarters, projects, statuses, levels, assigneeFilter, domainFilter, targetFilter, search, planning, planningKpiFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // 요약 카드 — 현재 planningTab 기준(preFiltered) 집계, statusTab 무관
  const totalAll        = preFiltered.length;
  const totalDone       = preFiltered.filter((t) => DONE_STATUSES.includes(t.status)).length;
  const totalInProgress = preFiltered.filter((t) => INPROGRESS_STATUSES.includes(t.status)).length;
  // 기획·준비 = 개발중·QA중도 아니고 완료도 아닌 것 전부 (화이트리스트가 아닌 배제 방식 → 미분류 상태도 포함)
  const totalPlanned    = preFiltered.filter((t) => !INPROGRESS_STATUSES.includes(t.status) && !DONE_STATUSES.includes(t.status)).length;

  // 세분화 카운트
  const totalPlan    = preFiltered.filter((t) => ["기획중", "기획완료"].includes(t.status)).length;
  const totalDesign  = preFiltered.filter((t) => ["디자인중", "디자인완료"].includes(t.status)).length;
  const totalReady   = preFiltered.filter((t) => t.status === "준비중").length;
  const totalDev     = preFiltered.filter((t) => ["개발중", "In Progress"].includes(t.status)).length;
  const totalQA      = preFiltered.filter((t) => t.status === "QA중").length;

  const done       = totalDone;
  const inProgress = totalInProgress;
  const planned    = totalPlanned;

  // 플래닝 대기·검토 탭 전용 — 팀별(Design / SP / PP / CFE / 기타) 상태 집계
  const planningTeamCounts = useMemo(() => {
    type Bucket = { 대기중: number; 검토중: number; 완료: number; 대상아님: number };
    const empty = (): Bucket => ({ 대기중: 0, 검토중: 0, 완료: 0, 대상아님: 0 });
    const design: Bucket = empty();
    const sp: Bucket     = empty();
    const pp: Bucket     = empty();
    const cfe: Bucket    = empty();
    const mobile: Bucket = empty();
    const dfe: Bucket    = empty();
    const qa: Bucket     = empty();
    const etc: Bucket    = empty();
    const devLegacy: Bucket = empty(); // devTracks 없는 구형 dev 필드

    for (const t of preFiltered) {
      const p = getPlanningVal(planning[t.key]);
      // 디자인 트랙
      design[p.design]++;
      // dev 트랙
      const entries = Object.entries(p.devTracks) as [DevTrackKey, TrackState][];
      if (entries.length > 0) {
        for (const [tk, state] of entries) {
          if (tk === "SP")          sp[state]++;
          else if (tk === "PP")     pp[state]++;
          else if (tk === "CFE")    cfe[state]++;
          else if (tk === "Mobile") mobile[state]++;
          else if (tk === "DFE")    dfe[state]++;
          else if (tk === "QA")     qa[state]++;
          else                      etc[state]++;
        }
      } else {
        // devTracks 없는 구형 레코드 → 통합 Dev 버킷으로
        devLegacy[p.dev]++;
      }
    }

    // 실제 데이터가 있는 트랙만 반환 (모두 0이면 숨김)
    const hasData = (b: Bucket) => b.대기중 + b.검토중 + b.완료 + b.대상아님 > 0;
    return [
      { label: "디자인",    color: "#c084fc", bucket: design },
      { label: "SP",       color: "#60a5fa", bucket: sp,     hide: !hasData(sp) },
      { label: "PP",       color: "#34d399", bucket: pp,     hide: !hasData(pp) },
      { label: "CFE",      color: "#fb923c", bucket: cfe,    hide: !hasData(cfe) },
      { label: "Mobile",   color: "#2dd4bf", bucket: mobile, hide: !hasData(mobile) },
      { label: "DFE",      color: "#38bdf8", bucket: dfe,    hide: !hasData(dfe) },
      { label: "QA",       color: "#a3e635", bucket: qa,     hide: !hasData(qa) },
      { label: "기타 Dev", color: "#94a3b8", bucket: etc,    hide: !hasData(etc) },
      { label: "Dev(전체)", color: "#818cf8", bucket: devLegacy, hide: !hasData(devLegacy) },
    ].filter(r => !r.hide);
  }, [preFiltered, planning]); // eslint-disable-line react-hooks/exhaustive-deps

  // 최근 2주 기준 날짜
  const TWO_WEEKS_AGO = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 14);
    return d.toISOString().split("T")[0];
  }, []);

  const isRecentTicket = (key: string) => (ticketAddedDates[key] ?? "") >= TWO_WEEKS_AGO;

  // statusTab + 정렬 적용 (렌더용)
  const filtered = useMemo(() => {
    let result = statusTab === "전체"   ? [...preFiltered]
      : statusTab === "완료"     ? preFiltered.filter((t) => DONE_STATUSES.includes(t.status))
      : statusTab === "진행중"   ? preFiltered.filter((t) => INPROGRESS_STATUSES.includes(t.status))
      : statusTab === "기획"     ? preFiltered.filter((t) => ["기획중", "기획완료"].includes(t.status))
      : statusTab === "디자인"   ? preFiltered.filter((t) => ["디자인중", "디자인완료"].includes(t.status))
      : statusTab === "준비중"   ? preFiltered.filter((t) => t.status === "준비중")
      : statusTab === "개발"     ? preFiltered.filter((t) => ["개발중", "In Progress"].includes(t.status))
      : statusTab === "QA"       ? preFiltered.filter((t) => t.status === "QA중")
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
    } else if (sortBy === "ticketNo") {
      const ticketNum = (key: string) => {
        const m = key.match(/(\d+)$/);
        return m ? parseInt(m[1], 10) : 0;
      };
      result.sort((a: Ticket, b: Ticket) => ticketNum(a.key) - ticketNum(b.key));
    }
    return result;
  }, [preFiltered, statusTab, sortBy, priorities, reviewFilter, newFilter, planning, ticketAddedDates]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus Mini Rail: owner_dashboard source 진입 시 Action 우선순위 기반 정렬
  // focusForKey !== null = owner_dashboard source 진입 신호 (state이므로 reactive ✅)
  // status → phase 매핑 (Focus Mode rail에서 현재 phase 표시용)
  const statusToPhase = (status: string): NonNullable<RoleSchedule["phase"]> | null => {
    if (/론치완료|배포완료/.test(status))            return "Launch";
    if (/QA중|QA/.test(status))                       return "QA";
    if (/개발완료/.test(status))                       return "Release";
    if (/개발중|In Progress/.test(status))            return "개발";
    if (/디자인중|디자인완료/.test(status))           return "디자인";
    if (/기획중|기획완료/.test(status))                return "기획";
    if (/준비중|Backlog|SUGGESTED/.test(status))      return "Kick-Off";
    return null;
  };

  const railItems = useMemo<{
    ticket: Ticket;
    topAction: ReturnType<typeof getActionItems>[0] | null;
    indicators: {
      phase: NonNullable<RoleSchedule["phase"]> | null;
      candidateCount: number;
      actionCount: number;
      riskCount: number;
      cleanupCount: number;
    };
  }[]>(() => {
    const base = filtered.map(t => {
      // schedule rows에서 가장 활성 phase (없으면 status 기반 fallback)
      const rows = schedules[t.key] ?? [];
      const activeSched = rows.find(r => r.status === "진행중") ?? rows.find(r => r.status === "예정");
      const phase: NonNullable<RoleSchedule["phase"]> | null =
        (activeSched?.phase ?? (activeSched ? inferPhase(activeSched.role) : null))
        ?? statusToPhase(t.status);
      // candidate / action / risk / cleanup 카운트
      const candidateCount = updateCandidates.filter(c => c.ticketKey === t.key && !c.resolved).length;
      const notes = (weeklyNotes[t.key] ?? []).filter(n => n.status === "open");
      const actionCount = notes.filter(n => n.type === "next_action").length;
      const riskCount   = notes.filter(n => n.type === "risk").length;
      const cleanupCount = rows.filter(r => isCleanupCandidate(r).isCleanup).length;
      return {
        ticket: t,
        topAction: getActionItems(t, planning[t.key], rows.length > 0 ? rows : (t.roles ?? []), etrMap[t.key])[0] ?? null,
        indicators: { phase, candidateCount, actionCount, riskCount, cleanupCount },
      };
    });
    if (!focusForKey) return base;
    // owner_dashboard 진입: 현재 선택 티켓 최상단 → 나머지는 action priority 오름차순
    return [...base].sort((a, b) => {
      if (a.ticket.key === selected?.key) return -1;
      if (b.ticket.key === selected?.key) return 1;
      const pa = a.topAction?.priority ?? 999;
      const pb = b.topAction?.priority ?? 999;
      return pa - pb;
    });
  }, [filtered, focusForKey, selected?.key, planning, schedules, etrMap, updateCandidates, weeklyNotes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── changesMode: 스냅샷 로드 → Transition 계산 ────────────────
  useEffect(() => {
    if (!changesMode || snapshotsLoaded) return;
    fetch("/api/transitions")
      .then(r => r.json())
      .then((data: { snapshots?: SnapshotSet[]; baselineAt?: string }) => {
        const snapshots = data.snapshots ?? [];
        setSnapshotCount(snapshots.length);
        setBaselineAt(data.baselineAt ?? null);
        const snap = selectCompareSnapshot(snapshots, 7);
        setCompareSnapshot(snap);
        if (snap) {
          // 현재 라이브 상태를 스냅샷으로 변환
          // planning은 현재 React state 사용 — 스냅샷 API는 서버 planning 기준으로 저장되어 있음
          const currSnaps: Record<string, TicketSnapshot> = {};
          for (const t of tickets) {
            if (hiddenKeys.has(t.key)) continue;
            currSnaps[t.key] = buildTicketSnapshot(t.key, t.status, t.eta, planning[t.key]);
          }
          // computeAllTransitions now returns TransitionResult { transitions, newlyAdded }
          const result: TransitionResult = computeAllTransitions(snap, currSnaps, hiddenKeys);
          setTransitionMap(result.transitions);
          setTransitionNewlyAdded(new Set(result.newlyAdded));
        } else {
          setTransitionMap(new Map());
          setTransitionNewlyAdded(new Set());
        }
        setSnapshotsLoaded(true);
      })
      .catch(() => { setSnapshotsLoaded(true); });
  }, [changesMode, snapshotsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // changesMode 해제 시 상태 초기화
  useEffect(() => {
    if (!changesMode) {
      setTransitionMap(new Map());
      setTransitionNewlyAdded(new Set());
      setTransitionFilter("all");
      setCompareSnapshot(null);
      setSnapshotsLoaded(false);
      setChangesExpanded(false);
      setSnapshotCount(0);
      setBaselineAt(null);
    }
  }, [changesMode]);

  // displayItems: changesMode 시 transition/신규 있는 티켓만 표시 (Focus Mode 제외)
  const displayItems = useMemo(() => {
    if (isDetailExpanded) return railItems; // Focus Mode: 전체 유지
    if (!changesMode || (transitionMap.size === 0 && transitionNewlyAdded.size === 0)) return railItems;
    return railItems.filter(({ ticket: t }) => {
      if (transitionFilter === "newly_added") return transitionNewlyAdded.has(t.key);
      const kinds = transitionMap.get(t.key);
      const hasTransition = !!kinds && kinds.length > 0;
      if (transitionFilter === "all") return hasTransition || transitionNewlyAdded.has(t.key);
      return hasTransition && kinds!.includes(transitionFilter as TransitionKind);
    });
  }, [railItems, isDetailExpanded, changesMode, transitionMap, transitionNewlyAdded, transitionFilter]);

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

  async function addWikiLink(ticketKey: string) {
    const url = wikiInput.trim();
    if (!url) return;
    if (!/^https?:\/\//.test(url)) {
      setWikiError("올바른 URL을 입력해주세요 (https://...)");
      return;
    }
    const current = etrMap[ticketKey] ?? { source: "자체발의" as const };
    const prev = current.wikiLinks ?? [];
    if (prev.some(w => w.url === url)) {
      setWikiError("이미 추가된 링크입니다");
      return;
    }

    // 제목: 직접 입력 > API 조회 > URL 파싱 fallback
    let title = wikiTitleInput.trim();
    if (!title) {
      try {
        const res = await fetch(`/api/fetch-title?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        title = data.title || extractWikiTitle(url);
      } catch {
        title = extractWikiTitle(url);
      }
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

  async function updateWikiLink(ticketKey: string, originalUrl: string) {
    const url = wikiEditInput.trim();
    if (!url) return;
    if (!url.startsWith("http")) { setWikiError("URL은 http로 시작해야 합니다."); return; }
    const current = etrMap[ticketKey];
    const prev = current?.wikiLinks ?? [];
    if (url !== originalUrl && prev.some(w => w.url === url)) { setWikiError("이미 추가된 링크입니다"); return; }

    // 제목: 직접 입력 > API 조회 > URL 파싱 fallback
    let title = wikiEditTitleInput.trim();
    if (!title) {
      try {
        const res = await fetch(`/api/fetch-title?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        title = data.title || extractWikiTitle(url);
      } catch {
        title = extractWikiTitle(url);
      }
    }

    const updated = prev.map(w => w.url === originalUrl ? { url, title } : w);
    saveEtr({ ...etrMap, [ticketKey]: { ...(current ?? {}), wikiLinks: updated } });
    setWikiEditUrl(null);
    setWikiEditInput("");
    setWikiEditTitleInput("");
    setWikiError(null);
  }

  function handleBackgroundClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!selected) return;
    const target = e.target as HTMLElement;
    // 인터랙티브 요소 또는 티켓 행 위 클릭은 무시
    if (target.closest('button, input, select, textarea, a, [data-ticket-key], [data-interactive], [role="dialog"]')) return;
    // Focus Mode 배경 클릭 → Split View로만 전환 (history.back() 금지)
    // 이유: Focus Mode에서 background click 시 의도치 않게 owner_dashboard로 이동하는 것을 방지.
    //      Split View에서 배경 클릭은 패널 닫기(history.back()) 유지.
    if (isDetailExpanded) {
      setIsDetailExpanded(false);
      window.history.replaceState({ ...(window.history.state ?? {}), expanded: false }, "");
      // Split View 복귀 시 선택 행 스크롤 복원
      if (selected) {
        setTimeout(() => {
          document.querySelector<Element>(`[data-ticket-key="${selected.key}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 80);
      }
      return; // Split View 전환만 — 패널은 열린 채 유지
    }
    window.history.back();
  }

  function handleSelect(t: Ticket) {
    const isSame = selected?.key === t.key;

    if (isSame) {
      // 같은 티켓 재클릭 = 닫기 → 히스토리 되감기
      window.history.back();
      return;
    }

    if (selected) {
      // 다른 티켓으로 전환: 히스토리 스택 중복 방지 → replace
      window.history.replaceState({ tab: planningTab, ticket: t.key, expanded: isDetailExpanded }, "");
    } else {
      // 새로 열기 → push (뒤로가기로 닫을 수 있게)
      window.history.pushState({ tab: planningTab, ticket: t.key, expanded: isDetailExpanded }, "");
    }

    setSelected(t);
    setDetailTab("overview");
    setEditMode(false);
    setMemoEditMode(false);
    setMemoCollapsed(true);
    setMemoHistoryOpen(false);
    setRegenError(null);
    setShowFullDoneSchedule(false);
    setNoteInput("");
    setEtrInput("");
    // 직접 row 클릭 시 owner_dashboard focus context 해제
    setFocusForKey(null);
    setFocusContext(null);
    setSectionHighlight(null);
    setEtrError(null);
    setMemoText(getCurrentMemo(t.key)?.text ?? "");
    const p = getPlanningVal(planning[t.key]);
    setPlanningOpen(!(p.design === "완료" && p.dev === "완료"));
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
      <div onClick={handleBackgroundClick} className={`${isDetailExpanded ? "shrink-0 overflow-hidden" : "flex-1 min-w-0"} ${isDetailExpanded ? "px-0 pt-0 pb-0" : "px-3 py-8"} overflow-hidden`} style={{ background: "var(--bg-canvas)", ...(isDetailExpanded ? { width: "220px", borderRight: "1px solid var(--border-2)" } : {}) }}>
        {isDetailExpanded && (
          <div className="flex items-center justify-between px-3 py-2.5 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="flex items-center gap-1.5">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <rect x="0.5" y="1.5" width="3" height="8" rx="0.75" fill="#818cf8" opacity="0.5"/>
                <rect x="5" y="1.5" width="5.5" height="8" rx="0.75" fill="#818cf8"/>
              </svg>
              <span className="text-[11px] font-semibold" style={{ color: "#818cf8" }}>
                {focusForKey ? "우선순위 큐" : "집중 보기"}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>{filtered.length}</span>
            </div>
            <button
              onClick={() => {
                setIsDetailExpanded(false);
                window.history.replaceState({ ...(window.history.state ?? {}), expanded: false }, "");
              }}
              title="기본 보기로 (ESC)"
              className="flex items-center justify-center w-5 h-5 rounded transition-colors hover:opacity-100 opacity-50"
              style={{ color: "var(--text-muted)" }}
            >
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M5.5 1.5L2 4.5l3.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
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
            {weeklySyncMsg && (
              <span className="text-xs text-indigo-500 font-medium">{weeklySyncMsg}</span>
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
              style={{ background: "var(--bg-item)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}
            >
              <svg className={`w-3 h-3 ${fetching ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {fetching ? "Syncing…" : "Jira Sync"}
            </button>
            {/* ⚡ 일정 변경 감지 — 클릭 시 검토 패널 (Phase 4) */}
            {updateCandidates.filter(c => !c.resolved).length > 0 && (
              <button
                type="button"
                onClick={() => setCandidatePanelOpen(true)}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition hover:brightness-110 active:scale-95"
                style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.35)", color: "#fbbf24" }}
                title="클릭하여 Weekly에서 들어온 일정 변경 제안을 검토 / 승인 / 기각"
              >
                ⚡ 일정 변경 {updateCandidates.filter(c => !c.resolved).length}건
              </button>
            )}
            {/* 🧹 정리 후보 — 자격 미달 jira_weekly row 정리 (Phase D) */}
            {(() => {
              const cleanupCount = buildCleanupCandidates().length;
              if (cleanupCount === 0) return null;
              return (
                <button
                  type="button"
                  onClick={() => setCleanupPanelOpen(true)}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition hover:brightness-110 active:scale-95"
                  style={{ background: "rgba(148,163,184,0.10)", border: "1px solid rgba(148,163,184,0.35)", color: "#94a3b8" }}
                  title="자격 미달로 분류된 weekly schedule row를 검토 / 삭제 (자동 삭제 안 함)"
                >
                  🧹 정리 후보 {cleanupCount}건
                </button>
              );
            })()}

            {/* ── Candidate Review 모달 (Phase C) ─────────────────── */}
            {candidatePanelOpen && (() => {
              const FIELD_LABEL: Record<string, string> = {
                start: "시작일", end: "종료일", status: "상태", person: "담당자",
              };
              const all = sortDisplayCandidates(buildDisplayCandidates());
              const filtered = candidateKindFilter === "all"
                ? all
                : all.filter(c => c.kind === candidateKindFilter);
              const counts = {
                total:    all.length,
                schedule: all.filter(c => c.kind === "schedule").length,
                action:   all.filter(c => c.kind === "action").length,
                risk:     all.filter(c => c.kind === "risk").length,
                note:     all.filter(c => c.kind === "note").length,
                high:     all.filter(c => c.confidence === "high").length,
                low:      all.filter(c => c.confidence === "low").length,
              };
              const visibleIds = filtered.map(c => c.id);
              const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedCandidateIds.has(id));
              const someVisibleSelected = visibleIds.some(id => selectedCandidateIds.has(id));

              // 일괄 액션 — 현재 filter 적용된 목록만 대상
              const doBulk = async (action: "apply" | "dismiss", onlySelected: boolean) => {
                const targets = onlySelected
                  ? filtered.filter(c => selectedCandidateIds.has(c.id))
                  : filtered;
                if (targets.length === 0) return;
                if (!confirm(`${targets.length}건을 ${action === "apply" ? "승인" : "기각"}하시겠습니까?`)) return;
                for (const c of targets) {
                  if (c.kind === "schedule") {
                    await resolveCandidate(c.id, action);
                  } else {
                    // action/risk/note는 "기각"만 의미 있음 (resolved 처리). "승인"도 같은 의미로 취급.
                    await resolveNote(c.ticketKey, c.id);
                  }
                }
                setSelectedCandidateIds(new Set());
              };

              return (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center px-4"
                  style={{ background: "rgba(0,0,0,0.45)" }}
                  onClick={() => setCandidatePanelOpen(false)}
                >
                  <div
                    className="rounded-xl shadow-2xl max-w-4xl w-full max-h-[85vh] overflow-y-auto"
                    style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)" }}
                    onClick={e => e.stopPropagation()}
                  >
                    {/* 헤더 + Summary */}
                    <div
                      className="px-5 py-3 sticky top-0 z-10"
                      style={{ background: "var(--bg-canvas)", borderBottom: "1px solid var(--border-2)" }}
                    >
                      <div className="flex items-center justify-between mb-2.5">
                        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                          Weekly Sync 후보 검토
                        </h2>
                        <button
                          type="button"
                          onClick={() => setCandidatePanelOpen(false)}
                          className="text-lg leading-none px-2 py-1 hover:bg-gray-100 rounded"
                          style={{ color: "var(--text-muted)" }}
                        >
                          ×
                        </button>
                      </div>
                      {/* Summary 카운트 */}
                      <div className="flex items-center flex-wrap gap-1.5 mb-2">
                        {([
                          { key: "all" as const,      label: `전체 ${counts.total}`,    color: "var(--text-secondary)" },
                          { key: "schedule" as const, label: `일정 ${counts.schedule}`, color: KIND_STYLE.schedule.color },
                          { key: "action" as const,   label: `액션 ${counts.action}`,   color: KIND_STYLE.action.color },
                          { key: "risk" as const,     label: `리스크 ${counts.risk}`,   color: KIND_STYLE.risk.color },
                          { key: "note" as const,     label: `참고 ${counts.note}`,     color: KIND_STYLE.note.color },
                        ]).map(t => {
                          const active = candidateKindFilter === t.key;
                          return (
                            <button
                              key={t.key}
                              type="button"
                              onClick={() => { setCandidateKindFilter(t.key); setSelectedCandidateIds(new Set()); }}
                              className="px-2 py-0.5 rounded text-[10px] font-medium transition"
                              style={{
                                background: active ? t.color : "transparent",
                                color: active ? "white" : t.color,
                                border: `1px solid ${t.color}55`,
                              }}
                            >
                              {t.label}
                            </button>
                          );
                        })}
                        <span className="ml-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
                          ⚡high {counts.high} · low {counts.low}
                        </span>
                      </div>
                      {/* 일괄/선택 액션 */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none" style={{ color: "var(--text-secondary)" }}>
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            ref={el => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                            onChange={() => {
                              if (allVisibleSelected) {
                                setSelectedCandidateIds(prev => {
                                  const next = new Set(prev);
                                  for (const id of visibleIds) next.delete(id);
                                  return next;
                                });
                              } else {
                                setSelectedCandidateIds(prev => {
                                  const next = new Set(prev);
                                  for (const id of visibleIds) next.add(id);
                                  return next;
                                });
                              }
                            }}
                            className="cursor-pointer"
                          />
                          현재 보기 전체 선택
                          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                            ({selectedCandidateIds.size}건 선택됨)
                          </span>
                        </label>
                        <div className="flex-1" />
                        <button
                          type="button"
                          onClick={() => doBulk("apply", true)}
                          disabled={selectedCandidateIds.size === 0}
                          className="px-2.5 py-1 text-[11px] rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed transition hover:brightness-110"
                          style={{ background: "#10b981", color: "white" }}
                        >
                          ✓ 선택 승인
                        </button>
                        <button
                          type="button"
                          onClick={() => doBulk("dismiss", true)}
                          disabled={selectedCandidateIds.size === 0}
                          className="px-2.5 py-1 text-[11px] rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
                          style={{ background: "var(--bg-item)", border: "1px solid var(--border-2)", color: "var(--text-secondary)" }}
                        >
                          ✕ 선택 기각
                        </button>
                        <span className="text-[10px] mx-1" style={{ color: "var(--text-muted)" }}>|</span>
                        <button
                          type="button"
                          onClick={() => doBulk("apply", false)}
                          disabled={filtered.length === 0}
                          className="px-2.5 py-1 text-[11px] rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed transition hover:brightness-110"
                          style={{ background: "rgba(16,185,129,0.18)", border: "1px solid rgba(16,185,129,0.45)", color: "#10b981" }}
                        >
                          전체 승인
                        </button>
                        <button
                          type="button"
                          onClick={() => doBulk("dismiss", false)}
                          disabled={filtered.length === 0}
                          className="px-2.5 py-1 text-[11px] rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
                          style={{ background: "transparent", border: "1px solid var(--border-2)", color: "var(--text-muted)" }}
                        >
                          전체 기각
                        </button>
                      </div>
                    </div>

                    {/* 본문 */}
                    <div className="p-5 space-y-2.5">
                      {filtered.length === 0 && (
                        <p className="text-xs text-center py-8" style={{ color: "var(--text-muted)" }}>
                          {counts.total === 0 ? "검토할 후보가 없습니다." : "현재 필터에 해당하는 후보가 없습니다."}
                        </p>
                      )}
                      {filtered.map(c => {
                        const inFlight = candidatesInFlight.has(c.id);
                        const isSelected = selectedCandidateIds.has(c.id);
                        const kindStyle = KIND_STYLE[c.kind];
                        const confStyle = CONF_STYLE[c.confidence];
                        const isAutoApplyDiscouraged = c.confidence === "low";

                        return (
                          <div
                            key={c.id}
                            className="rounded-lg p-3"
                            style={{
                              background: isSelected ? "rgba(129,140,248,0.06)" : "var(--bg-item)",
                              border: `1px solid ${isSelected ? "#818cf8" : "var(--border-2)"}`,
                            }}
                          >
                            <div className="flex items-start gap-2.5">
                              {/* checkbox */}
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  setSelectedCandidateIds(prev => {
                                    const next = new Set(prev);
                                    if (next.has(c.id)) next.delete(c.id);
                                    else next.add(c.id);
                                    return next;
                                  });
                                }}
                                className="mt-1 cursor-pointer"
                              />
                              <div className="flex-1 min-w-0">
                                {/* row 1: ticket + summary */}
                                <div className="flex items-center gap-2 mb-1">
                                  <a
                                    href={`https://jira.team.musinsa.com/browse/${c.ticketKey}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-xs font-semibold hover:underline"
                                    style={{ color: "#818cf8" }}
                                  >
                                    {c.ticketKey}
                                  </a>
                                  {c.ticketSummary && (
                                    <>
                                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>·</span>
                                      <span className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                                        {c.ticketSummary}
                                      </span>
                                    </>
                                  )}
                                </div>
                                {/* row 2: kind / confidence / sourceWeek / autoApplyDiscouraged */}
                                <div className="flex items-center flex-wrap gap-1.5 mb-1.5">
                                  <span
                                    className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                                    style={{ background: kindStyle.bg, color: kindStyle.color, border: `1px solid ${kindStyle.border}` }}
                                  >
                                    {KIND_LABEL[c.kind]}
                                  </span>
                                  <span
                                    className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                                    style={{ background: confStyle.bg, color: confStyle.color }}
                                  >
                                    {confStyle.label}
                                  </span>
                                  {c.sourceWeek && (
                                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                                      {c.sourceWeek}
                                    </span>
                                  )}
                                  {isAutoApplyDiscouraged && (
                                    <span
                                      className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                                      style={{ background: "rgba(251,191,36,0.10)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.30)" }}
                                      title="확인 필요 / 논의중 / 가능 여부 등으로 분류 — 자동 일정 반영 비추천"
                                    >
                                      ⚠ 자동 반영 비추천
                                    </span>
                                  )}
                                </div>
                                {/* row 3: schedule diff or note content */}
                                {c.kind === "schedule" ? (
                                  <div className="flex items-center flex-wrap gap-1.5 text-xs mb-1.5">
                                    {(() => {
                                      // c.role은 mergeKey에서 추출한 normalizedRole = resourceTeam || phase.
                                      // phase/resourceTeam을 분리해서 표시 (Core AI BE → 개발 · Core AI BE)
                                      const phase = c.role ? inferPhase(c.role) : undefined;
                                      const resourceTeam = c.role ? inferResourceTeam(c.role) : null;
                                      const primary = phase ? PHASE_LABEL[phase] : (c.role ?? "—");
                                      const showSub = !!resourceTeam && resourceTeam !== primary;
                                      return (
                                        <>
                                          <span
                                            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                                            style={{ background: "rgba(129,140,248,0.15)", color: "#818cf8" }}
                                          >
                                            {primary}
                                          </span>
                                          {showSub && (
                                            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>· {resourceTeam}</span>
                                          )}
                                        </>
                                      );
                                    })()}
                                    {c.field && (
                                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                                        {FIELD_LABEL[c.field] ?? c.field}
                                      </span>
                                    )}
                                    <span className="text-xs line-through" style={{ color: "var(--text-muted)" }}>
                                      {c.oldValue || "(빈 값)"}
                                    </span>
                                    <span style={{ color: "var(--text-muted)" }}>→</span>
                                    <span className="text-xs font-medium" style={{ color: "#10b981" }}>
                                      {c.newValue || "(빈 값)"}
                                    </span>
                                  </div>
                                ) : c.content ? (
                                  <p className="text-xs mb-1.5 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                                    {c.content}
                                  </p>
                                ) : null}
                                {/* row 4: reason */}
                                {c.reason && (
                                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                                    {c.reason}
                                  </p>
                                )}
                              </div>
                              {/* per-row action */}
                              <div className="flex gap-1 shrink-0">
                                {c.kind === "schedule" ? (
                                  <>
                                    <button
                                      type="button"
                                      disabled={inFlight}
                                      onClick={() => resolveCandidate(c.id, "apply")}
                                      className="px-2.5 py-1 text-[11px] rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed transition hover:brightness-110"
                                      style={{ background: "#10b981", color: "white" }}
                                    >
                                      {inFlight ? "…" : "✓ 승인"}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={inFlight}
                                      onClick={() => resolveCandidate(c.id, "dismiss")}
                                      className="px-2.5 py-1 text-[11px] rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
                                      style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)", color: "var(--text-secondary)" }}
                                    >
                                      ✕ 기각
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={inFlight}
                                    onClick={() => resolveNote(c.ticketKey, c.id)}
                                    className="px-2.5 py-1 text-[11px] rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
                                    style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)", color: "var(--text-secondary)" }}
                                  >
                                    {inFlight ? "…" : "✓ 확인"}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── Cleanup 모달 (Phase D) — 자격 미달 jira_weekly row 정리 ── */}
            {cleanupPanelOpen && (() => {
              const candidates = buildCleanupCandidates();
              const titleByKey = new Map(tickets.map(t => [t.key, t.summary]));
              const visibleIds = candidates.map(c => c.id);
              const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedCleanupIds.has(id));
              const someVisibleSelected = visibleIds.some(id => selectedCleanupIds.has(id));

              const doBulkDelete = async (onlySelected: boolean) => {
                const targets = onlySelected
                  ? candidates.filter(c => selectedCleanupIds.has(c.id))
                  : candidates;
                if (targets.length === 0) return;
                if (!confirm(`${targets.length}건의 row를 삭제하시겠습니까? (manual schedule은 영향 없음)`)) return;
                for (const c of targets) {
                  await deleteCleanupRow(c.ticketKey, c.rowKey, c.id);
                }
                setSelectedCleanupIds(new Set());
              };

              return (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center px-4"
                  style={{ background: "rgba(0,0,0,0.45)" }}
                  onClick={() => setCleanupPanelOpen(false)}
                >
                  <div
                    className="rounded-xl shadow-2xl max-w-4xl w-full max-h-[85vh] overflow-y-auto"
                    style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)" }}
                    onClick={e => e.stopPropagation()}
                  >
                    {/* 헤더 */}
                    <div
                      className="px-5 py-3 sticky top-0 z-10"
                      style={{ background: "var(--bg-canvas)", borderBottom: "1px solid var(--border-2)" }}
                    >
                      <div className="flex items-center justify-between mb-2.5">
                        <div>
                          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                            🧹 정리 후보 검토
                          </h2>
                          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                            {candidates.length}건 — 자격 미달로 분류된 weekly schedule row · 자동 삭제 안 함
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCleanupPanelOpen(false)}
                          className="text-lg leading-none px-2 py-1 hover:bg-gray-100 rounded"
                          style={{ color: "var(--text-muted)" }}
                        >
                          ×
                        </button>
                      </div>
                      {/* 일괄 액션 */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none" style={{ color: "var(--text-secondary)" }}>
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            ref={el => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                            onChange={() => {
                              if (allVisibleSelected) {
                                setSelectedCleanupIds(new Set());
                              } else {
                                setSelectedCleanupIds(new Set(visibleIds));
                              }
                            }}
                            className="cursor-pointer"
                          />
                          전체 선택 <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>({selectedCleanupIds.size}건 선택)</span>
                        </label>
                        <div className="flex-1" />
                        <button
                          type="button"
                          onClick={() => doBulkDelete(true)}
                          disabled={selectedCleanupIds.size === 0}
                          className="px-2.5 py-1 text-[11px] rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
                          style={{ background: "#ef4444", color: "white" }}
                        >
                          ✕ 선택 삭제
                        </button>
                        <button
                          type="button"
                          onClick={() => doBulkDelete(false)}
                          disabled={candidates.length === 0}
                          className="px-2.5 py-1 text-[11px] rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
                          style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.45)", color: "#ef4444" }}
                        >
                          전체 정리
                        </button>
                        <button
                          type="button"
                          onClick={() => setCleanupPanelOpen(false)}
                          className="px-2.5 py-1 text-[11px] rounded font-medium transition"
                          style={{ background: "transparent", border: "1px solid var(--border-2)", color: "var(--text-muted)" }}
                        >
                          무시 / 나중에
                        </button>
                      </div>
                    </div>
                    {/* 본문 */}
                    <div className="p-5 space-y-2">
                      {candidates.length === 0 && (
                        <p className="text-xs text-center py-8" style={{ color: "var(--text-muted)" }}>
                          정리 대상이 없습니다.
                        </p>
                      )}
                      {candidates.map(c => {
                        const inFlight = cleanupInFlight.has(c.id);
                        const isSelected = selectedCleanupIds.has(c.id);
                        const summary = titleByKey.get(c.ticketKey) ?? "";
                        const phase = c.row.phase ?? inferPhase(c.row.role);
                        const resourceTeam = c.row.resourceTeam ?? inferResourceTeam(c.row.role);
                        const primary = phase ? PHASE_LABEL[phase] : c.row.role;
                        const showSub = !!resourceTeam && resourceTeam !== primary;
                        return (
                          <div
                            key={c.id}
                            className="rounded-lg p-3"
                            style={{
                              background: isSelected ? "rgba(239,68,68,0.06)" : "var(--bg-item)",
                              border: `1px solid ${isSelected ? "#ef4444" : "var(--border-2)"}`,
                            }}
                          >
                            <div className="flex items-start gap-2.5">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  setSelectedCleanupIds(prev => {
                                    const next = new Set(prev);
                                    if (next.has(c.id)) next.delete(c.id);
                                    else next.add(c.id);
                                    return next;
                                  });
                                }}
                                className="mt-1 cursor-pointer"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <a
                                    href={`https://jira.team.musinsa.com/browse/${c.ticketKey}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-xs font-semibold hover:underline"
                                    style={{ color: "#818cf8" }}
                                  >
                                    {c.ticketKey}
                                  </a>
                                  {summary && (
                                    <>
                                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>·</span>
                                      <span className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{summary}</span>
                                    </>
                                  )}
                                </div>
                                <div className="flex items-center flex-wrap gap-1.5 text-xs mb-1">
                                  <span
                                    className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                                    style={{ background: "rgba(129,140,248,0.15)", color: "#818cf8" }}
                                  >
                                    {primary}
                                  </span>
                                  {showSub && (
                                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>· {resourceTeam}</span>
                                  )}
                                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                                    {c.row.start && c.row.end ? `${c.row.start} ~ ${c.row.end}` : c.row.start || c.row.end || "(날짜 없음)"}
                                  </span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--bg-canvas)", color: "var(--text-muted)", border: "1px solid var(--border-2)" }}>
                                    {c.row.status}
                                  </span>
                                  {c.row.sourceWeek && (
                                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{c.row.sourceWeek}</span>
                                  )}
                                </div>
                                {c.row.detail && (
                                  <p className="text-[11px] mb-1" style={{ color: "var(--text-muted)" }}>
                                    └ {c.row.detail}
                                    {c.row.detailPerson && <span className="ml-1">· {c.row.detailPerson}</span>}
                                  </p>
                                )}
                                {/* 메타: source / 생성·갱신 시점 / mergeKey */}
                                <div className="flex items-center flex-wrap gap-1.5 mb-1 text-[10px]" style={{ color: "var(--text-subtle)" }}>
                                  <span className="px-1.5 py-0.5 rounded" style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)" }}>
                                    source: {c.row.source ?? "jira_weekly"}
                                  </span>
                                  {weeklySourceTexts[c.ticketKey]?.policyReason && (
                                    <span style={{ color: "var(--text-muted)" }}>
                                      ({weeklySourceTexts[c.ticketKey]?.source ?? "?"})
                                    </span>
                                  )}
                                  {c.row.lastSeenAt && (
                                    <span title={`lastSeenAt: ${c.row.lastSeenAt}`}>
                                      최근 갱신 {new Date(c.row.lastSeenAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                  )}
                                  {c.row.mergeKey && (
                                    <span className="font-mono opacity-70" title={c.row.mergeKey}>
                                      key: {c.row.mergeKey.slice(0, 40)}{c.row.mergeKey.length > 40 ? "…" : ""}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10.5px]" style={{ color: "#fbbf24" }}>
                                  ⚠ 사유: {c.reason}
                                </p>
                              </div>
                              <button
                                type="button"
                                disabled={inFlight}
                                onClick={() => deleteCleanupRow(c.ticketKey, c.rowKey, c.id)}
                                className="px-2.5 py-1 text-[11px] rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed transition hover:brightness-110"
                                style={{ background: "#ef4444", color: "white" }}
                              >
                                {inFlight ? "삭제 중…" : "✕ 삭제"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* 변화 보기 토글 */}
            <button
              onClick={() => setChangesMode(v => !v)}
              title={changesMode ? "현재 상태로 돌아가기" : "이번 주 변화 보기 — Snapshot diff 기반"}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background:   changesMode ? "rgba(129,140,248,0.15)" : "var(--bg-item)",
                border:       `1px solid ${changesMode ? "#818cf8" : "var(--border-2)"}`,
                color:        changesMode ? "#818cf8" : "var(--text-primary)",
                boxShadow:    changesMode ? "0 0 0 1px rgba(129,140,248,0.3)" : "none",
              }}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M13 7l5 5-5 5M6 7l5 5-5 5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {changesMode ? "변화 보기 ON" : "변화 보기"}
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
            { key: "요청 검토 중",   label: "요청 검토 중",   desc: "ETR 티켓 — 검토 후 TM 전환" },
            { key: "완료",           label: "완료",           desc: "론치·배포 완료" },
          ] as const).map(({ key, label, desc }) => {
            const active = planningTab === key;
            return (
              <button
                key={key}
                onClick={() => changeTab(key)}
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
          // 검토필요: 탭 무관하게 전체 기준 (플래닝 대기·검토 + 요청 검토 중 포함 총합)
          const reviewCount = dedupedTickets.filter(t => getPlanningVal(planning[t.key]).reviewNeeded).length;
          // 최근 2주 신규: 현재 탭 기준
          const newCount    = preFiltered.filter(t => isRecentTicket(t.key)).length;
          if (reviewCount === 0 && !reviewFilter && newCount === 0 && !newFilter) return null;
          return (
            <div className={`flex items-center gap-2 mb-4 ${isDetailExpanded ? "hidden" : ""}`}>
              {(reviewCount > 0 || reviewFilter) && (
                <button
                  onClick={() => {
                    const next = !reviewFilter;
                    setReviewFilter(next);
                    // reviewNeeded는 cross-status attention filter —
                    // ON 시 전체 탭으로 이동해 lifecycle 무관하게 전체 표시
                    if (next) changeTab("전체");
                  }}
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
              {/* 활성 필터 chip — lifecycle 탭과 독립된 attention filter 임을 명시 */}
              {reviewFilter && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold"
                  style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(248,113,113,0.45)", color: "#f87171" }}>
                  ⚡ 검토필요 활성화
                  <button
                    title="검토필요 필터 해제"
                    onClick={() => setReviewFilter(false)}
                    className="ml-0.5 w-4 h-4 flex items-center justify-center rounded hover:bg-red-500/20 transition-colors text-[13px] leading-none"
                    style={{ color: "#f87171" }}
                  >×</button>
                </span>
              )}
              {newFilter && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold"
                  style={{ background: "rgba(56,189,248,0.10)", border: "1px solid rgba(56,189,248,0.40)", color: "#38bdf8" }}>
                  🆕 신규 활성화
                  <button
                    title="신규 티켓 필터 해제"
                    onClick={() => setNewFilter(false)}
                    className="ml-0.5 w-4 h-4 flex items-center justify-center rounded hover:bg-sky-500/20 transition-colors text-[13px] leading-none"
                    style={{ color: "#38bdf8" }}
                  >×</button>
                </span>
              )}
            </div>
          );
        })()}


        {/* ── Changes Mode 패널 ────────────────────────────────── */}
        {changesMode && !isDetailExpanded && (() => {
          // 강한 신호 요약 (compact bar용)
          const summary = summarizeTransitions(transitionMap);
          const strongSummary = summary.filter(s => STRONG_SIGNAL_KINDS.has(s.kind));
          const isStable = snapshotCount >= 3;  // 스냅샷 3개 이상이면 안정권
          const hasData   = transitionMap.size > 0 || transitionNewlyAdded.size > 0;

          return (
            <div className="mb-4 rounded-xl overflow-hidden" style={{ border: "1px solid rgba(129,140,248,0.35)", background: "rgba(129,140,248,0.05)" }}>

              {/* ── 컴팩트 바 (항상 표시) ─────────────────────── */}
              <div
                className="flex items-center justify-between px-4 py-2.5 cursor-pointer select-none"
                style={{ borderBottom: changesExpanded ? "1px solid rgba(129,140,248,0.2)" : "none" }}
                onClick={() => setChangesExpanded(v => !v)}
              >
                {/* 왼쪽: 아이콘 + 제목 + Beta 배지 + 핵심 신호 요약 */}
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2.5">
                    <path d="M13 7l5 5-5 5M6 7l5 5-5 5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="text-xs font-semibold shrink-0" style={{ color: "#818cf8" }}>이번 주 변화</span>

                  {/* Beta 배지 */}
                  <span
                    className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0"
                    style={{ background: "rgba(129,140,248,0.15)", color: "#818cf8", border: "1px solid rgba(129,140,248,0.3)" }}
                  >
                    {isStable ? "Beta" : "기준점 안정화 중"}
                  </span>

                  {/* 로딩 중 / 스냅샷 없음 */}
                  {!snapshotsLoaded && (
                    <span className="text-[11px] shrink-0" style={{ color: "var(--text-subtle)" }}>로딩 중…</span>
                  )}
                  {snapshotsLoaded && !compareSnapshot && (
                    <span className="text-[11px] shrink-0" style={{ color: "var(--text-subtle)" }}>
                      저장된 스냅샷 없음 — Jira Sync 후 재시도
                    </span>
                  )}

                  {/* 강한 신호 인라인 요약 */}
                  {snapshotsLoaded && compareSnapshot && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {strongSummary.length === 0 && !changesExpanded && (
                        <span className="text-[11px]" style={{ color: "var(--text-subtle)" }}>특이 변화 없음</span>
                      )}
                      {strongSummary.map(({ kind, count }) => {
                        const meta = TRANSITION_META[kind];
                        return (
                          <span key={kind} className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                            {meta.emoji} <strong style={{ color: meta.color }}>{count}</strong>
                          </span>
                        );
                      })}
                      {transitionNewlyAdded.size > 0 && (
                        <span className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
                          · +신규 {transitionNewlyAdded.size}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* 오른쪽: 펼치기/닫기 */}
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <button
                    onClick={e => { e.stopPropagation(); setChangesExpanded(v => !v); }}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all"
                    style={{
                      background: changesExpanded ? "rgba(129,140,248,0.15)" : "var(--bg-overlay)",
                      border: "1px solid var(--border-2)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {changesExpanded ? "접기 ▲" : "자세히 ▼"}
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); setChangesMode(false); }}
                    className="w-5 h-5 flex items-center justify-center rounded transition-colors text-[11px]"
                    style={{ color: "var(--text-subtle)" }}
                    onMouseEnter={ev => { (ev.currentTarget as HTMLElement).style.background = "rgba(129,140,248,0.15)"; }}
                    onMouseLeave={ev => { (ev.currentTarget as HTMLElement).style.background = "transparent"; }}
                    title="변화 보기 닫기"
                  >✕</button>
                </div>
              </div>

              {/* ── 확장 패널 ─────────────────────────────────── */}
              {changesExpanded && (
                <>
                  {/* 안정화 안내 배너 */}
                  {!isStable && (
                    <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(129,140,248,0.12)", background: "rgba(129,140,248,0.06)" }}>
                      <span className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
                        ⚠ 스냅샷이 {snapshotCount}개 쌓인 상태입니다 (3개 이상이면 신뢰도 향상). Jira Sync를 반복하면 기준점이 안정화됩니다.
                      </span>
                    </div>
                  )}

                  {/* 기준 스냅샷 정보 */}
                  {compareSnapshot && (
                    <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(129,140,248,0.12)" }}>
                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        비교 기준: <span style={{ color: "var(--text-secondary)" }}>{compareSnapshot.label}</span>
                      </span>
                      {baselineAt && (
                        <span className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
                          · 기준점: {(() => {
                            const d = new Date(baselineAt);
                            const dow = ["일","월","화","수","목","금","토"][d.getDay()];
                            return `${d.getMonth()+1}/${d.getDate()}(${dow}) ${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;
                          })()}
                        </span>
                      )}
                    </div>
                  )}

                  {/* 3-Group 내러티브 요약 */}
                  {hasData && (() => {
                    const progressItems = summary.filter(s => TRANSITION_GROUPS[0].kinds.includes(s.kind));
                    const attentionItems = summary.filter(s => TRANSITION_GROUPS[1].kinds.includes(s.kind));
                    return (
                      <div className="px-4 py-2.5 space-y-1.5" style={{ borderBottom: "1px solid rgba(129,140,248,0.12)" }}>
                        {progressItems.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] font-bold uppercase tracking-wider shrink-0 w-20" style={{ color: "#818cf8" }}>진행 변화</span>
                            {progressItems.map(({ kind, count }) => {
                              const meta = TRANSITION_META[kind];
                              return (
                                <span key={kind} className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                                  {meta.emoji} <strong style={{ color: meta.color }}>{count}건</strong> {meta.label}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {attentionItems.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] font-bold uppercase tracking-wider shrink-0 w-20" style={{ color: "#f59e0b" }}>Attention</span>
                            {attentionItems.map(({ kind, count }) => {
                              const meta = TRANSITION_META[kind];
                              return (
                                <span key={kind} className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                                  {meta.emoji} <strong style={{ color: meta.color }}>{count}건</strong> {meta.label}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {transitionNewlyAdded.size > 0 && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider shrink-0 w-20" style={{ color: "var(--text-subtle)" }}>신규 등록</span>
                            <span className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
                              + {transitionNewlyAdded.size}건 <span className="text-[10px]">(상태 변화와 분리 집계)</span>
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* 필터 칩 */}
                  <div className="px-4 py-2.5 flex items-center gap-1.5 flex-wrap" style={{ borderBottom: "1px solid rgba(129,140,248,0.12)" }}>
                    <span className="text-[10px] font-semibold uppercase tracking-wider mr-0.5" style={{ color: "var(--text-subtle)" }}>필터</span>
                    {/* [전체] */}
                    {(() => {
                      const total = transitionMap.size + transitionNewlyAdded.size;
                      const active = transitionFilter === "all";
                      return (
                        <button
                          onClick={() => setTransitionFilter("all")}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all"
                          style={{
                            background: active ? "rgba(129,140,248,0.2)" : "var(--bg-overlay)",
                            border: `1px solid ${active ? "#818cf8" : "var(--border-2)"}`,
                            color: active ? "#818cf8" : "var(--text-muted)",
                          }}
                        >
                          전체
                          <span className="ml-0.5 px-1 py-px rounded-full text-[9px] font-bold"
                            style={{ background: active ? "rgba(129,140,248,0.25)" : "var(--border)", color: active ? "#818cf8" : "var(--text-subtle)" }}>
                            {total}
                          </span>
                        </button>
                      );
                    })()}
                    {/* 진행 변화 칩 */}
                    {TRANSITION_GROUPS[0].kinds.map(kind => {
                      const count = Array.from(transitionMap.values()).filter(ks => ks.includes(kind)).length;
                      if (count === 0) return null;
                      const meta = TRANSITION_META[kind];
                      const active = transitionFilter === kind;
                      return (
                        <button key={kind}
                          onClick={() => setTransitionFilter(kind)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all"
                          style={{
                            background: active ? meta.bgColor : "var(--bg-overlay)",
                            border: `1px solid ${active ? meta.borderColor : "var(--border-2)"}`,
                            color: active ? meta.color : "var(--text-muted)",
                          }}
                        >
                          <span>{meta.emoji}</span><span>{meta.label}</span>
                          <span className="ml-0.5 px-1 py-px rounded-full text-[9px] font-bold"
                            style={{ background: active ? meta.bgColor : "var(--border)", color: active ? meta.color : "var(--text-subtle)" }}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                    {/* Attention 칩 */}
                    {TRANSITION_GROUPS[1].kinds.map(kind => {
                      const count = Array.from(transitionMap.values()).filter(ks => ks.includes(kind)).length;
                      if (count === 0) return null;
                      const meta = TRANSITION_META[kind];
                      const active = transitionFilter === kind;
                      return (
                        <button key={kind}
                          onClick={() => setTransitionFilter(kind)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all"
                          style={{
                            background: active ? meta.bgColor : "var(--bg-overlay)",
                            border: `1px solid ${active ? meta.borderColor : "var(--border-2)"}`,
                            color: active ? meta.color : "var(--text-muted)",
                          }}
                        >
                          <span>{meta.emoji}</span><span>{meta.label}</span>
                          <span className="ml-0.5 px-1 py-px rounded-full text-[9px] font-bold"
                            style={{ background: active ? meta.bgColor : "var(--border)", color: active ? meta.color : "var(--text-subtle)" }}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                    {/* 신규 등록 칩 — 보조 구분선 뒤 */}
                    {transitionNewlyAdded.size > 0 && (() => {
                      const active = transitionFilter === "newly_added";
                      return (
                        <>
                          <span className="text-[10px]" style={{ color: "var(--border-2)" }}>│</span>
                          <button
                            onClick={() => setTransitionFilter("newly_added")}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all"
                            style={{
                              background: active ? "rgba(100,116,139,0.15)" : "var(--bg-overlay)",
                              border: `1px solid ${active ? "#64748b" : "var(--border-2)"}`,
                              color: active ? "#94a3b8" : "var(--text-subtle)",
                            }}
                          >
                            <span>+</span><span>신규 등록</span>
                            <span className="ml-0.5 px-1 py-px rounded-full text-[9px] font-bold"
                              style={{ background: active ? "rgba(100,116,139,0.25)" : "var(--border)", color: active ? "#94a3b8" : "var(--text-subtle)" }}>
                              {transitionNewlyAdded.size}
                            </span>
                          </button>
                        </>
                      );
                    })()}
                  </div>

                  {/* 기준점 저장 CTA */}
                  <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
                      현재 상태를 기준점으로 저장하면 다음 번 "변화 보기" 시 이 시점부터 비교합니다.
                    </span>
                    <button
                      disabled={baselineSaving}
                      onClick={async () => {
                        setBaselineSaving(true);
                        try {
                          await fetch("/api/transitions", { method: "PUT" });
                          // 저장 후 상태 재로드
                          setSnapshotsLoaded(false);
                          setChangesExpanded(false);
                        } finally {
                          setBaselineSaving(false);
                        }
                      }}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-50"
                      style={{
                        background: "rgba(129,140,248,0.12)",
                        border: "1px solid rgba(129,140,248,0.35)",
                        color: "#818cf8",
                      }}
                    >
                      {baselineSaving ? "저장 중…" : "현재 상태를 기준점으로 저장"}
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* 요약 카드 */}
        {planningTab === "플래닝 대기·검토" ? (
          /* 플래닝 대기·검토 탭 전용 — 팀별 플래닝 상태 분포 */
          <div className={`mb-5 ${isDetailExpanded ? "hidden" : ""}`}>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${planningTeamCounts.length}, minmax(0, 1fr))` }}>
              {planningTeamCounts.map(({ label, color, bucket }) => {
                const isCardActive = planningKpiFilter?.team === label;
                return (
                  <div
                    key={label}
                    className="rounded-xl border px-4 py-3 transition-all"
                    style={{
                      background: isCardActive ? "var(--bg-item)" : "var(--bg-overlay)",
                      borderColor: isCardActive ? `${color}80` : "var(--border)",
                    }}
                  >
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                        <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>{label}</p>
                      </div>
                      {isCardActive && (
                        <button
                          onClick={() => setPlanningKpiFilter(null)}
                          className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
                          style={{ color: color, background: `${color}20`, border: `1px solid ${color}50` }}
                          title="필터 해제"
                        >✕</button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {([
                        { key: "대기중"  as TrackState, kColor: "#fbbf24" },
                        { key: "검토중"  as TrackState, kColor: "#818cf8" },
                        { key: "완료"    as TrackState, kColor: "#34d399" },
                        { key: "대상아님" as TrackState, kColor: "var(--text-muted)" },
                      ] as { key: TrackState; kColor: string }[])
                        .filter(s => s.key !== "대상아님" || bucket.대상아님 > 0)
                        .map((s, si) => {
                          const isActive = planningKpiFilter?.team === label && planningKpiFilter?.status === s.key;
                          const count = bucket[s.key];
                          return (
                            <Fragment key={s.key}>
                              {si > 0 && <div className="w-px self-stretch" style={{ background: "var(--border)" }} />}
                              <button
                                onClick={() => setPlanningKpiFilter(isActive ? null : { team: label, status: s.key })}
                                title={`${label} · ${s.key} 필터${isActive ? " (해제)": ""}`}
                                className="flex flex-col items-center rounded px-1.5 py-1 transition-all"
                                style={{
                                  background: isActive ? `${s.kColor}25` : "transparent",
                                  outline: isActive ? `1px solid ${s.kColor}70` : "none",
                                  cursor: "pointer",
                                }}
                              >
                                <span className="text-[10px] mb-0.5" style={{ color: "var(--text-subtle)" }}>{s.key}</span>
                                <span className="text-xl font-bold leading-none"
                                  style={{ color: isActive ? s.kColor : count > 0 ? s.kColor : "var(--text-subtle)", opacity: count === 0 ? 0.4 : 1 }}>
                                  {count}
                                </span>
                              </button>
                            </Fragment>
                          );
                        })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* 기타 탭 — JIRA 상태 기준 7개 카드 */
          <div className={`grid grid-cols-7 gap-2 mb-5 ${isDetailExpanded ? "hidden" : ""}`}>
            {([
              { label: "전체",   filterKey: "전체",   count: totalAll,        numColor: "var(--text-primary)", desc: "등록된 전체 티켓",            accentColor: undefined },
              { label: "준비중", filterKey: "준비중", count: totalReady,      numColor: "#fbbf24", desc: "준비중",                          accentColor: "#fbbf24" },
              { label: "기획",   filterKey: "기획",   count: totalPlan,       numColor: "#f97316", desc: "기획중 · 기획완료",               accentColor: "#f97316" },
              { label: "디자인", filterKey: "디자인", count: totalDesign,     numColor: "#c084fc", desc: "디자인중 · 디자인완료",            accentColor: "#c084fc" },
              { label: "개발",   filterKey: "개발",   count: totalDev,        numColor: "#60a5fa", desc: "개발중 · In Progress",            accentColor: "#60a5fa" },
              { label: "QA",     filterKey: "QA",     count: totalQA,         numColor: "#f59e0b", desc: "QA중",                           accentColor: "#f59e0b" },
              { label: "완료",   filterKey: "완료",   count: totalDone,       numColor: "#34d399", desc: "론치·배포·완료 처리됨",           accentColor: "#34d399" },
            ] as { label: string; filterKey: typeof statusTab; count: number; numColor: string; desc: string; accentColor: string | undefined }[]).map((s) => {
              const active = statusTab === s.filterKey;
              return (
                <button
                  key={s.label}
                  onClick={() => setStatusTab(active ? "전체" : s.filterKey)}
                  title={s.desc}
                  className="rounded-xl border px-3 py-3 text-left transition-all cursor-pointer"
                  style={{
                    background: active ? "var(--bg-item)" : "var(--bg-overlay)",
                    borderColor: active && s.accentColor ? s.accentColor + "80" : active ? "#7c3aed" : "var(--border)",
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
        )}

        {/* Planning KPI 활성 필터 칩 */}
        {planningKpiFilter && (
          <div className={`flex items-center gap-2 mb-3 ${isDetailExpanded ? "hidden" : ""}`}>
            <span className="text-xs" style={{ color: "var(--text-subtle)" }}>필터 적용 중:</span>
            <button
              onClick={() => setPlanningKpiFilter(null)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all"
              style={{
                background: "rgba(129,140,248,0.15)",
                border: "1px solid rgba(129,140,248,0.5)",
                color: "#818cf8",
              }}
            >
              {planningKpiFilter.team} · {planningKpiFilter.status}
              <span className="ml-0.5 opacity-70">✕</span>
            </button>
          </div>
        )}

        {/* 필터 바 */}
        <div className={`flex items-center gap-1.5 mb-4 flex-wrap ${isDetailExpanded ? "hidden" : ""}`}>

          {/* 필터 그룹 */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
            <span className="text-[10px] font-semibold mr-0.5 shrink-0" style={{ color: "var(--text-subtle)" }}>필터</span>
            <MultiSelectDropdown label="분기" items={ALL_QUARTERS} selected={quarters} onToggle={v => setQuarters(p => toggle(p, v))} onClear={() => setQuarters(new Set())} />
            <MultiSelectDropdown label="레벨" items={ALL_LEVELS} selected={levels} onToggle={v => setLevels(p => toggle(p, v))} onClear={() => setLevels(new Set())} />
            <MultiSelectDropdown label="프로젝트" items={ALL_PROJECTS} selected={projects} onToggle={v => setProjects(p => toggle(p, v))} onClear={() => setProjects(new Set())} />
            <MultiSelectDropdown label="상태" items={ALL_STATUSES} selected={statuses} onToggle={v => setStatuses(p => toggle(p, v))} onClear={() => setStatuses(new Set())} />
            <MultiSelectDropdown label="담당자" items={allAssignees} selected={assigneeFilter} onToggle={v => setAssigneeFilter(p => toggle(p, v))} onClear={() => setAssigneeFilter(new Set())} />
            <MultiSelectDropdown label="도메인" items={allDomains} selected={domainFilter} onToggle={v => setDomainFilter(p => toggle(p, v))} onClear={() => setDomainFilter(new Set())} />
            <MultiSelectDropdown label="대상" items={allTargets} selected={targetFilter} onToggle={v => setTargetFilter(p => toggle(p, v))} onClear={() => setTargetFilter(new Set())} />
          </div>

          {/* 정렬 그룹 */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
            <span className="text-[10px] font-semibold mr-0.5 shrink-0" style={{ color: "var(--text-subtle)" }}>정렬</span>
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
                <option value="ticketNo">티켓 No순</option>
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px]" style={{ color: "#a78bfa" }}>▾</span>
            </div>
          </div>

          {/* 검색 그룹 */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
            <span className="text-[10px] font-semibold mr-0.5 shrink-0" style={{ color: "var(--text-subtle)" }}>검색</span>
            <div className="relative">
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
          </div>

          {/* 티켓 추가 그룹 */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
            <span className="text-[10px] font-semibold mr-0.5 shrink-0" style={{ color: "var(--text-subtle)" }}>추가</span>
            <div className="flex items-center gap-1.5">
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
        </div>



        {/* 티켓 목록 */}
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg-canvas)" }}>
          {/* 헤더 */}
          <div className="flex items-center px-4 py-2.5 text-xs font-semibold" style={{ background: "var(--bg-overlay)", borderBottom: "1px solid var(--border)", color: "var(--text-subtle)" }}>
            {isDetailExpanded ? (
              <span className="flex-1 min-w-0">티켓</span>
            ) : (
              /* Split View: 카드 stream — 헤더는 정렬·총계용으로만 사용 */
              <>
                <span className="w-6 shrink-0" />
                <span className="w-8 shrink-0 text-center">#</span>
                <span className="flex-1 min-w-0">티켓 / 제목 / 운영 메타</span>
                <span className="w-32 shrink-0 text-center">상태</span>
                <span className="w-24 shrink-0 text-center">ETA</span>
                <span className="w-6 shrink-0" />
              </>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm" style={{ color: "var(--text-subtle)" }}>검색 결과가 없습니다.</div>
          ) : (
            displayItems.map((item, idx) => {
              const { ticket: t, topAction: railTopAction } = item;
              const indicators = "indicators" in item ? item.indicators : undefined;
              const isSelected = selected?.key === t.key;
              const isNew = newlyAddedKeys.has(t.key);
              const isDuplicate = duplicateKeys.has(t.key);
              const tp = getPlanningVal(planning[t.key]);
              const planningComplete = tp.design === "완료" && tp.dev === "완료";
              const ticketDone = ["론치완료", "완료", "배포완료"].includes(t.status);

              // ETA 경고: 완료/진행중 상태가 아닌데 ETA가 경과·임박한 경우
              const todayStr = new Date().toISOString().split("T")[0];
              const in7Days  = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
              const hasEta   = t.eta && t.eta !== "-";
              const isNotProgressOrDone = !INPROGRESS_STATUSES.includes(t.status) && !PLANNING_DONE_STATUSES.has(t.status);
              const isEtaOverdue   = hasEta && t.eta! < todayStr && isNotProgressOrDone;
              const isEtaImminent  = hasEta && t.eta! >= todayStr && t.eta! <= in7Days && isNotProgressOrDone;
              const etaWarnLevel   = isEtaOverdue ? "overdue" : isEtaImminent ? "imminent" : null;

              // Operational attention: HOLD/Blocked 상태 감지
              const isHold    = ["HOLD", "Postponed", "Blocked"].includes(t.status);
              // reviewNeeded 는 ETA 위험이 없는 경우에만 subtle 강조
              const isReviewNeeded = getPlanningVal(planning[t.key]).reviewNeeded && !isEtaOverdue && !isEtaImminent;

              // row background = selection/focus 전용 (상태 표현은 left border + badge 중심)
              const rowBg = isSelected  ? "rgba(99,102,241,0.09)"
                : isDuplicate           ? "rgba(245,158,11,0.08)"   // 임시: 중복 감지
                : isNew                 ? "rgba(16,185,129,0.06)"   // 임시: 신규 추가
                : undefined;

              // Focus Mode + Split View 통합 카드 강조 — selected이면 진한 indigo accent + shadow
              // 양쪽 모드 모두 같은 시각 언어 (Focus Queue와 Split Queue 일관성).
              const fmCardStyle: React.CSSProperties = {
                borderBottom: "1px solid var(--border)",
                borderLeft: isSelected
                  ? "4px solid #6366f1"
                  : etaWarnLevel === "overdue"  ? "3px solid rgba(248,113,113,0.85)"
                  : etaWarnLevel === "imminent" ? "3px solid rgba(251,191,36,0.75)"
                  : isHold                      ? "3px solid rgba(245,158,11,0.65)"
                  : isReviewNeeded              ? "3px solid rgba(96,165,250,0.65)"
                  : "3px solid transparent",
                background: isSelected ? "rgba(99,102,241,0.14)" : rowBg,
                boxShadow: isSelected
                  ? "inset 0 0 0 1px rgba(129,140,248,0.4), 0 1px 0 rgba(99,102,241,0.15)"
                  : undefined,
              };

              return (
                <div
                  key={t.key}
                  data-ticket-key={t.key}
                  className={`group transition-colors duration-700 ${isDuplicate ? "ring-1 ring-inset ring-amber-700/40" : ""} cursor-pointer`}
                  style={fmCardStyle}
                  onClick={() => handleSelect(t)}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "var(--bg-item)"; }}
                  onMouseLeave={e => {
                    if (!isSelected) {
                      const bg = isDetailExpanded ? (rowBg ?? "") : (rowBg ?? "");
                      (e.currentTarget as HTMLDivElement).style.background = bg;
                    }
                  }}
                >
                  {/* 메인 행 — Focus는 items-start(다중 row), Split도 카드 layout으로 items-start */}
                  <div
                    className={`flex items-start ${isDetailExpanded ? "px-3 py-2.5" : "px-4 py-3"}`}
                  >
                    {isDetailExpanded ? (
                      /* Focus Mode 미니 레일: phase 배지 + ticket key + ETA + indicators + title */
                      (() => {
                        const phase = indicators?.phase ?? null;
                        const candidateCount = indicators?.candidateCount ?? 0;
                        const actionCount    = indicators?.actionCount    ?? 0;
                        const riskCount      = indicators?.riskCount      ?? 0;
                        const cleanupCount   = indicators?.cleanupCount   ?? 0;
                        const phaseStyle = phase ? PHASE_QUEUE_STYLE[phase] : null;
                        // ETA 표시 (M/D)
                        const etaShort = t.eta && t.eta !== "-"
                          ? `${parseInt(t.eta.split("-")[1])}/${parseInt(t.eta.split("-")[2])}`
                          : null;
                        const etaColor = etaWarnLevel === "overdue"  ? "#f87171"
                                       : etaWarnLevel === "imminent" ? "#fbbf24"
                                       : "var(--text-muted)";
                        const hasIndicators = candidateCount + actionCount + riskCount + cleanupCount > 0;
                        return (
                          <div className="flex flex-col gap-1 min-w-0 flex-1">
                            {/* Row 1: phase 배지 + ticket key + JIRA link */}
                            <div className="flex items-center gap-1.5 min-w-0">
                              {phaseStyle && (
                                <span
                                  className="shrink-0 px-1.5 py-0.5 rounded text-[9.5px] font-bold tracking-tight"
                                  style={{ background: phaseStyle.bg, color: phaseStyle.color }}
                                  title={`phase: ${phase}`}
                                >
                                  {phase}
                                </span>
                              )}
                              <span
                                className="font-mono text-[10px] font-semibold shrink-0"
                                style={{ color: isSelected ? "#818cf8" : "var(--text-subtle)" }}
                              >
                                {t.key}
                              </span>
                              <a
                                href={`${JIRA_BASE}${t.key}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="shrink-0 opacity-40 hover:opacity-80 transition-opacity"
                                title="JIRA에서 열기"
                              >
                                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                  <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                                </svg>
                              </a>
                            </div>
                            {/* Row 2: ETA + indicators */}
                            {(etaShort || hasIndicators) && (
                              <div className="flex items-center gap-2 flex-wrap text-[10px]">
                                {etaShort && (
                                  <span style={{ color: etaColor, fontWeight: etaWarnLevel ? 700 : undefined }} title={`ETA ${t.eta}`}>
                                    ETA {etaShort}
                                    {etaWarnLevel === "overdue"  && <span className="ml-0.5">!</span>}
                                    {etaWarnLevel === "imminent" && <span className="ml-0.5">▲</span>}
                                  </span>
                                )}
                                {candidateCount > 0 && (
                                  <span title={`Weekly 일정 변경 후보 ${candidateCount}건`} style={{ color: "#fbbf24" }}>
                                    ⚡{candidateCount}
                                  </span>
                                )}
                                {riskCount > 0 && (
                                  <span title={`리스크 ${riskCount}건`} style={{ color: "#f87171" }}>
                                    ⚠{riskCount}
                                  </span>
                                )}
                                {actionCount > 0 && (
                                  <span title={`액션 필요 ${actionCount}건`} style={{ color: "#fbbf24" }}>
                                    ☐{actionCount}
                                  </span>
                                )}
                                {cleanupCount > 0 && (
                                  <span title={`정리 필요 ${cleanupCount}건`} style={{ color: "#94a3b8" }}>
                                    🧹{cleanupCount}
                                  </span>
                                )}
                              </div>
                            )}
                            {/* Row 3: action label (owner_dashboard 진입 + 미선택 시) */}
                            {focusForKey && railTopAction && !isSelected && (
                              <span
                                className="text-[10px] leading-tight truncate"
                                style={{
                                  color:
                                    railTopAction.level === "critical" ? "#f87171" :
                                    railTopAction.level === "warning"  ? "#fbbf24" :
                                                                          "#94a3b8",
                                }}
                              >
                                → {railTopAction.label}
                              </span>
                            )}
                            {/* Row 4: title (2줄 clamp) */}
                            <span
                              className="text-[11px] leading-snug line-clamp-2"
                              style={{
                                color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
                                wordBreak: "break-word",
                                fontWeight: isSelected ? 600 : undefined,
                              }}
                            >
                              {t.summary}
                            </span>
                          </div>
                        );
                      })()
                    ) : (
                      /* Split View 카드 — Compact Operational Queue
                         Layout:
                           Row 1: [phase] TM-XXXX ↗ P2 · 담당자 · 프로젝트 · [type]
                           Row 2: ⚡N ⚠N ☐N 🧹N · transition badges (있을 때만)
                           Row 3: 제목 (2줄 clamp)
                         우측: [상태 배지] [ETA urgency] [×]
                      */
                      (() => {
                        const phase          = indicators?.phase ?? null;
                        const candidateCount = indicators?.candidateCount ?? 0;
                        const actionCount    = indicators?.actionCount    ?? 0;
                        const riskCount      = indicators?.riskCount      ?? 0;
                        const cleanupCount   = indicators?.cleanupCount   ?? 0;
                        const phaseStyle     = phase ? PHASE_QUEUE_STYLE[phase] : null;
                        const hasIndicators  = candidateCount + actionCount + riskCount + cleanupCount > 0;
                        const etaShort = t.eta && t.eta !== "-"
                          ? `${parseInt(t.eta.split("-")[1])}/${parseInt(t.eta.split("-")[2])}`
                          : null;
                        const etaColor = isEtaOverdue  ? ETA_URGENCY_COLOR.overdue
                                       : isEtaImminent ? ETA_URGENCY_COLOR.imminent
                                       : "var(--text-primary)";
                        return (
                          <>
                            <span className="w-6 shrink-0 pt-0.5 flex items-start justify-center">
                              <TicketCopyButton ticketKey={t.key} summary={t.summary} size="xs" />
                            </span>
                            <span className="w-8 shrink-0 pt-0.5 text-center text-xs font-mono" style={{ color: "var(--text-subtle)" }}>
                              {idx + 1}
                            </span>

                            {/* 카드 본문 */}
                            <div className="flex-1 min-w-0 pr-3">
                              {/* Row 1: phase + key + 부속 메타 */}
                              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                {phaseStyle && (
                                  <span
                                    className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-tight"
                                    style={{ background: phaseStyle.bg, color: phaseStyle.color }}
                                    title={`phase: ${phase}`}
                                  >
                                    {phase}
                                  </span>
                                )}
                                <a
                                  href={`${JIRA_BASE}${t.key}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="shrink-0 font-mono text-sm font-semibold hover:underline"
                                  style={{ color: isSelected ? "#a5b4fc" : "#60a5fa" }}
                                >
                                  {t.key}
                                </a>
                                {isNew && (
                                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-300 animate-pulse">
                                    추가됨
                                  </span>
                                )}
                                {activePriorities[t.key] && (
                                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 font-mono">
                                    P{activePriorities[t.key]}
                                  </span>
                                )}
                                <span className={`shrink-0 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${TYPE_COLOR[t.type] ?? "bg-gray-100 text-gray-500"}`}>
                                  {t.type}
                                </span>
                                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                                  {t.assignee}
                                </span>
                                <span className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
                                  · {t.project}
                                </span>
                              </div>

                              {/* Row 2: indicators + transition badges (있을 때만) */}
                              {(hasIndicators || (changesMode && (transitionNewlyAdded.has(t.key) || transitionMap.get(t.key)?.length))) && (
                                <div className="flex items-center gap-2 flex-wrap mb-1 text-[11px]">
                                  {candidateCount > 0 && (
                                    <span title={`Weekly 일정 변경 후보 ${candidateCount}건`} style={{ color: "#fbbf24" }}>
                                      ⚡{candidateCount}
                                    </span>
                                  )}
                                  {riskCount > 0 && (
                                    <span title={`리스크 ${riskCount}건`} style={{ color: "#f87171" }}>
                                      ⚠{riskCount}
                                    </span>
                                  )}
                                  {actionCount > 0 && (
                                    <span title={`액션 필요 ${actionCount}건`} style={{ color: "#fbbf24" }}>
                                      ☐{actionCount}
                                    </span>
                                  )}
                                  {cleanupCount > 0 && (
                                    <span title={`정리 필요 ${cleanupCount}건`} style={{ color: "#94a3b8" }}>
                                      🧹{cleanupCount}
                                    </span>
                                  )}
                                  {/* Transition badges (changesMode) */}
                                  {changesMode && transitionNewlyAdded.has(t.key) && (
                                    <span
                                      className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium"
                                      style={{ background: "rgba(100,116,139,0.10)", border: "1px solid rgba(100,116,139,0.25)", color: "#94a3b8" }}
                                    >
                                      + 신규
                                    </span>
                                  )}
                                  {changesMode && !transitionNewlyAdded.has(t.key) && transitionMap.get(t.key)?.map(kind => {
                                    const m = TRANSITION_META[kind];
                                    return (
                                      <span
                                        key={kind}
                                        className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                        style={{ background: m.bgColor, border: `1px solid ${m.borderColor}`, color: m.color }}
                                      >
                                        {m.emoji} {m.label}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Row 3: 제목 (2줄 clamp) */}
                              <p
                                className="text-[13px] leading-snug line-clamp-2"
                                style={{
                                  color: "var(--text-primary)",
                                  fontWeight: isSelected ? 600 : 500,
                                  wordBreak: "break-word",
                                }}
                              >
                                {t.summary}
                              </p>
                            </div>

                            {/* 우측: 상태 배지 */}
                            <span className="w-32 shrink-0 pt-0.5 flex justify-center">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${STATUS_COLOR[t.status] ?? "bg-gray-100 text-gray-500"}`}>
                                {t.status}
                              </span>
                            </span>

                            {/* 우측: ETA with urgency */}
                            <span
                              className="w-24 shrink-0 pt-0.5 text-[12px] font-medium text-center"
                              title={
                                isEtaOverdue  ? "ETA 초과 — 일정 재조율 또는 상태 업데이트가 필요합니다" :
                                isEtaImminent ? "ETA 7일 이내 — 개발·QA 진행 상황을 확인하세요" :
                                (!t.eta || t.eta === "-") ? "ETA 미입력 — 목표 완료일을 입력해주세요" :
                                undefined
                              }
                              style={{
                                color: etaShort ? etaColor : "var(--text-subtle)",
                                fontWeight: etaWarnLevel ? 700 : undefined,
                              }}
                            >
                              {!etaShort ? "미정" : `ETA ${etaShort}`}
                              {isEtaOverdue  && <span className="ml-1 text-[10px]">!</span>}
                              {isEtaImminent && <span className="ml-1 text-[10px]">▲</span>}
                            </span>

                            {/* 우측: 삭제 */}
                            <button
                              onClick={(e) => { e.stopPropagation(); removeTicket(t.key); }}
                              title="목록에서 제거"
                              className="w-6 shrink-0 pt-0.5 flex justify-center items-start hover:text-red-400 transition-colors"
                              style={{ color: "var(--text-subtle)" }}
                            >×</button>
                          </>
                        );
                      })()
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
                    return (
                      // 서브행: px-4(16) + w-6(24) + w-8(32) + w-32(128) = 200px → 타이틀 컬럼 시작에 정렬
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 pb-2.5 pr-4" style={{ paddingLeft: "200px" }}>
                        {/* 플래닝 summary 배지 (검토필요/검토중/완료/대기중 하나만 표시) */}
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
                          // 날짜 확정 → 밝은 흰색 / 미정 → var(--text-muted) (라이트모드에서 더 진하게) / 확인필요 → 주황
                          const dateColor   = hasDate ? "var(--text-primary)" : isNeedCheck ? "#fb923c" : "var(--text-muted)";
                          return (
                            <span
                              key={`${r.role}-${mi}`}
                              className="inline-flex items-center gap-1 text-[13px]"
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

                        {/* 팀 단위 플래닝 상태 compact badges */}
                        {(() => {
                          const summary = getPlanningStateSummary(planning[t.key]);
                          if (summary === "플래닝 완료" && isTicketActive) return null;
                          return (
                            <>
                              <span className="mx-1 text-[10px]" style={{ color: "var(--border-2)" }}>|</span>
                              <PlanningCompactBadges planVal={planning[t.key]} />
                            </>
                          );
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
          style={{ borderLeft: "1px solid var(--border-2)", background: "var(--bg-overlay)", ...(isDetailExpanded ? {} : { width: sidebarWidth }) }}
        >
          {/* 드래그 핸들 (집중 보기 모드에서는 숨김) */}
          {!isDetailExpanded && (
            <div
              onMouseDown={isResizing}
              className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-indigo-300 active:bg-indigo-400 transition-colors z-10"
            />
          )}
          {/* ── Sticky 헤더 ── */}
          {(() => {
            const todayStr = new Date().toISOString().split("T")[0];
            const isHeaderEtaOverdue =
              !!selected.eta && selected.eta !== "-" &&
              selected.eta < todayStr &&
              !["론치완료","완료","배포완료"].includes(selected.status);
            const headerPlanningSummary = getPlanningStateSummary(planning[selected.key]);
            const showHeaderPlanningBadge = headerPlanningSummary !== "플래닝 완료" && headerPlanningSummary !== "대상아님";
            return (
              <div
                className="shrink-0 px-4 pt-3 pb-2.5 flex items-start gap-2"
                style={{
                  background: "var(--bg-overlay)",
                  borderBottom: "1px solid var(--border)",
                  zIndex: 10,
                }}
              >
                {/* 식별 정보 (2행) */}
                <div className="flex-1 min-w-0">
                  {/* 1행: key + title */}
                  <div className="flex items-start gap-2 mb-1.5 min-w-0">
                    <a
                      href={`${JIRA_BASE}${selected.key}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[13px] font-semibold text-blue-500 hover:underline shrink-0 mt-0.5"
                    >
                      {selected.key}
                    </a>
                    <p
                      className="text-[15px] font-semibold leading-snug"
                      style={{ color: "var(--text-primary)", wordBreak: "break-word" }}
                      title={selected.summary}
                    >
                      {selected.summary}
                    </p>
                  </div>
                  {/* 2행: status + type + assignee + project + ETA + 검토 badges */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${STATUS_COLOR[selected.status] ?? "bg-gray-100 text-gray-500"}`}>
                      {selected.status}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${TYPE_COLOR[selected.type] ?? "bg-gray-100 text-gray-500"}`}>
                      {selected.type}
                    </span>
                    {selected.assignee && selected.assignee !== "-" && (
                      <span className="text-[12px] shrink-0" style={{ color: "var(--text-secondary)" }}>
                        {selected.assignee}
                      </span>
                    )}
                    {selected.project && (
                      <span
                        className="text-[11px] px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: "var(--bg-overlay)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
                      >
                        {selected.project}
                      </span>
                    )}
                    {selected.eta && selected.eta !== "-" && (
                      <span
                        className="text-[12px] font-medium shrink-0"
                        title={isHeaderEtaOverdue ? "ETA 초과 — 일정 재조율 또는 상태 업데이트가 필요합니다" : undefined}
                        style={{ color: isHeaderEtaOverdue ? "#f87171" : "var(--text-secondary)" }}
                      >
                        ETA {formatDateWithDay(selected.eta)}
                        {isHeaderEtaOverdue && " ⚠"}
                      </span>
                    )}
                    {showHeaderPlanningBadge && (
                      <span className="shrink-0">
                        <PlanningBadge state={headerPlanningSummary} size="xs" />
                      </span>
                    )}
                  </div>
                </div>
                {/* 우측 액션 버튼 — 순서: 집중 보기 > Jira > Copy > Close */}
                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                  {/* 집중 보기 토글 — Primary CTA */}
                  <button
                    onClick={() => {
                      const next = !isDetailExpanded;
                      setIsDetailExpanded(next);
                      window.history.replaceState({ ...(window.history.state ?? {}), expanded: next }, "");
                      if (next) {
                        // Focus 진입 시: 현재 scroll/ptab 저장
                        workspaceNavRef.current.prevScrollY = window.scrollY;
                        workspaceNavRef.current.prevPtab    = planningTab;
                      } else {
                        // Split View 복귀 시: prevPtab 복원 + scroll 복원
                        const { prevPtab, prevScrollY } = workspaceNavRef.current;
                        if (prevPtab && prevPtab !== planningTab) setPlanningTab(prevPtab);
                        window.scrollTo({ top: prevScrollY, behavior: "instant" as ScrollBehavior });
                        if (selected) {
                          setTimeout(() => {
                            document.querySelector<Element>(`[data-ticket-key="${selected.key}"]`)
                              ?.scrollIntoView({ behavior: "smooth", block: "center" });
                          }, 80);
                        }
                      }
                    }}
                    title={isDetailExpanded ? "기본 보기로 (ESC)" : "집중 보기 — 목록을 최소화하고 이 티켓에 집중"}
                    className="flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11px] font-semibold transition-all"
                    style={{
                      background: isDetailExpanded
                        ? "rgba(99,102,241,0.22)"
                        : "rgba(99,102,241,0.13)",
                      border: `1px solid ${isDetailExpanded
                        ? "rgba(99,102,241,0.6)"
                        : "rgba(99,102,241,0.38)"}`,
                      color: isDetailExpanded ? "#818cf8" : "#a5b4fc",
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.background = isDetailExpanded
                        ? "rgba(99,102,241,0.32)"
                        : "rgba(99,102,241,0.22)";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.background = isDetailExpanded
                        ? "rgba(99,102,241,0.22)"
                        : "rgba(99,102,241,0.13)";
                    }}
                  >
                    {isDetailExpanded ? (
                      <>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M6.5 2L3 5l3.5 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        목록으로
                      </>
                    ) : (
                      <>
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                          <path d="M1 3.5V1.5a.5.5 0 0 1 .5-.5H3.5M7.5 1H9.5a.5.5 0 0 1 .5.5V3.5M7.5 10H9.5a.5.5 0 0 0 .5-.5V7.5M3.5 10H1.5a.5.5 0 0 1-.5-.5V7.5"
                            stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                        </svg>
                        집중 보기
                      </>
                    )}
                  </button>
                  {/* Focus Mode + owner_dashboard 진입 시 "대시보드로" 빠른 복귀 버튼 */}
                  {isDetailExpanded && workspaceNavRef.current.fromOwnerDashboard && (
                    <button
                      onClick={() => window.history.back()}
                      className="flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-medium transition-all opacity-50 hover:opacity-100"
                      style={{ color: "var(--text-muted)", border: "1px solid var(--border-2)" }}
                      title="담당자 대시보드로 돌아가기"
                    >
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                        <path d="M6.5 2L3 5l3.5 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      대시보드
                    </button>
                  )}
                  {/* 구분선 */}
                  <span className="w-px h-4 shrink-0" style={{ background: "var(--border-2)" }} />
                  {/* Jira 이동 */}
                  <a
                    href={`${JIRA_BASE}${selected.key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center w-6 h-6 rounded transition-colors hover:opacity-100 opacity-50"
                    style={{ color: "var(--text-muted)" }}
                    title="Jira에서 열기"
                    onClick={e => e.stopPropagation()}
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                      <polyline points="15 3 21 3 21 9"/>
                      <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                  </a>
                  {/* Copy */}
                  <div className="group">
                    <TicketCopyButton ticketKey={selected.key} summary={selected.summary} size="xs" />
                  </div>
                  {/* 닫기 — source=owner_dashboard면 "대시보드로 돌아가기" 툴팁 */}
                  <button
                    onClick={() => window.history.back()}
                    className="flex items-center justify-center w-6 h-6 rounded text-base leading-none transition-colors hover:opacity-100 opacity-50"
                    style={{ color: "var(--text-muted)" }}
                    title={workspaceNavRef.current.fromOwnerDashboard ? "대시보드로 돌아가기" : "닫기"}
                  >×</button>
                </div>
              </div>
            );
          })()}
          {/* ── 탭 네비게이션 (Focus Mode에서는 숨김) ── */}
          {!isDetailExpanded && (() => {
            // 탭 구조: Overview(컨텍스트) + Planning & Schedule(운영) — 흐름 기준 2탭
            // TODO [ACTIVITY]: activity 고도화 완료 후 { id: "activity", label: "Activity", icon: <clockSvg> } 복원
            const TABS: { id: "overview" | "ops"; label: string; icon: React.ReactNode }[] = [
              {
                id: "overview",
                label: "Overview",
                icon: (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="8" r="6.5"/><path d="M8 5v3.5l2 1.5"/>
                  </svg>
                ),
              },
              {
                id: "ops",
                label: "Planning & Schedule",
                icon: (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1.5" y="2.5" width="13" height="12" rx="1.5"/><path d="M5 1v3M11 1v3M1.5 6.5h13"/><path d="M5 10h2M5 12.5h4"/>
                  </svg>
                ),
              },
            ];
            return (
              <div className="flex shrink-0 border-b" style={{ borderColor: "var(--border)", background: "var(--bg-canvas)" }}>
                {TABS.map(tab => {
                  const active = detailTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setDetailTab(tab.id)}
                      className="flex items-center gap-1.5 px-3.5 py-2.5 text-[12px] transition-all relative"
                      style={{
                        color: active ? "#a5b4fc" : "var(--text-muted)",
                        fontWeight: active ? 600 : 400,
                        background: active ? "rgba(99,102,241,0.07)" : "transparent",
                        borderBottom: active ? "2px solid #818cf8" : "2px solid transparent",
                        opacity: active ? 1 : 0.65,
                      }}
                    >
                      <span style={{ color: active ? "#818cf8" : "var(--text-subtle)" }}>{tab.icon}</span>
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* ══════════════════════════════════════════════════════════════
              Focus Mode 워크스페이스 — isDetailExpanded === true 일 때만 렌더
              2-column 운영 워크스페이스: 액션 스트립 + 좌(Context) + 우(Execution)
              ══════════════════════════════════════════════════════════════ */}
          {isDetailExpanded && (() => {
            const fmActions = getActionItems(
              selected,
              planning[selected.key],
              schedules[selected.key] ?? selected.roles ?? [],
              etrMap[selected.key]
            );
            const fmEtr   = etrMap[selected.key];
            const fmWikis = fmEtr?.wikiLinks ?? [];
            const fmMemo  = getCurrentMemo(selected.key);
            const fmPlan  = getPlanningVal(planning[selected.key]);
            const fmRoles = schedules[selected.key] ?? selected.roles ?? [];
            const fmNotes = planningNotes[selected.key] ?? [];
            const fmTicketNotes = ticketNotes[selected.key];

            // 주요 메타 항목
            const META_ROWS: { label: string; value: string | undefined | null }[] = [
              { label: "상태",   value: selected.status },
              { label: "ETA",    value: selected.eta && selected.eta !== "-" ? selected.eta : undefined },
              { label: "유형",   value: selected.type },
              { label: "담당자", value: selected.assignee ?? undefined },
              { label: "프로젝트", value: selected.project ?? undefined },
            ];

            const LEVEL_STYLE = {
              critical: { dot: "#ef4444", color: "#f87171", bg: "rgba(239,68,68,0.09)",   border: "rgba(248,113,113,0.5)" },
              warning:  { dot: "#f59e0b", color: "#fbbf24", bg: "rgba(245,158,11,0.08)",  border: "rgba(251,191,36,0.38)" },
              info:     { dot: "#64748b", color: "#94a3b8", bg: "rgba(100,116,139,0.04)", border: "rgba(100,116,139,0.18)" },
            } as const;

            // 플래닝 상태 레이블 → 색상
            const planningStateColor = (v: string) =>
              v === "완료"     ? "#34d399" :
              v === "검토중"   ? "#a78bfa" :
              v === "대상아님" ? "var(--text-muted)" :
                                 "var(--text-subtle)";

            // owner_dashboard 진입 context 텍스트 맵
            const FM_CONTEXT_TEXT: Record<string, { icon: string; text: string; color: string; bg: string; border: string }> = {
              "schedule":         { icon: "⚠", text: "세부 작업 일정을 입력해주세요",            color: "#fbbf24", bg: "rgba(245,158,11,0.08)",   border: "rgba(251,191,36,0.35)"  },
              "planning":         { icon: "⚡", text: "플래닝 검토 상태를 확인·해제해주세요",      color: "#f87171", bg: "rgba(239,68,68,0.08)",    border: "rgba(248,113,113,0.35)" },
              "etr":              { icon: "ℹ", text: "요구사항 출처(ETR)를 연결해주세요",          color: "#94a3b8", bg: "rgba(100,116,139,0.06)", border: "rgba(100,116,139,0.28)" },
              "docs":             { icon: "ℹ", text: "관련 문서(PRD)를 연결해주세요",              color: "#94a3b8", bg: "rgba(100,116,139,0.06)", border: "rgba(100,116,139,0.28)" },
              "overdue":          { icon: "🚨", text: "ETA 경과 — 일정을 재조율하거나 상태를 업데이트해주세요", color: "#f87171", bg: "rgba(239,68,68,0.08)", border: "rgba(248,113,113,0.35)" },
              "review-needed":    { icon: "⚡", text: "플래닝 검토 확인 — 담당 PM이 직접 확인·해제해야 합니다", color: "#f87171", bg: "rgba(239,68,68,0.08)", border: "rgba(248,113,113,0.35)" },
              "no-schedule":      { icon: "⚠", text: "세부 작업 일정을 입력해주세요",              color: "#fbbf24", bg: "rgba(245,158,11,0.08)",  border: "rgba(251,191,36,0.35)"  },
              "no-launch":        { icon: "⚠", text: "Launch / Release 일정을 지정해주세요",      color: "#fbbf24", bg: "rgba(245,158,11,0.08)",  border: "rgba(251,191,36,0.35)"  },
              "planning-reviewing":{ icon: "ℹ", text: "팀 플래닝 검토 중 — 완료를 독려하거나 상태를 확인하세요", color: "#94a3b8", bg: "rgba(100,116,139,0.06)", border: "rgba(100,116,139,0.28)" },
              "no-etr":           { icon: "ℹ", text: "ETR 티켓을 연결해 요구사항 출처를 남겨주세요", color: "#94a3b8", bg: "rgba(100,116,139,0.06)", border: "rgba(100,116,139,0.28)" },
              "no-docs":          { icon: "ℹ", text: "PRD 또는 관련 문서를 연결해주세요",          color: "#94a3b8", bg: "rgba(100,116,139,0.06)", border: "rgba(100,116,139,0.28)" },
            };

            const isFromOwnerDashboard = focusForKey === selected.key && !!focusContext;
            const fmCtx = isFromOwnerDashboard ? FM_CONTEXT_TEXT[focusContext!] : null;

            return (
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                {/* ── Owner Dashboard 진입 Context 배너 ── */}
                {fmCtx && (
                  <div
                    className="shrink-0 flex items-center justify-between gap-2 px-4 py-2"
                    style={{ borderBottom: "1px solid var(--border)", background: fmCtx.bg, color: fmCtx.color }}
                  >
                    <span className="flex items-center gap-2 text-[12px] font-semibold flex-wrap">
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span style={{ fontSize: 13 }}>⚡</span>
                        <span>담당자 대시보드에서 이동</span>
                      </span>
                      <span className="opacity-30 shrink-0">—</span>
                      <span className="flex items-center gap-1">
                        <span style={{ fontSize: 11 }}>{fmCtx.icon}</span>
                        <span style={{ opacity: 0.9 }}>{fmCtx.text}</span>
                      </span>
                      {/* 최상위 action 레벨 배지 */}
                      {fmActions[0] && (
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                          style={{
                            background: fmActions[0].level === "critical" ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)",
                            color:      fmActions[0].level === "critical" ? "#f87171" : "#fbbf24",
                            border:     `1px solid ${fmActions[0].level === "critical" ? "rgba(248,113,113,0.4)" : "rgba(251,191,36,0.4)"}`,
                          }}
                        >
                          {fmActions[0].level === "critical" ? "🚨 Critical" : "⚠ Warning"}
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => { setFocusContext(null); setFocusForKey(null); setSectionHighlight(null); }}
                      className="shrink-0 text-[13px] leading-none opacity-50 hover:opacity-100 transition-opacity"
                      title="닫기"
                    >×</button>
                  </div>
                )}

                {/* ── Action Resolve Toast ── */}
                {resolveToast && (
                  <div
                    className="shrink-0 flex items-center gap-2 px-4 py-1.5 text-[12px] font-semibold"
                    style={{
                      borderBottom: "1px solid rgba(52,211,153,0.25)",
                      background: "rgba(16,185,129,0.08)",
                      color: "#34d399",
                    }}
                  >
                    <span>✓</span>
                    <span>
                      {resolveToast.count === 1
                        ? "액션 1개가 해결되었습니다"
                        : `액션 ${resolveToast.count}개가 해결되었습니다`}
                    </span>
                  </div>
                )}

                {/* ── Action Required 스트립 ── */}
                {fmActions.length > 0 && (
                  <div
                    className="shrink-0 flex items-center gap-1.5 px-4 py-2 flex-wrap"
                    style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-canvas)" }}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide shrink-0 mr-0.5" style={{ color: "var(--text-muted)" }}>
                      Action Required
                    </span>
                    {fmActions.map(action => {
                      const s = LEVEL_STYLE[action.level];
                      return (
                        <button
                          key={action.id}
                          onClick={() => {
                            // Focus Mode에서는 탭 대신 우측 컬럼의 해당 섹션으로 스크롤
                            if (action.targetTab === "ops" && focusRightColRef.current) {
                              const sectionKey = action.id.startsWith("schedule") ? "schedule" : "planning";
                              const el = focusRightColRef.current.querySelector<HTMLElement>(
                                `[data-fm-section='${sectionKey}']`
                              );
                              el?.scrollIntoView({ behavior: "smooth", block: "start" });
                            } else if (!action.targetTab && focusLeftColRef.current) {
                              // etr/docs 관련 액션 → 좌측 컬럼 etr 섹션으로 스크롤
                              const el = focusLeftColRef.current.querySelector<HTMLElement>("[data-fm-section='etr']");
                              el?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all hover:opacity-85"
                          style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.dot }} />
                          {action.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* ── 2-column body ── */}
                <div className="flex flex-1 min-h-0 overflow-hidden">

                  {/* ── LEFT: Context 컬럼 ── */}
                  <div
                    ref={focusLeftColRef}
                    className="overflow-y-auto flex flex-col gap-4 p-4"
                    style={{ width: "46%", borderRight: "1px solid var(--border-2)", background: "var(--bg-canvas)" }}
                  >
                    {/* 메타 */}
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
                        메타
                      </p>
                      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                        {META_ROWS.filter(r => r.value).map((row, i) => (
                          <div
                            key={row.label}
                            className="flex items-center gap-2 px-3 py-2 text-xs"
                            style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined, background: "var(--bg-overlay)" }}
                          >
                            <span className="w-16 shrink-0 font-medium" style={{ color: "var(--text-muted)" }}>{row.label}</span>
                            <span className="flex-1" style={{ color: "var(--text-primary)" }}>{row.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 요구사항 출처 (ETR) */}
                    <div data-fm-section="etr">
                      <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
                        요구사항 출처
                      </p>
                      {fmEtr ? (
                        <div className="space-y-1.5">
                          {/* 출처 유형 배지 */}
                          <div
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium"
                            style={
                              fmEtr.source === "자체발의" ? { background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.35)", color: "#818cf8" } :
                              fmEtr.source === "ELT"     ? { background: "rgba(245,158,11,0.12)",  border: "1px solid rgba(245,158,11,0.35)",  color: "#fbbf24" } :
                                                           { background: "rgba(59,130,246,0.12)",  border: "1px solid rgba(59,130,246,0.35)",  color: "#60a5fa" }
                            }
                          >
                            {fmEtr.source === "자체발의" ? "자체발의" : fmEtr.source === "ELT" ? "ELT 요구사항" : "외부 부서 요청 (ETR)"}
                          </div>
                          {/* ETR 티켓 목록 */}
                          {fmEtr.source === "ETR" && (fmEtr.etrTickets ?? []).map(t => (
                            <div key={t.key} className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs"
                              style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}
                            >
                              <span className="font-mono font-semibold shrink-0" style={{ color: "#818cf8" }}>{t.key}</span>
                              {t.summary && <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>{t.summary}</span>}
                              {t.requestDept && <span className="shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>{t.requestDept}</span>}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs italic px-1" style={{ color: "var(--text-subtle)" }}>출처 미등록</p>
                      )}
                    </div>

                    {/* 관련 문서 (Wiki) */}
                    {fmWikis.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
                          관련 문서
                        </p>
                        <div className="space-y-1">
                          {fmWikis.map(w => (
                            <a
                              key={w.url}
                              href={w.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs hover:opacity-80 transition-opacity"
                              style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 shrink-0" style={{ color: "#818cf8" }}>
                                <path fillRule="evenodd" d="M8.914 6.025a.75.75 0 0 1 1.06 0 3.5 3.5 0 0 1 0 4.95l-2 2a3.5 3.5 0 0 1-5.396-4.402.75.75 0 0 1 1.251.827 2 2 0 0 0 3.085 2.514l2-2a2 2 0 0 0 0-2.828.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                                <path fillRule="evenodd" d="M7.086 9.975a.75.75 0 0 1-1.06 0 3.5 3.5 0 0 1 0-4.95l2-2a3.5 3.5 0 0 1 5.396 4.402.75.75 0 0 1-1.251-.827 2 2 0 0 0-3.085-2.514l-2 2a2 2 0 0 0 0 2.828.75.75 0 0 1 0 1.06Z" clipRule="evenodd" />
                              </svg>
                              <span className="flex-1 min-w-0">
                                <span className="block font-medium truncate">{w.title}</span>
                                <span className="block text-[11px] truncate opacity-60">{w.url}</span>
                              </span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 최근 Weekly 요약 — Focus Mode 공통 helper. 데이터 없으면 outer div도 렌더 안 함. */}
                    {(() => {
                      const summary = renderWeeklySummary(selected.key);
                      return summary ? (
                        <div data-fm-section="weekly-summary">{summary}</div>
                      ) : null;
                    })()}
                    {/* Weekly에서 분리된 노트 (리스크 / 액션 / 참고) */}
                    {(() => {
                      const box = renderActionRiskBox(selected.key);
                      return box ? (
                        <div data-fm-section="weekly-notes">{box}</div>
                      ) : null;
                    })()}

                    {/* 주요 내용 요약 (Memo) */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                          주요 내용 요약
                        </p>
                        {!memoEditMode && (
                          <button
                            onClick={() => { setMemoText(fmMemo?.text ?? ""); setMemoEditMode(true); }}
                            className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
                          >
                            {fmMemo ? "편집" : "입력"}
                          </button>
                        )}
                      </div>
                      {memoEditMode ? (
                        <div className="space-y-1.5">
                          <textarea
                            value={memoText}
                            onChange={(e) => setMemoText(e.target.value)}
                            placeholder="주요 내용, 이슈, 결정 사항 등을 입력하세요"
                            rows={5}
                            className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
                            style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}
                          />
                          <div className="flex gap-1.5 justify-end">
                            <button
                              onClick={() => setMemoEditMode(false)}
                              className="text-[11px] px-2.5 py-1 rounded hover:opacity-70"
                              style={{ color: "var(--text-muted)" }}
                            >취소</button>
                            <button
                              onClick={() => { saveMemo(selected.key, memoText); setMemoEditMode(false); }}
                              className="text-[11px] bg-indigo-600 text-white px-3 py-1 rounded-lg hover:bg-indigo-700 font-medium"
                            >저장</button>
                          </div>
                        </div>
                      ) : fmMemo ? (
                        <div
                          className="text-xs whitespace-pre-wrap leading-relaxed rounded-lg px-3 py-2.5"
                          style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                        >
                          {fmMemo.text}
                        </div>
                      ) : (
                        <p className="text-xs italic px-1" style={{ color: "var(--text-subtle)" }}>요약 없음 — 위 &quot;입력&quot;을 클릭해 추가하세요</p>
                      )}
                    </div>

                    {/* 티켓 메모 */}
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
                        메모
                      </p>
                      {fmTicketNotes && (() => {
                        const grouped: { author: string; date: string; items: { text: string; idx: number }[] }[] = [];
                        fmTicketNotes.forEach((n, i) => {
                          const last = grouped[grouped.length - 1];
                          if (last && last.author === n.author && last.date === n.date) {
                            last.items.push({ text: n.text, idx: i });
                          } else {
                            grouped.push({ author: n.author, date: n.date, items: [{ text: n.text, idx: i }] });
                          }
                        });
                        return grouped.length > 0 ? (
                          <div className="space-y-1.5 mb-2">
                            {grouped.map((g, gi) => (
                              <div key={gi} className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                                <div className="flex items-center justify-between px-3 py-1" style={{ background: "var(--bg-overlay)", borderBottom: "1px solid var(--border)" }}>
                                  <span className="text-[11px] font-medium" style={{ color: "var(--text-primary)" }}>{g.author}</span>
                                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{g.date}</span>
                                </div>
                                {g.items.map(({ text, idx }) => (
                                  <div key={idx} className="px-3 py-2">
                                    <p className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: "var(--text-primary)" }}>{text}</p>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        ) : null;
                      })()}
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
                          placeholder="메모 (⌘+Enter 등록)"
                          rows={2}
                          className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                          style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}
                        />
                        <button
                          onClick={() => { addTicketNote(selected.key, ticketNoteInput); setTicketNoteInput(""); }}
                          disabled={!ticketNoteInput.trim()}
                          className="self-end text-[11px] bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-40 font-medium transition-colors"
                        >등록</button>
                      </div>
                    </div>
                  </div>

                  {/* ── RIGHT: Execution 컬럼 ── */}
                  <div
                    ref={focusRightColRef}
                    className="overflow-y-auto flex flex-col gap-4 p-4"
                    style={{ flex: 1, background: "var(--bg-overlay)" }}
                  >
                    {/* 플래닝 상태 */}
                    <div
                      data-fm-section="planning"
                      className="rounded-lg transition-all"
                      style={{
                        boxShadow: (sectionHighlight === "planning" || sectionHighlight === "review-needed")
                          ? "0 0 0 2px rgba(248,113,113,0.5), 0 0 14px rgba(248,113,113,0.12)"
                          : undefined,
                      }}
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
                        플래닝 상태
                      </p>
                      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg-canvas)" }}>
                        {(["design", "dev"] as const).map((track, ti) => {
                          const current = track === "design" ? fmPlan.design : fmPlan.dev;
                          const label   = track === "design" ? "Design" : "Dev";
                          const color   = track === "design" ? "#a78bfa" : "#60a5fa";
                          return (
                            <div
                              key={track}
                              className="flex items-center gap-3 px-3 py-2.5"
                              style={{ borderTop: ti > 0 ? "1px solid var(--border)" : undefined }}
                            >
                              <span className="text-xs font-semibold w-12 shrink-0" style={{ color }}>{label}</span>
                              <div className="flex gap-1 flex-1">
                                {TRACK_STATES.map(s => {
                                  const active = current === s;
                                  const activeStyle =
                                    s === "완료"     ? { background: "rgba(16,185,129,0.2)",  borderColor: "#34d399", color: "#34d399" } :
                                    s === "검토중"   ? { background: "rgba(124,58,237,0.2)",  borderColor: "#a78bfa", color: "#a78bfa" } :
                                    s === "대상아님" ? { background: "var(--bg-item-alt)", borderColor: "var(--text-primary)", color: "var(--text-primary)" } :
                                                       { background: "var(--bg-item-alt)", borderColor: "var(--text-secondary)", color: "var(--text-secondary)" };
                                  const inactiveStyle = { background: "var(--bg-overlay)", borderColor: "var(--border-2)", color: "var(--text-subtle)" };
                                  return (
                                    <button
                                      key={s}
                                      onClick={() => savePlanning(selected.key, track, s)}
                                      className="flex-1 py-1 px-1.5 rounded text-[11px] font-medium border transition-all hover:opacity-90"
                                      style={active ? activeStyle : inactiveStyle}
                                    >{s}</button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* 세부 일정 (Gantt) */}
                    <div
                      data-fm-section="schedule"
                      className="rounded-lg transition-all"
                      style={{
                        boxShadow: (sectionHighlight === "schedule" || sectionHighlight === "no-schedule" || sectionHighlight === "no-launch")
                          ? "0 0 0 2px rgba(251,191,36,0.5), 0 0 14px rgba(251,191,36,0.10)"
                          : undefined,
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                          세부 일정
                        </p>
                        {!editMode && fmRoles.length > 0 && (
                          <button
                            onClick={() => { setEditRows(fmRoles.map(r => ({ ...r }))); setEditMode(true); setEditError(null); }}
                            className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
                          >편집</button>
                        )}
                      </div>
                      {fmRoles.length > 0 ? (
                        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg-canvas)" }}>
                          <GanttChart
                            roles={fmRoles}
                            extendedView={false}
                            forceShowPastDone={false}
                            fitToContent={true}
                            ticketDone={["론치완료","완료","배포완료"].includes(selected.status)}
                            ticketActive={!["론치완료","완료","배포완료"].includes(selected.status)}
                            onEditRow={undefined}
                          />
                        </div>
                      ) : (
                        <p className="text-xs italic px-1" style={{ color: "var(--text-subtle)" }}>등록된 일정이 없습니다</p>
                      )}
                    </div>

                    {/* 플래닝 노트 */}
                    {fmNotes.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
                          플래닝 노트
                        </p>
                        <div className="space-y-1">
                          {fmNotes.map((n, i) => (
                            <div
                              key={i}
                              className="px-3 py-2 rounded-lg text-xs"
                              style={{ background: "var(--bg-canvas)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                            >
                              <p className="whitespace-pre-wrap leading-relaxed">{n.text}</p>
                              <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>{n.author} · {n.date}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                </div>{/* ── end 2-column body ── */}
              </div>
            );
          })()}

          {/* ── 스크롤 콘텐츠 (Focus Mode에서는 숨김) ── */}
          {!isDetailExpanded && <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-5">

            {/* ── owner_dashboard deep-link Reminder Strip ──────────────────────────
                source=owner_dashboard 진입 시 "왜 이동했는가"를 상단에 1줄로 표시.
                focusForKey가 현재 ticket과 일치할 때만 표시.                       */}
            {(() => {
              if (!focusContext || !focusForKey || selected.key !== focusForKey) return null;
              const REMINDER: Record<string, { icon: string; text: string; color: string; bg: string; border: string }> = {
                "schedule": { icon: "⚠", text: "세부 작업 일정을 입력해주세요",          color: "#fbbf24", bg: "rgba(245,158,11,0.08)",   border: "rgba(251,191,36,0.38)"  },
                "planning": { icon: "⚡", text: "플래닝 검토 상태를 확인·해제해주세요",    color: "#f87171", bg: "rgba(239,68,68,0.08)",    border: "rgba(248,113,113,0.38)" },
                "etr":      { icon: "ℹ", text: "요구사항 출처(ETR)를 연결해주세요",        color: "#94a3b8", bg: "rgba(100,116,139,0.06)", border: "rgba(100,116,139,0.28)" },
                "docs":     { icon: "ℹ", text: "관련 문서(PRD)를 연결해주세요",            color: "#94a3b8", bg: "rgba(100,116,139,0.06)", border: "rgba(100,116,139,0.28)" },
              };
              const r = REMINDER[focusContext];
              if (!r) return null;
              return (
                <div className="flex items-center justify-between gap-2 mb-4 px-3 py-2 rounded-lg text-xs font-semibold"
                  style={{ background: r.bg, border: `1px solid ${r.border}`, color: r.color }}>
                  <span className="flex items-center gap-1.5">
                    <span>{r.icon}</span>
                    <span>담당자 대시보드에서 이동 — {r.text}</span>
                  </span>
                  <button
                    onClick={() => { setFocusContext(null); setFocusForKey(null); setSectionHighlight(null); }}
                    className="opacity-60 hover:opacity-100 transition-opacity text-[13px] leading-none shrink-0"
                    title="알림 닫기"
                  >×</button>
                </div>
              );
            })()}

            {/* ══════════════════════════════════════════
                Overview 탭: 핵심 메타 + 보조 정보 + 요약 + 메모
                ══════════════════════════════════════════ */}
            {detailTab === "overview" && (<>

            {/* ── Action Guidance: 현재 필요한 액션 ── */}
            {(() => {
              const actions = getActionItems(
                selected,
                planning[selected.key],
                schedules[selected.key] ?? selected.roles ?? [],
                etrMap[selected.key]
              );
              if (actions.length === 0) return null;

              // ── Action 카드 계층:  critical > warning > info ──────────────────
              // purple은 selection 전용이므로 info는 neutral slate로 처리
              const LEVEL_STYLE = {
                critical: { dot: "#ef4444", color: "#f87171", bg: "rgba(239,68,68,0.09)",   border: "rgba(248,113,113,0.62)" },
                warning:  { dot: "#f59e0b", color: "#fbbf24", bg: "rgba(245,158,11,0.08)",  border: "rgba(251,191,36,0.42)" },
                info:     { dot: "#64748b", color: "#94a3b8", bg: "rgba(100,116,139,0.04)", border: "rgba(100,116,139,0.18)" },
              } as const;

              const MAX_VISIBLE = 4;
              const visible = actions.slice(0, MAX_VISIBLE);
              const overflow = actions.length - visible.length;

              return (
                <div className="rounded-lg px-3 py-2.5 mb-3" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
                    현재 필요한 액션
                  </p>
                  <div className="space-y-1.5">
                    {visible.map(action => {
                      const s = LEVEL_STYLE[action.level];
                      return (
                        <button
                          key={action.id}
                          onClick={() => { if (action.targetTab) setDetailTab(action.targetTab); }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all"
                          style={{ background: s.bg, border: `1px solid ${s.border}` }}
                          title={action.targetTab ? "Planning & Schedule 탭으로 이동" : undefined}
                        >
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.dot }} />
                          <span className="text-xs font-medium flex-1" style={{ color: s.color }}>{action.label}</span>
                          {action.targetTab && (
                            <svg className="w-3 h-3 shrink-0 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="9 18 15 12 9 6"/>
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {overflow > 0 && (
                    <p className="mt-1.5 text-[11px]" style={{ color: "var(--text-subtle)" }}>+{overflow}개 항목 (Planning & Schedule 탭에서 확인)</p>
                  )}
                </div>
              );
            })()}

            {/* ── 핵심 메타 정보 ── */}
            <div className="rounded-lg px-3 py-3 mb-3" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
              <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                {/* 담당자 */}
                <div>
                  <p className="text-[12px] mb-0.5" style={{ color: "var(--text-muted)" }}>담당자</p>
                  <p className="text-sm font-medium leading-snug" style={{ color: "var(--text-primary)" }}>{selected.assignee || "-"}</p>
                </div>
                {/* ETA */}
                <div>
                  <p className="text-[12px] mb-0.5" style={{ color: "var(--text-muted)" }}>ETA</p>
                  {(() => {
                    const todayStr2 = new Date().toISOString().split("T")[0];
                    const hasEta = selected.eta && selected.eta !== "-";
                    const overdue = hasEta && selected.eta! < todayStr2 && !["론치완료","완료","배포완료"].includes(selected.status);
                    return (
                      <p className="text-sm font-semibold leading-snug" style={{ color: overdue ? "#f87171" : "var(--text-primary)" }}>
                        {hasEta ? formatDateWithDay(selected.eta!) : "미정"}
                        {overdue && <span className="ml-1 text-[11px] font-normal" style={{ color: "#f87171", opacity: 0.8 }}>경과</span>}
                      </p>
                    );
                  })()}
                </div>
                {/* 프로젝트 */}
                <div>
                  <p className="text-[12px] mb-0.5" style={{ color: "var(--text-muted)" }}>프로젝트</p>
                  <p className="text-sm font-medium leading-snug" style={{ color: "var(--text-primary)" }}>{selected.project || "-"}</p>
                </div>
                {/* 시작일 */}
                <div>
                  <p className="text-[12px] mb-0.5" style={{ color: "var(--text-muted)" }}>시작일</p>
                  <p className="text-sm font-medium leading-snug" style={{ color: "var(--text-primary)" }}>
                    {selected.startDate ? formatDateWithDay(selected.startDate) : "미정"}
                  </p>
                </div>
                {/* 요청 우선순위 */}
                {selected.requestPriority && (
                  <div>
                    <p className="text-[12px] mb-0.5" style={{ color: "var(--text-muted)" }}>요청 우선순위</p>
                    <p className="text-sm font-medium leading-snug" style={{ color: "var(--text-primary)" }}>{selected.requestPriority}</p>
                  </div>
                )}
                {/* Story Points */}
                {selected.storyPoints != null && (
                  <div>
                    <p className="text-[12px] mb-0.5" style={{ color: "var(--text-muted)" }}>Story Points</p>
                    <p className="text-sm font-semibold leading-snug" style={{ color: "var(--text-primary)" }}>{selected.storyPoints}</p>
                  </div>
                )}
              </div>
              {/* Health Check */}
              {selected.healthCheck && (
                <div className="mt-3 pt-2.5" style={{ borderTop: "1px solid var(--border)" }}>
                  <p className="text-[12px] mb-1" style={{ color: "var(--text-muted)" }}>Health Check</p>
                  <HealthBadge value={selected.healthCheck} />
                </div>
              )}
            </div>

            {/* ── 보조 정보 ── */}
            {(selected.requestDept || selected.bodyRequestDept || selected.parent || selected.twoPagerUrl || selected.prdUrl) && (
              <div className="rounded-lg px-3 py-2.5 mb-3 space-y-2" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
                {[
                  { label: "Main Subject", value: selected.requestDept },
                  { label: "요청부문",     value: selected.bodyRequestDept },
                ].filter(r => r.value).map(({ label, value }) => (
                  <div key={label} className="flex items-center gap-2 text-[12px]">
                    <span className="w-24 shrink-0" style={{ color: "var(--text-muted)" }}>{label}</span>
                    <span style={{ color: "var(--text-secondary)" }}>{value}</span>
                  </div>
                ))}
                {selected.parent && (
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="w-24 shrink-0" style={{ color: "var(--text-muted)" }}>상위 항목</span>
                    <a href={`${JIRA_BASE}${selected.parent}`} target="_blank" rel="noopener noreferrer"
                      className="font-mono text-blue-500 hover:underline">{selected.parent}</a>
                  </div>
                )}
                {selected.twoPagerUrl && (
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="w-24 shrink-0" style={{ color: "var(--text-muted)" }}>2-Pager</span>
                    <a href={selected.twoPagerUrl} target="_blank" rel="noopener noreferrer"
                      className="text-blue-500 hover:underline">링크 열기 ↗</a>
                  </div>
                )}
                {selected.prdUrl && (
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="w-24 shrink-0" style={{ color: "var(--text-muted)" }}>PRD Link</span>
                    <a href={selected.prdUrl} target="_blank" rel="noopener noreferrer"
                      className="text-blue-500 hover:underline">링크 열기 ↗</a>
                  </div>
                )}
              </div>
            )}

            </>) /* ─ Overview: 핵심 메타 + 보조 정보 끝 ─ */}

            {/* ══════════════════════════════════════════
                Overview 계속: 요구사항 출처 + 관련 문서
                (이전 Planning 탭에서 Overview로 이동 — context 정보로 분류)
                ══════════════════════════════════════════ */}
            {detailTab === "overview" && (<>

            {/* 요구사항 출처 — data-focus-section="etr" */}
            <div
              data-focus-section="etr"
              className="rounded-lg px-3 py-2.5 mb-4"
              style={{
                background: "var(--bg-overlay)",
                border: `1px solid ${sectionHighlight === "etr" ? "rgba(100,116,139,0.6)" : "var(--border)"}`,
                boxShadow: sectionHighlight === "etr" ? "0 0 0 2px rgba(100,116,139,0.35), 0 0 12px rgba(100,116,139,0.08)" : undefined,
                transition: "box-shadow 0.4s ease, border-color 0.4s ease",
              }}
            >
              {/* 섹션 헤더 */}
              <div className="flex items-center gap-1.5 mb-2.5">
                <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>요구사항 출처</p>
                <Tooltip
                  content={"이 과제가 어디서 시작됐는지 분류합니다.\n자체발의: CC팀 주도 기획\nELT: 경영진 요구사항\nETR: 타 부서 공식 요청"}
                  side="bottom"
                  maxWidth={230}
                >
                  <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold cursor-default"
                    style={{ background: "var(--bg-item)", color: "var(--text-subtle)", border: "1px solid var(--border-2)" }}>
                    ?
                  </span>
                </Tooltip>
              </div>

              {/* 출처 선택 */}
              {(() => {
                const SOURCE_TIPS: Record<"자체발의" | "ELT" | "ETR", string> = {
                  "자체발의": "Commerce Core 팀이 주도적으로 기획한 과제입니다.",
                  "ELT":     "경영진(ELT) 요구사항으로 시작된 과제입니다.\n우선순위 조율 시 레퍼런스로 활용하세요.",
                  "ETR":     "타 부서의 공식 요청(ETR)으로 진행되는 과제입니다.\n아래에 ETR 티켓을 연결해주세요.",
                };
                return (
                  <div className="flex gap-1.5 mb-3">
                    {(["자체발의", "ELT", "ETR"] as const).map(src => {
                      const active = etrMap[selected.key]?.source === src;
                      const label =
                        src === "자체발의" ? "자체발의" :
                        src === "ELT"     ? "ELT 요구사항" :
                                            "외부 부서 요청";
                      const activeStyle =
                        src === "자체발의" ? { background: "rgba(99,102,241,0.12)", borderColor: "rgba(99,102,241,0.35)", color: "#818cf8" } :
                        src === "ELT"     ? { background: "rgba(245,158,11,0.12)", borderColor: "rgba(245,158,11,0.35)", color: "#fbbf24" } :
                                            { background: "rgba(59,130,246,0.12)", borderColor: "rgba(59,130,246,0.35)", color: "#60a5fa" };
                      const inactiveStyle = { background: "var(--bg-item)", borderColor: "var(--text-subtle)", color: "var(--text-secondary)" };
                      return (
                        <Tooltip key={src} content={SOURCE_TIPS[src]} side="bottom" maxWidth={220}>
                          <button
                            onClick={() => setEtrSource(selected.key, src)}
                            className="flex-1 py-1.5 px-2 rounded-lg text-[13px] font-medium border transition-all"
                            style={active ? activeStyle : inactiveStyle}
                          >{label}</button>
                        </Tooltip>
                      );
                    })}
                  </div>
                );
              })()}

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
                          <div key={t.key} className="rounded-lg px-3 py-2.5" style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)" }}>
                            {/* 요약 텍스트 — 가장 눈에 띄게 */}
                            {(t.summary || t.requestDept) && (
                              <p className="text-[12px] font-medium mb-1.5 leading-snug" style={{ color: "var(--text-primary)" }}>
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
                                className="font-mono text-[12px] hover:underline shrink-0"
                                style={{ color: "#60a5fa" }}
                              >{t.key}</a>
                              {st && (
                                <span className="rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0" style={{ background: stStyle.bg, color: stStyle.color, border: `1px solid ${stStyle.border}` }}>{st}</span>
                              )}
                              <button
                                onClick={() => removeEtr(selected.key, t.key)}
                                className="ml-auto hover:text-red-400 transition-colors shrink-0 text-[12px]" style={{ color: "var(--text-subtle)" }}
                              >×</button>
                            </div>
                            {!t.summary && !t.requestDept && (
                              <p className="text-[12px] italic" style={{ color: "var(--text-subtle)" }}>정보 없음</p>
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
                      className="flex-1 rounded px-2 py-1 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}
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

              {/* 관련 주요 문서 연결 섹션 — data-focus-section="docs" */}
              <div
                data-focus-section="docs"
                className="mt-3 pt-3"
                style={{
                  borderTop: "1px solid var(--border)",
                  borderRadius: sectionHighlight === "docs" ? "6px" : undefined,
                  boxShadow: sectionHighlight === "docs" ? "0 0 0 2px rgba(100,116,139,0.35), 0 0 12px rgba(100,116,139,0.08)" : undefined,
                  transition: "box-shadow 0.4s ease",
                }}
              >
                {/* 헤더: 타이틀 + 추가 버튼 */}
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0" style={{ color: "#818cf8" }}>
                      <path fillRule="evenodd" d="M8.914 6.025a.75.75 0 0 1 1.06 0 3.5 3.5 0 0 1 0 4.95l-2 2a3.5 3.5 0 0 1-5.396-4.402.75.75 0 0 1 1.251.827 2 2 0 0 0 3.085 2.514l2-2a2 2 0 0 0 0-2.828.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                      <path fillRule="evenodd" d="M7.086 9.975a.75.75 0 0 1-1.06 0 3.5 3.5 0 0 1 0-4.95l2-2a3.5 3.5 0 0 1 5.396 4.402.75.75 0 0 1-1.251-.827 2 2 0 0 0-3.085-2.514l-2 2a2 2 0 0 0 0 2.828.75.75 0 0 1 0 1.06Z" clipRule="evenodd" />
                    </svg>
                    관련 주요 문서 연결
                  </p>
                  <button
                    onClick={() => { setWikiAddOpen(v => !v); setWikiError(null); setWikiInput(""); setWikiTitleInput(""); }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[12px] font-medium transition-colors"
                    style={wikiAddOpen
                      ? { background: "rgba(124,58,237,0.15)", color: "#a78bfa", border: "1px solid rgba(124,58,237,0.4)" }
                      : { background: "var(--border)", color: "var(--text-muted)", border: "1px solid var(--border-2)" }}
                  >
                    {wikiAddOpen ? "✕ 취소" : "+ 추가"}
                  </button>
                </div>

                {/* 등록된 문서 목록 */}
                {(etrMap[selected.key]?.wikiLinks ?? []).length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {(etrMap[selected.key]?.wikiLinks ?? []).map(w => (
                      <div key={w.url} className="rounded-lg group" style={{ background: "var(--bg-canvas)", border: `1px solid ${wikiEditUrl === w.url ? "#7c3aed" : "var(--border-2)"}` }}>
                        {wikiEditUrl === w.url ? (
                          /* 인라인 수정 폼 */
                          <div className="space-y-1.5 p-2.5">
                            <input
                              autoFocus
                              type="text"
                              value={wikiEditInput}
                              onChange={e => { setWikiEditInput(e.target.value); setWikiError(null); }}
                              onKeyDown={e => e.key === "Enter" && updateWikiLink(selected.key, w.url)}
                              placeholder="URL (https://...)"
                              className="w-full rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}
                            />
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                value={wikiEditTitleInput}
                                onChange={e => setWikiEditTitleInput(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && updateWikiLink(selected.key, w.url)}
                                placeholder="제목 (비우면 URL에서 자동 추출)"
                                className="flex-1 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}
                              />
                              <button
                                onClick={() => updateWikiLink(selected.key, w.url)}
                                disabled={!wikiEditInput.trim()}
                                className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-40 transition-colors"
                                style={{ background: "#7c3aed", color: "#fff" }}
                              >저장</button>
                              <button
                                onClick={() => { setWikiEditUrl(null); setWikiError(null); }}
                                className="px-2.5 py-1.5 rounded text-xs transition-colors"
                                style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", color: "var(--text-muted)" }}
                              >취소</button>
                            </div>
                            {wikiError && <p className="text-red-500 text-[12px]">{wikiError}</p>}
                          </div>
                        ) : (
                          /* 일반 표시 */
                          <div className="flex items-start gap-2 px-3 py-2.5">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#818cf8" }}>
                              <path fillRule="evenodd" d="M8.914 6.025a.75.75 0 0 1 1.06 0 3.5 3.5 0 0 1 0 4.95l-2 2a3.5 3.5 0 0 1-5.396-4.402.75.75 0 0 1 1.251.827 2 2 0 0 0 3.085 2.514l2-2a2 2 0 0 0 0-2.828.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                              <path fillRule="evenodd" d="M7.086 9.975a.75.75 0 0 1-1.06 0 3.5 3.5 0 0 1 0-4.95l2-2a3.5 3.5 0 0 1 5.396 4.402.75.75 0 0 1-1.251-.827 2 2 0 0 0-3.085-2.514l-2 2a2 2 0 0 0 0 2.828.75.75 0 0 1 0 1.06Z" clipRule="evenodd" />
                            </svg>
                            <div className="flex-1 min-w-0">
                              <a
                                href={w.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block text-[13px] font-medium hover:underline leading-snug"
                                style={{ color: "var(--text-primary)" }}
                                title={w.url}
                              >{w.title}</a>
                              <p className="text-[12px] mt-0.5 truncate" style={{ color: "var(--text-subtle)" }}>{w.url}</p>
                            </div>
                            {/* 수정/삭제 버튼 — hover 시 노출 */}
                            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => { setWikiEditUrl(w.url); setWikiEditInput(w.url); setWikiEditTitleInput(w.title); setWikiError(null); setWikiAddOpen(false); }}
                                className="w-5 h-5 flex items-center justify-center rounded transition-colors text-[11px]"
                                style={{ color: "var(--text-subtle)" }}
                                title="수정"
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#a78bfa"; (e.currentTarget as HTMLElement).style.background = "rgba(124,58,237,0.1)"; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-subtle)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                              >✎</button>
                              <button
                                onClick={() => removeWikiLink(selected.key, w.url)}
                                className="w-5 h-5 flex items-center justify-center rounded transition-colors text-[12px]"
                                style={{ color: "var(--text-subtle)" }}
                                title="삭제"
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#f87171"; (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.1)"; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-subtle)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                              >×</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* 입력 폼 — 추가 버튼 클릭 시에만 노출 */}
                {wikiAddOpen && (
                  <div className="space-y-1.5 rounded-lg p-2.5" style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)" }}>
                    <input
                      autoFocus
                      type="text"
                      placeholder="URL (https://...)"
                      value={wikiInput}
                      onChange={(e) => { setWikiInput(e.target.value); setWikiError(null); }}
                      onKeyDown={(e) => e.key === "Enter" && addWikiLink(selected.key)}
                      className="w-full rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}
                    />
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        placeholder="제목 (비우면 URL에서 자동 추출)"
                        value={wikiTitleInput}
                        onChange={(e) => setWikiTitleInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addWikiLink(selected.key)}
                        className="flex-1 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}
                      />
                      <button
                        onClick={() => addWikiLink(selected.key)}
                        disabled={!wikiInput.trim()}
                        className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-40 transition-colors"
                        style={{ background: "#7c3aed", color: "#fff" }}
                      >저장</button>
                    </div>
                    {wikiError && <p className="text-red-500 text-[12px]">{wikiError}</p>}
                  </div>
                )}

                {/* 문서 없고 폼도 닫혀있을 때 */}
                {(etrMap[selected.key]?.wikiLinks ?? []).length === 0 && !wikiAddOpen && (
                  <p className="text-[12px]" style={{ color: "var(--text-subtle)" }}>연결된 문서가 없습니다</p>
                )}
              </div>
            </div>

            </>) /* ─ Overview: 요구사항 출처 + 관련 문서 끝 ─ */}

            {/* ══════════════════════════════════════════
                Overview 계속: 주요 내용 요약 + 메모
                ══════════════════════════════════════════ */}
            {detailTab === "overview" && (<>
            <div className="pt-4" style={{ borderTop: "1px solid var(--border)" }}>

              {/* ── 최근 Weekly 요약 (공통 helper 사용) ──────────────── */}
              {renderWeeklySummary(selected.key)}
              {/* ── Weekly에서 분리된 노트 (리스크 / 액션 / 참고) ────── */}
              {renderActionRiskBox(selected.key)}

              {/* 주요 내용 요약 */}
              <div className="mb-4">
                {/* 헤더 */}
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>주요 내용 요약</p>
                  <div className="flex items-center gap-2">
                    {/* AI 재생성 버튼 */}
                    {!memoEditMode && (
                      <button
                        onClick={() => regenerateSummary(selected.key)}
                        disabled={summaryLoading.has(selected.key)}
                        className="flex items-center gap-1 text-[12px] hover:text-indigo-400 disabled:opacity-40 transition-colors" style={{ color: "var(--text-muted)" }}
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
                        className="text-[12px] text-indigo-500 hover:text-indigo-700 font-medium"
                      >{getCurrentMemo(selected.key) ? "편집" : "입력"}</button>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => { saveMemo(selected.key, memoText); setMemoEditMode(false); }}
                          className="text-[12px] bg-indigo-600 text-white px-2.5 py-1 rounded-lg hover:bg-indigo-700 font-medium"
                        >저장</button>
                        <button onClick={() => setMemoEditMode(false)}
                          className="text-[12px] px-2 py-1 hover:opacity-80" style={{ color: "var(--text-muted)" }}>취소</button>
                      </div>
                    )}
                  </div>
                </div>

                {/* AI 에러 메시지 */}
                {regenError && !memoEditMode && !summaryLoading.has(selected.key) && (
                  <div className="mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-600">
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
                    className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}
                  />
                ) : summaryLoading.has(selected.key) ? (
                  <div className="flex items-center gap-2 text-[12px] text-indigo-400 bg-indigo-50 rounded-lg px-3 py-2">
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
                            <span className="text-[12px] flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                              {cur.isAI && <span className="px-1 py-0.5 rounded border text-[11px]" style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8", borderColor: "rgba(99,102,241,0.3)" }}>AI</span>}
                              {cur.author}{cur.date ? ` · ${cur.date}` : ""}
                            </span>
                            {(memoHistory[selected.key]?.length ?? 0) > 1 && (
                              <button
                                onClick={() => setMemoHistoryOpen(o => !o)}
                                className="text-[12px] hover:opacity-80 transition-colors" style={{ color: "var(--text-muted)" }}
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
                      <div className="mt-3 space-y-2 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                        <p className="text-[12px] font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>이전 버전</p>
                        {[...(memoHistory[selected.key] ?? [])].reverse().slice(1).map((v, i) => (
                          <div key={i} className="rounded-lg overflow-visible opacity-70" style={{ border: "1px solid var(--border)" }}>
                            <div className="flex items-center justify-between px-3 py-1.5 rounded-t-lg" style={{ background: "var(--bg-overlay)", borderBottom: "1px solid var(--border)" }}>
                              <span className="text-[12px] flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                                {v.isAI && <span className="px-1 py-0.5 rounded text-[11px]" style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>AI</span>}
                                {v.author}
                              </span>
                              <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{v.date}</span>
                            </div>
                            <div className="text-sm whitespace-pre-wrap leading-relaxed px-3 py-2" style={{ color: "var(--text-muted)" }}>{v.text}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-[12px] italic" style={{ color: "var(--text-subtle)" }}>입력된 내용이 없습니다</p>
                )}
              </div>

              {/* 메모 */}
              <div className="mb-4 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
                <p className="text-sm font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>메모</p>

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
                        <div key={gi} className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                          <div className="flex items-center justify-between px-3 py-1.5" style={{ background: "var(--bg-overlay)", borderBottom: "1px solid var(--border)" }}>
                            <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{g.author}</span>
                            <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{g.date}</span>
                          </div>
                          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                            {g.items.map(({ text, idx }) => (
                              <div key={idx} className="group flex items-start gap-2 px-3 py-2">
                                <p className="flex-1 text-sm whitespace-pre-wrap leading-relaxed" style={{ color: "var(--text-primary)" }}>{text}</p>
                                <button
                                  onClick={() => deleteTicketNote(selected.key, idx)}
                                  className="shrink-0 hover:text-red-400 text-[12px] opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" style={{ color: "var(--text-subtle)" }}
                                >삭제</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })() : (
                  <p className="text-[12px] italic mb-2" style={{ color: "var(--text-subtle)" }}>등록된 메모가 없습니다</p>
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
                    className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}
                  />
                  <button
                    onClick={() => { addTicketNote(selected.key, ticketNoteInput); setTicketNoteInput(""); }}
                    disabled={!ticketNoteInput.trim()}
                    className="self-end text-[12px] bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
                  >등록</button>
                </div>
              </div>
            </div>
            </>) /* ─ Overview: 주요 내용 요약 + 메모 끝 ─ */}

            {/* ══════════════════════════════════════════
                Planning & Schedule 탭: 플래닝 상태
                ══════════════════════════════════════════ */}
            {detailTab === "ops" && (<>
              {/* ── Phase 4: ticket-specific Weekly 일정 변경 제안 ── */}
              {(() => {
                const tCand = updateCandidates.filter(c => !c.resolved && c.ticketKey === selected.key);
                if (tCand.length === 0) return null;
                const FIELD_LABEL: Record<string, string> = {
                  start: "시작일", end: "종료일", status: "상태", person: "담당자",
                };
                return (
                  <div
                    className="pt-4 mb-4"
                    style={{ borderTop: "1px solid var(--border)" }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[13px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                        Weekly 일정 변경 제안
                      </span>
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.35)" }}
                      >
                        {tCand.length}건
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {tCand.map(c => {
                        const role = c.mergeKey.split("::")[1] ?? "—";
                        const phase = inferPhase(role);
                        const resourceTeam = inferResourceTeam(role);
                        const primary = phase ? PHASE_LABEL[phase] : role;
                        const showSub = !!resourceTeam && resourceTeam !== primary;
                        const inFlight = candidatesInFlight.has(c.id);
                        return (
                          <div
                            key={c.id}
                            className="rounded-md p-2.5"
                            style={{ background: "var(--bg-item)", border: "1px solid var(--border-2)" }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center flex-wrap gap-1.5 text-xs mb-1">
                                  <span
                                    className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                                    style={{ background: "rgba(129,140,248,0.15)", color: "#818cf8" }}
                                  >
                                    {primary}
                                  </span>
                                  {showSub && (
                                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>· {resourceTeam}</span>
                                  )}
                                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                                    {FIELD_LABEL[c.field] ?? c.field}
                                  </span>
                                  <span className="text-xs line-through" style={{ color: "var(--text-muted)" }}>
                                    {c.oldValue || "(빈 값)"}
                                  </span>
                                  <span style={{ color: "var(--text-muted)" }}>→</span>
                                  <span className="text-xs font-medium" style={{ color: "#10b981" }}>
                                    {c.newValue || "(빈 값)"}
                                  </span>
                                </div>
                                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                                  {c.sourceWeek}
                                  {c.autoApply && (
                                    <span className="ml-1.5">· 자동적용 가능</span>
                                  )}
                                </div>
                              </div>
                              <div className="flex gap-1 shrink-0">
                                <button
                                  type="button"
                                  disabled={inFlight}
                                  onClick={() => resolveCandidate(c.id, "apply")}
                                  className="px-2 py-0.5 text-[11px] rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed transition hover:brightness-110"
                                  style={{ background: "#10b981", color: "white" }}
                                >
                                  {inFlight ? "…" : "✓ 승인"}
                                </button>
                                <button
                                  type="button"
                                  disabled={inFlight}
                                  onClick={() => resolveCandidate(c.id, "dismiss")}
                                  className="px-2 py-0.5 text-[11px] rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
                                  style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)", color: "var(--text-secondary)" }}
                                >
                                  ✕ 기각
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* 플래닝 상태 — data-focus-section="planning" */}
              <div
                data-focus-section="planning"
                className="pt-4 mb-4"
                style={{
                  borderTop: "1px solid var(--border)",
                  transition: "box-shadow 0.4s ease",
                  borderRadius: sectionHighlight === "planning" ? "8px" : undefined,
                  boxShadow: sectionHighlight === "planning"
                    ? "0 0 0 2px rgba(248,113,113,0.5), 0 0 14px rgba(248,113,113,0.12)"
                    : undefined,
                }}
              >
                <button
                  onClick={() => setPlanningOpen(o => !o)}
                  className="flex items-center justify-between w-full mb-2 group"
                >
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>플래닝 상태</p>
                    {(() => {
                      const p = getPlanningVal(planning[selected.key]);
                      const allDone = (p.design === "완료" || p.design === "대상아님") && (p.dev === "완료" || p.dev === "대상아님");
                      const noSchedule = getRoles(selected).length === 0;
                      if (!allDone && !noSchedule) return null;
                      return (
                        <div className="flex flex-col gap-1 ml-1">
                          {allDone && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>플래닝 상태</span>
                              <span className="text-[11px] font-medium text-green-700 bg-green-50 border border-green-200 dark:text-green-400 dark:bg-green-900/30 dark:border-green-700/40 px-1.5 py-0.5 rounded">완료 ✓</span>
                            </div>
                          )}
                          {allDone && noSchedule && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>일정 상태</span>
                              <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-400 dark:bg-amber-900/30 dark:border-amber-700/40 px-1.5 py-0.5 rounded">등록 필요</span>
                            </div>
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
                            s === "대상아님" ? { background: "var(--bg-item-alt)", borderColor: "var(--text-primary)", color: "var(--text-primary)", boxShadow: "0 0 0 1px var(--border)" } :
                                               { background: "var(--bg-item-alt)", borderColor: "var(--text-secondary)", color: "var(--text-secondary)", boxShadow: "0 0 0 1px var(--border-2)" };
                          const inactiveStyle = { background: "var(--bg-overlay)", borderColor: "var(--border-2)", color: "var(--text-subtle)", boxShadow: "none" };
                          return (
                            <button key={s} onClick={() => savePlanning(selected.key, "design", s)}
                              className="flex-1 py-1.5 px-2 rounded-lg text-[13px] font-medium border transition-all hover:opacity-90"
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
                                  className="text-[12px] font-semibold px-2 py-0.5 rounded-full border transition-all"
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
                            <span className="text-[12px] ml-1" style={{ color: "var(--text-subtle)" }}>
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
                                  <span className="text-[12px] font-semibold w-6 shrink-0" style={{ color: "#60a5fa" }}>{tk}</span>
                                  {TRACK_STATES.map(s => {
                                    const active = current === s;
                                    const activeStyle =
                                      s === "완료"     ? { background: "rgba(16,185,129,0.2)",  borderColor: "#34d399", color: "#34d399",  boxShadow: "0 0 0 1px #34d399" } :
                                      s === "검토중"   ? { background: "rgba(59,130,246,0.2)",  borderColor: "#60a5fa", color: "#60a5fa",  boxShadow: "0 0 0 1px #60a5fa" } :
                                      s === "대상아님" ? { background: "var(--bg-item-alt)", borderColor: "var(--text-primary)", color: "var(--text-primary)", boxShadow: "0 0 0 1px var(--border)" } :
                                                         { background: "var(--bg-item-alt)", borderColor: "var(--text-secondary)", color: "var(--text-secondary)", boxShadow: "0 0 0 1px var(--border-2)" };
                                    const inactiveStyle = { background: "var(--bg-overlay)", borderColor: "var(--border-2)", color: "var(--text-subtle)", boxShadow: "none" };
                                    return (
                                      <button key={s} onClick={() => saveDevTrack(selected.key, tk, s)}
                                        className="flex-1 py-1 px-1.5 rounded-lg text-[13px] font-medium border transition-all hover:opacity-90"
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
                    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                      <button
                        onClick={() => toggleReviewNeeded(selected.key)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border text-[13px] font-semibold transition-all"
                        style={p.reviewNeeded ? {
                          background: "rgba(239,68,68,0.12)",
                          border: "1px solid #f87171",
                          color: "#f87171",
                          boxShadow: "0 0 0 1px rgba(248,113,113,0.25)",
                        } : {
                          background: "var(--bg-overlay)",
                          border: "1px solid var(--border-2)",
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
                  <p className="text-sm font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>플래닝 코멘트</p>

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
                          <div key={gi} className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                            <div className="flex items-center justify-between px-3 py-1.5" style={{ background: "var(--bg-overlay)", borderBottom: "1px solid var(--border)" }}>
                              <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{g.author}</span>
                              <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{g.date}</span>
                            </div>
                            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                              {g.items.map(({ text, idx }) => (
                                <div key={idx} className="group flex items-start gap-2 px-3 py-2">
                                  <p className="flex-1 text-sm whitespace-pre-wrap leading-relaxed" style={{ color: "var(--text-primary)" }}>{text}</p>
                                  <button
                                    onClick={() => deletePlanningNote(selected.key, idx)}
                                    className="shrink-0 hover:text-red-400 text-[12px] opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" style={{ color: "var(--text-subtle)" }}
                                  >삭제</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })() : (
                    <p className="text-[12px] italic mb-2" style={{ color: "var(--text-subtle)" }}>등록된 코멘트가 없습니다</p>
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
                      className="w-full text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}
                    />
                    <button
                      onClick={() => { addPlanningNote(selected.key, noteInput); setNoteInput(""); }}
                      disabled={!noteInput.trim()}
                      className="self-end text-[12px] bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
                    >등록</button>
                  </div>
                </div>
                  </>
                )}
              </div>
            </>) /* ─ ops: 플래닝 상태 끝 ─ */}

            {/* ══════════════════════════════════════════
                Planning & Schedule 탭 계속: 작업별 일정 (Schedule)
                ══════════════════════════════════════════ */}
            {detailTab === "ops" && (<>
              {/* ── Schedule 섹션 — data-focus-section="schedule" ── */}
              <div
                data-focus-section="schedule"
                className="flex items-center gap-2 mt-2 mb-1"
                style={{
                  borderTop: "1px solid var(--border)",
                  borderRadius: sectionHighlight === "schedule" ? "8px" : undefined,
                  boxShadow: sectionHighlight === "schedule"
                    ? "0 0 0 2px rgba(251,191,36,0.5), 0 0 14px rgba(251,191,36,0.10)"
                    : undefined,
                  transition: "box-shadow 0.4s ease",
                }}>
                <span className="pt-3 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-subtle)" }}>Schedule</span>
              </div>
              <div className="pt-2" style={{ borderTop: "none" }}>
              {/* 작업별 일정 헤더 */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>작업별 일정</p>
                {!editMode ? (
                  <button
                    onClick={() => startEdit()}
                    className="text-[12px] font-medium text-indigo-500 hover:text-indigo-400 transition-colors"
                  >편집</button>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex rounded-lg overflow-hidden text-[13px]" style={{ border: "1px solid var(--border-2)" }}>
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
                        className="px-2 py-1 hover:opacity-80 transition-colors" style={{ color: "var(--text-muted)", borderLeft: "1px solid var(--border-2)" }}
                      >최신순</button>
                    </div>
                    <button onClick={saveEdit}
                      className="text-[12px] bg-indigo-600 text-white px-2.5 py-1 rounded-lg hover:bg-indigo-700 font-medium">저장</button>
                    <button onClick={() => { setEditMode(false); setEditError(null); }}
                      className="text-[12px] px-2 py-1 hover:opacity-80" style={{ color: "var(--text-muted)" }}>취소</button>
                  </div>
                )}
              </div>

              {/* 일정 빈 상태 안내 */}
              {(() => {
                if (getRoles(selected).length > 0 || editMode) return null;
                const p = getPlanningVal(planning[selected.key]);
                const planningDone = (p.design === "완료" || p.design === "대상아님") && (p.dev === "완료" || p.dev === "대상아님");
                return (
                  <div
                    className="rounded-lg px-4 py-3.5 mb-3 flex flex-col gap-2"
                    style={{
                      background: planningDone ? "rgba(251,146,60,0.07)" : "var(--bg-overlay)",
                      border: `1px solid ${planningDone ? "rgba(251,146,60,0.3)" : "var(--border)"}`,
                    }}
                  >
                    <p className="text-[13px] font-medium" style={{ color: planningDone ? "#fb923c" : "var(--text-secondary)" }}>
                      작업별 일정이 아직 등록되지 않았습니다.
                    </p>
                    <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                      일정을 입력하면 리소스 현황과 로드맵 집계에 자동 반영됩니다.
                    </p>
                    <button
                      onClick={() => startEdit()}
                      className="self-start mt-0.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors"
                      style={planningDone
                        ? { background: "#fb923c", color: "#fff" }
                        : { background: "var(--bg-item)", color: "var(--text-secondary)", border: "1px solid var(--border-2)" }}
                    >
                      일정 입력
                    </button>
                  </div>
                );
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
                    // (custom 분기는 phase + resourceTeam 모델로 대체됨 — 항상 detail input 표시)
                    void isCustomRole;
                    const errRole   = !!editError && !row.role;
                    const errPerson = !!editError && !row.person;
                    const errStart  = !!editError && row.status !== "미정" && !row.start;
                    const errEnd    = !!editError && row.status !== "미정" && !row.end;
                    const errBorder = "border-red-400";
                    const okBorder  = "border-gray-300";
                    const isFocused   = editFocusKey === makeEditFocusKey(row);
                    const isMilestone = MILESTONE_ROLES.includes(row.role);
                    const todayForEdit = new Date().toISOString().split("T")[0];
                    const isRowDone    = row.status === "완료";
                    const isRowOverdue = !isRowDone && !!row.end && row.end < todayForEdit;
                    const isRowWarning = row.status === "확인필요";

                    // 행 배경/테두리 계층
                    const rowBg = isFocused
                      ? "#1c2440"
                      : isRowDone
                        ? "var(--bg-canvas)"
                        : "var(--bg-overlay)";
                    const rowBorderLeft = isRowOverdue
                      ? "3px solid #f87171"
                      : isRowWarning
                        ? "3px solid #fb923c"
                        : isMilestone
                          ? "3px solid #818cf8"
                          : "3px solid transparent";

                    return (
                      <div
                        key={i}
                        ref={el => { editRowRefs.current[i] = el; }}
                        className={`rounded-lg p-2.5 space-y-1.5 transition-colors ${isFocused ? "ring-2 ring-indigo-500" : ""} ${isRowDone ? "opacity-60" : ""}`}
                        style={{
                          background: rowBg,
                          borderLeft: rowBorderLeft,
                          border: isFocused ? undefined : "1px solid var(--border-2)",
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          {/* Phase select (운영 단계 taxonomy) */}
                          {(() => {
                            // 현재 row의 phase 추론 — 명시값 > role에서 추론 > "기타"
                            const currentPhase: NonNullable<RoleSchedule["phase"]> =
                              row.phase ?? inferPhase(row.role) ?? "기타";
                            const PHASE_OPTIONS: NonNullable<RoleSchedule["phase"]>[] =
                              ["Kick-Off", "기획", "디자인", "개발", "QA", "Release", "Launch", "기타"];
                            return (
                              <select
                                value={currentPhase}
                                onChange={(e) => {
                                  setEditError(null);
                                  const nextPhase = e.target.value as NonNullable<RoleSchedule["phase"]>;
                                  setEditRows(prev => prev.map((r, idx) => {
                                    if (idx !== i) return r;
                                    const resourceTeam = r.resourceTeam ?? inferResourceTeam(r.role);
                                    const nextRole = resourceTeam || nextPhase;
                                    return { ...r, phase: nextPhase, role: nextRole };
                                  }));
                                }}
                                className={`text-xs border ${errRole ? errBorder : okBorder} rounded px-1.5 py-1 shrink-0 w-20`}
                                style={{ background: "var(--bg-canvas)", color: "var(--text-primary)" }}
                                title="운영 단계 (taxonomy)"
                              >
                                {PHASE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                              </select>
                            );
                          })()}
                          {/* ResourceTeam free input — 자유 조직 명칭 (Core AI BE, BE-PP 등). 비워두면 phase 만 사용 */}
                          {(() => {
                            const currentResource = row.resourceTeam
                              ?? (row.resourceTeam === null ? "" : inferResourceTeam(row.role) ?? "");
                            return (
                              <input
                                value={currentResource ?? ""}
                                onChange={(e) => {
                                  setEditError(null);
                                  const nextResource = e.target.value;
                                  setEditRows(prev => prev.map((r, idx) => {
                                    if (idx !== i) return r;
                                    const phase = r.phase ?? inferPhase(r.role) ?? "기타";
                                    const team = nextResource.trim() || null;
                                    const nextRole = team || phase;
                                    return { ...r, resourceTeam: team, role: nextRole };
                                  }));
                                }}
                                placeholder="resource (예: Core AI BE)"
                                className="text-xs border border-gray-300 rounded px-1.5 py-1 w-32 shrink-0"
                                style={{ background: "var(--bg-canvas)", color: "var(--text-primary)" }}
                                title="resource team — 자유 입력 (선택). 비우면 phase로만 표시"
                              />
                            );
                          })()}
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
                        {/* 상세 작업 (세부 task 명칭 + 담당자) */}
                        <div className="flex items-center gap-1.5 pl-1" style={{ borderLeft: "2px solid var(--border-2)" }}>
                          <span className="text-xs shrink-0" style={{ color: "var(--text-subtle)" }}>└</span>
                          <input
                            value={row.detail ?? ""}
                            onChange={(e) => updateRow(i, "detail", e.target.value)}
                            placeholder="상세 작업명 (선택)"
                            className="text-xs rounded px-1.5 py-1 flex-1 min-w-0" style={{ background: "var(--bg-canvas)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                          />
                          <input
                            value={row.detailPerson ?? ""}
                            onChange={(e) => updateRow(i, "detailPerson", e.target.value)}
                            placeholder="담당자 (선택)"
                            className="text-xs rounded px-1.5 py-1 w-20 shrink-0" style={{ background: "var(--bg-canvas)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                          />
                        </div>
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
                  <div className="flex justify-end items-center gap-2 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
                    <button onClick={saveEdit}
                      className="text-[12px] bg-indigo-600 text-white px-2.5 py-1 rounded-lg hover:bg-indigo-700 font-medium">저장</button>
                    <button onClick={() => { setEditMode(false); setEditError(null); }}
                      className="text-[12px] px-2 py-1 hover:opacity-80" style={{ color: "var(--text-muted)" }}>취소</button>
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
                          <div className="mb-2 flex items-center justify-between rounded-lg px-3 py-1.5" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
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
            </>) /* ─ ops: 작업별 일정 끝 ─ */}

            {/* Docs 탭 제거됨 — 2-Pager/PRD는 Overview 보조 정보에,
                Wiki 링크는 Overview 관련 문서 섹션에 통합됨. */}

            {/* ══════════════════════════════════════════
                Activity 탭: 변경 이력 타임라인 (현재 비노출 — partial audit log)
                TODO [ACTIVITY]: planning_updated/eta_changed 등 미연결 이벤트 보완 후 탭 복원.
                데이터(cc-activity-log KV)와 append 로직(hidden/unhidden/schedule_updated)은 유지 중.
                ══════════════════════════════════════════ */}
            {detailTab === "activity" && (
              <div className="p-0">
                {activityLoading ? (
                  <div className="flex items-center gap-2 text-[12px] py-4" style={{ color: "var(--text-muted)" }}>
                    <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    로딩 중...
                  </div>
                ) : activityLog.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-10">
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--text-subtle)" }}>
                      <path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>아직 기록된 활동이 없습니다</p>
                  </div>
                ) : (
                  <div className="space-y-0">
                    {activityLog.map(entry => (
                      <ActivityRow key={entry.id} entry={entry} />
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
          </div>}{/* !isDetailExpanded: overflow-y-auto 끝 */}
        </div>
      )}

      {/* ── KV 저장 상태 토스트 ── */}
      {kvSaveStatus !== "idle" && (
        <div
          className="fixed bottom-5 right-5 z-[100] flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium transition-all"
          style={{
            background: kvSaveStatus === "saved" ? "var(--bg-overlay)" : kvSaveStatus === "error" ? "#fee2e2" : "var(--bg-overlay)",
            border: `1px solid ${kvSaveStatus === "saved" ? "#34d399" : kvSaveStatus === "error" ? "#fca5a5" : "var(--border)"}`,
            color: kvSaveStatus === "saved" ? "#34d399" : kvSaveStatus === "error" ? "#dc2626" : "var(--text-muted)",
          }}
        >
          {kvSaveStatus === "saving" && (
            <>
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              저장 중…
            </>
          )}
          {kvSaveStatus === "saved" && (
            <>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              저장됨
            </>
          )}
          {kvSaveStatus === "error" && (
            <>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              저장 실패 — 다시 시도해주세요
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── ActivityRow 컴포넌트 ──────────────────────────────────────
function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const verbLabel: Record<string, string> = {
    eta_changed:        "ETA 변경",
    status_changed:     "상태 변경",
    hidden:             "숨김 처리",
    unhidden:           "숨김 해제",
    roadmap_linked:     "로드맵 연결",
    roadmap_unlinked:   "로드맵 연결 해제",
    schedule_updated:   "일정 업데이트",
    planning_updated:   "플래닝 업데이트",
    memo_updated:       "요약 업데이트",
    note_added:         "노트 추가",
  };
  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "방금 전";
    if (min < 60) return `${min}분 전`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 전`;
    return `${Math.floor(hr / 24)}일 전`;
  }
  return (
    <div className="flex items-start gap-2.5 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: "#818cf8" }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>
            {verbLabel[entry.verb] ?? entry.verb}
          </span>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{entry.actor}</span>
        </div>
        {entry.meta && (entry.meta.from !== undefined || entry.meta.to !== undefined) && (
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-subtle)" }}>
            {entry.meta.from !== undefined && <span>{String(entry.meta.from)}</span>}
            {entry.meta.from !== undefined && entry.meta.to !== undefined && <span className="mx-1">→</span>}
            {entry.meta.to !== undefined && <span>{String(entry.meta.to)}</span>}
          </p>
        )}
        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-subtle)" }}>{relativeTime(entry.at)}</p>
      </div>
    </div>
  );
}
