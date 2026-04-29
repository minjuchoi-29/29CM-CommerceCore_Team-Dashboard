"use client";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";

const JIRA_BASE = "https://jira.team.musinsa.com/browse/";

const STATUS_COLOR: Record<string, string> = {
  "론치완료": "bg-green-100 text-green-700",
  "완료": "bg-green-100 text-green-700",
  "배포완료": "bg-green-100 text-green-700",
  "개발중": "bg-blue-100 text-blue-700",
  "In Progress": "bg-blue-100 text-blue-700",
  "QA중": "bg-purple-100 text-purple-700",
  "디자인완료": "bg-purple-50 text-purple-500",
  "기획중": "bg-orange-100 text-orange-700",
  "기획완료": "bg-green-50 text-green-600",
  "SUGGESTED": "bg-gray-100 text-gray-500",
  "HOLD": "bg-yellow-100 text-yellow-700",
  "Postponed": "bg-yellow-100 text-yellow-700",
  "철회/반려/취소": "bg-red-100 text-red-600",
  "준비중": "bg-yellow-50 text-yellow-600",
  "디자인중": "bg-purple-50 text-purple-400",
  "Backlog": "bg-gray-100 text-gray-400",
};

const ROLE_COLOR: Record<string, string> = {
  "기획":    "bg-indigo-400",
  "디자인":  "bg-violet-400",
  "BE-SP":   "bg-blue-600",
  "BE-PP":   "bg-blue-400",
  "BE-CE":   "bg-blue-300",
  "FE-CFE":  "bg-cyan-500",
  "FE-DFE":  "bg-cyan-400",
  "Mobile":  "bg-teal-400",
  "QA":      "bg-emerald-500",
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
  status: "완료" | "진행중" | "예정";
  detail?: string;
  detailPerson?: string;
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
  "Initiative": "bg-indigo-100 text-indigo-700",
  "Epic":       "bg-violet-100 text-violet-600",
  "Dev":        "bg-gray-100 text-gray-500",
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
    const eMs = Math.min(viewEnd, new Date(e).getTime());
    return eMs <= sMs ? 0 : Math.max(0.3, ((eMs - sMs) / span) * 100);
  }
  return { pct, datePct, barLeft, barWidth };
}

function formatDateWithDay(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`;
}

function calcDuration(start: string, end: string): number {
  if (!start || !end) return 0;
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;
}

function GanttChart({ roles }: { roles?: RoleSchedule[] }) {
  // 뷰 시작: 이번 달 1일
  const viewStart = (() => {
    const d = new Date();
    d.setDate(1); d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();

  // 뷰 종료: roles 중 가장 먼 end 종료월 vs 현재월+2 중 큰 것
  const viewEnd = (() => {
    const minEnd = new Date();
    minEnd.setMonth(minEnd.getMonth() + 3);
    minEnd.setDate(0); // 3개월 후 말일 (현재월 포함 3개월)
    minEnd.setHours(23, 59, 59, 999);
    let ms = minEnd.getTime();
    for (const r of roles ?? []) {
      if (r.end) {
        const endMs = new Date(r.end).getTime();
        if (endMs > ms) {
          const d = new Date(r.end);
          d.setMonth(d.getMonth() + 1);
          d.setDate(0); // 해당 월 말일
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

  // 뷰 시작 이전에 완전히 끝난 바 개수
  const hiddenCount = (roles ?? []).filter(r => r.end && new Date(r.end).getTime() < viewStart).length;

  return (
    <div className="mt-3">
      {/* 월 헤더 */}
      <div className="flex mb-0.5">
        <div className="w-36 shrink-0" />
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
          <div className="w-36 shrink-0" />
          <div className="flex-1 relative h-6">
            <span
              className="absolute -translate-x-1/2"
              style={{ left: `${todayPct}%` }}
            >
              <span className="text-xs font-semibold text-red-500 whitespace-nowrap bg-red-50 border border-red-100 px-1.5 py-0.5 rounded">
                오늘 {TODAY_LABEL}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* 롤 바 목록 */}
      <div className="relative">
        {roles && roles.length > 0 ? roles.map((r) => {
          const endMs   = r.end   ? new Date(r.end).getTime()   : null;
          const startMs = r.start ? new Date(r.start).getTime() : null;
          const overdue   = endMs   !== null && endMs   < TODAY_MS && r.status !== "완료";
          const notStarted = startMs !== null && startMs < TODAY_MS && r.status === "예정";
          return (
          <div key={`${r.role}-${r.person}`} className="mb-2.5">
            <div className="flex items-center mb-0.5">
              <div className="w-36 shrink-0 flex items-center gap-1.5">
                <span className={`text-xs font-medium w-14 shrink-0 ${MILESTONE_ROLES.includes(r.role) ? "text-indigo-600 font-semibold" : "text-gray-600"}`}>{r.role}</span>
                <span className="text-xs text-gray-500 truncate">{r.person}</span>
              </div>
              <div className="flex-1 relative h-5 bg-gray-100 rounded-sm overflow-hidden">
                {/* 오늘 세로선 */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-red-400 z-10"
                  style={{ left: `${todayPct}%` }}
                />
                {barWidth(r.start, r.end) > 0 && (
                  <div
                    className={`absolute top-0.5 bottom-0.5 rounded-sm ${ROLE_COLOR[r.role] ?? "bg-gray-400"} ${r.status === "완료" ? "opacity-40" : r.status === "예정" ? "opacity-60" : ""}`}
                    style={{ left: `${barLeft(r.start)}%`, width: `${barWidth(r.start, r.end)}%` }}
                  />
                )}
              </div>
              <span className={`ml-2 text-xs w-10 shrink-0 ${r.status === "완료" ? "text-green-500" : r.status === "진행중" ? "text-blue-500" : "text-gray-400"}`}>
                {r.status}
              </span>
              {overdue && (
                <span className="relative ml-1 shrink-0 group">
                  <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-600 border border-red-200 cursor-default">
                    기한 초과
                  </span>
                  <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 w-40 rounded-lg bg-gray-900 text-white text-xs px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 whitespace-normal text-center">
                    종료일이 지났으나 완료 처리되지 않았습니다
                    <span className="absolute top-full right-3 border-4 border-transparent border-t-gray-900" />
                  </span>
                </span>
              )}
              {!overdue && notStarted && (
                <span className="relative ml-1 shrink-0 group">
                  <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-600 border border-orange-200 cursor-default">
                    시작 확인
                  </span>
                  <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 w-40 rounded-lg bg-gray-900 text-white text-xs px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 whitespace-normal text-center">
                    시작일이 지났으나 아직 예정 상태입니다
                    <span className="absolute top-full right-3 border-4 border-transparent border-t-gray-900" />
                  </span>
                </span>
              )}
            </div>
            {r.detail && (
              <div className="flex items-center mt-0.5">
                <div className="w-36 shrink-0 flex items-center gap-1 pl-1">
                  <span className="text-gray-300 text-xs">└</span>
                  <span className="text-xs text-gray-500 truncate">{r.detail}</span>
                  {r.detailPerson && (
                    <span className="text-xs text-gray-400 truncate">· {r.detailPerson}</span>
                  )}
                </div>
              </div>
            )}
            {r.start && r.end && (
              <div className="flex items-center">
                <div className="w-36 shrink-0" />
                <span className="text-xs text-gray-500">
                  {formatDateWithDay(r.start)} ~ {formatDateWithDay(r.end)}
                  <span className="ml-1.5 text-gray-400">({calcDuration(r.start, r.end)}일)</span>
                </span>
              </div>
            )}
          </div>
          );
        }) : (
          <div className="flex items-center">
            <div className="w-36 shrink-0" />
            <p className="text-xs text-gray-500 py-2">일정 데이터 없음 — 작업별 일정 입력 시 표시됩니다</p>
          </div>
        )}
      </div>

      {hiddenCount > 0 && (
        <p className="mt-2 text-xs text-gray-400">{hiddenCount}건의 완료된 이전 일정이 있습니다</p>
      )}
    </div>
  );
}

const MILESTONE_ROLES = ["Kick-Off", "Release", "Launch"];
const PRESET_ROLES = ["기획", "디자인", "BE-SP", "BE-PP", "BE-CE", "BE-메가존", "FE-CFE", "FE-DFE", "FE-Sotatek", "Mobile", "QA"];
const ALL_PRESET_ROLES = [...MILESTONE_ROLES, ...PRESET_ROLES];

function isCustomRole(role: string) {
  return !ALL_PRESET_ROLES.includes(role);
}
const STATUS_OPTIONS: RoleSchedule["status"][] = ["예정", "진행중", "완료"];

function newRow(): RoleSchedule {
  return { role: "기획", person: "", start: "", end: "", status: "예정" };
}

type EtrTicketInfo = {
  key: string;
  summary?: string;
  requestDept?: string;
};

type TicketRequestInfo = {
  source: "자체발의" | "ELT" | "ETR";
  etrStatus?: "추가완료" | "추가필요";
  etrTickets?: EtrTicketInfo[];
};

type TrackState = "대기중" | "검토중" | "완료";
const TRACK_STATES: TrackState[] = ["대기중", "검토중", "완료"];

function getPlanningVal(val: unknown): { design: TrackState; dev: TrackState } {
  if (!val || typeof val === "string") return { design: "대기중", dev: "대기중" };
  const v = val as Record<string, string>;
  return { design: (v.design as TrackState) ?? "대기중", dev: (v.dev as TrackState) ?? "대기중" };
}

function HealthBadge({ value }: { value: string }) {
  const v = value.toLowerCase();
  const isGreen  = ["그린", "green", "정상", "good", "ok"].some(k => v.includes(k));
  const isYellow = ["옐로우", "yellow", "주의", "warning", "caution"].some(k => v.includes(k));
  const isRed    = ["레드", "red", "위험", "danger", "critical", "bad"].some(k => v.includes(k));
  const dotCls = isGreen ? "bg-green-500" : isYellow ? "bg-yellow-400" : isRed ? "bg-red-500" : "bg-gray-400";
  const badgeCls = isGreen
    ? "bg-green-50 text-green-700 border-green-200"
    : isYellow
    ? "bg-yellow-50 text-yellow-700 border-yellow-200"
    : isRed
    ? "bg-red-50 text-red-700 border-red-200"
    : "bg-gray-100 text-gray-600 border-gray-200";
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
  const [sidebarWidth, setSidebarWidth] = useState(480);

  // 시트 우선순위 (key → priority 문자열)
  const [priorities, setPriorities] = useState<Record<string, string>>({});
  const [priorityError, setPriorityError] = useState<string | null>(null);
  // 플래닝 상태 (key → { design: TrackState, dev: TrackState })
  const [planning, setPlanning]     = useState<Record<string, unknown>>({});
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
  const [sheetSyncMsg, setSheetSyncMsg] = useState<string | null>(null);

  // 정렬
  const [sortBy, setSortBy] = useState<"default" | "priority" | "startDate" | "eta">("default");
  const [statusTab, setStatusTab] = useState<"전체" | "완료" | "진행중" | "계획/대기">("전체");

  // 사용자 직접 추가 티켓 관리
  const [addKeyInput, setAddKeyInput]     = useState("");
  const [addKeyLoading, setAddKeyLoading] = useState(false);
  const [addKeyError, setAddKeyError]     = useState<string | null>(null);
  const [addKeyProgress, setAddKeyProgress] = useState<{ current: number; total: number } | null>(null);
  const [newlyAddedKeys, setNewlyAddedKeys] = useState<Set<string>>(new Set());
  const [duplicateKeys, setDuplicateKeys] = useState<Set<string>>(new Set());
  const [customKeys, setCustomKeys]       = useState<Set<string>>(new Set());
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
  const TICKET_CACHE_KEY = "cc-tickets-v1";
  const CACHE_MAX_MS = 12 * 60 * 60 * 1000; // 12시간

  // API에서 받은 데이터를 상태 + localStorage에 저장 (사용자 추가 티켓 병합)
  function applyApiData(data: { tickets: Ticket[]; fetchedAt?: string }) {
    const at = data.fetchedAt ? new Date(data.fetchedAt) : new Date();
    // localStorage에서 custom tickets 미리 읽기 (동기 작업)
    let localExtra: Ticket[] = [];
    try {
      const cr = localStorage.getItem("cc-custom-tickets");
      if (cr) localExtra = JSON.parse(cr);
    } catch {}
    setTickets(prev => {
      const jiraKeys = new Set(data.tickets.map(t => t.key));
      // KV에서 이미 로드된 custom tickets(prev에 있는 것) 우선 유지
      const existingExtra = prev.filter(t => !jiraKeys.has(t.key));
      const extraByKey = new Map<string, Ticket>(existingExtra.map(t => [t.key, t]));
      // localStorage에서 읽은 것도 병합 (KV에 없는 경우 fallback)
      for (const t of localExtra) if (!extraByKey.has(t.key) && !jiraKeys.has(t.key)) extraByKey.set(t.key, t);
      return [...data.tickets, ...extraByKey.values()];
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
          let localExtra: Ticket[] = [];
          try {
            const cr = localStorage.getItem("cc-custom-tickets");
            if (cr) localExtra = JSON.parse(cr);
          } catch {}
          setTickets(prev => {
            const jiraKeys = new Set(cached.tickets.map((t: Ticket) => t.key));
            const existingExtra = prev.filter(t => !jiraKeys.has(t.key));
            const extraByKey = new Map<string, Ticket>(existingExtra.map(t => [t.key, t]));
            for (const t of localExtra) if (!extraByKey.has(t.key) && !jiraKeys.has(t.key)) extraByKey.set(t.key, t);
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

      // cc-custom-tickets KV + localStorage 최신화
      fetch("/api/kv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "cc-custom-tickets", value: freshCustom }),
      }).catch(() => {});
      try {
        localStorage.setItem("cc-custom-tickets", JSON.stringify(freshCustom));
      } catch {}

      // 화면 반영 + cc-tickets-v1 갱신
      const at = data.fetchedAt ? new Date(data.fetchedAt) : new Date();
      setTickets([...(data.tickets as Ticket[]), ...freshCustom]);
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
        // localStorage 동기화 (오프라인 폴백용)
        try {
          localStorage.setItem("cc-custom-keys", JSON.stringify(newCustomKeysArr));
          localStorage.setItem("cc-custom-tickets", JSON.stringify(newCustomTickets));
        } catch {}
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
      try {
        localStorage.setItem("cc-custom-keys", JSON.stringify(newCustomKeysArr));
        localStorage.setItem("cc-custom-tickets", JSON.stringify(newCustomTickets));
      } catch {}

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

    setTickets(prev => prev.filter(t => t.key !== key));
    const newCustomKeys = new Set([...customKeys].filter(k => k !== key));
    setCustomKeys(newCustomKeys);
    if (selected?.key === key) { setSelected(null); setEditMode(false); }

    const newCustomKeysArr = [...newCustomKeys];
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
    // localStorage 동기화 (오프라인 폴백용)
    try {
      localStorage.setItem("cc-custom-keys", JSON.stringify(newCustomKeysArr));
      localStorage.setItem("cc-custom-tickets", JSON.stringify(newCustomTickets));
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
    fetch("/api/kv?keys=cc-planning,cc-schedules,cc-memos,cc-memos-v2,cc-custom-keys,cc-custom-tickets,cc-planning-notes,cc-ticket-notes,cc-etr,cc-agenda")
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
          try { localStorage.setItem("cc-planning-notes", JSON.stringify(data["cc-planning-notes"])); } catch {}
        }
        if (data["cc-ticket-notes"]) {
          setTicketNotes(data["cc-ticket-notes"]);
          try { localStorage.setItem("cc-ticket-notes", JSON.stringify(data["cc-ticket-notes"])); } catch {}
        }

        // custom keys: KV 우선, 없으면 localStorage 폴백
        const kvKeys: string[] = Array.isArray(data["cc-custom-keys"]) ? data["cc-custom-keys"] : [];
        if (kvKeys.length > 0) {
          setCustomKeys(new Set(kvKeys));
        } else {
          try {
            const local = localStorage.getItem("cc-custom-keys");
            if (local) {
              const parsed: string[] = JSON.parse(local);
              setCustomKeys(new Set(parsed));
              if (parsed.length > 0) {
                fetch("/api/kv", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "cc-custom-keys", value: parsed }),
                }).catch(() => {});
              }
            }
          } catch {}
        }

        // custom tickets: KV 우선, 없으면 localStorage 폴백
        const kvTickets: Ticket[] = Array.isArray(data["cc-custom-tickets"]) ? data["cc-custom-tickets"] : [];
        if (kvTickets.length > 0) {
          setTickets(prev => {
            const jiraKeys = new Set(prev.map(t => t.key));
            const extra = kvTickets.filter(t => !jiraKeys.has(t.key));
            return extra.length > 0 ? [...prev, ...extra] : prev;
          });
        } else {
          try {
            const local = localStorage.getItem("cc-custom-tickets");
            if (local) {
              const parsed: Ticket[] = JSON.parse(local);
              if (parsed.length > 0) {
                setTickets(prev => {
                  const jiraKeys = new Set(prev.map(t => t.key));
                  const extra = parsed.filter(t => !jiraKeys.has(t.key));
                  return extra.length > 0 ? [...prev, ...extra] : prev;
                });
                fetch("/api/kv", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "cc-custom-tickets", value: parsed }),
                }).catch(() => {});
              }
            }
          } catch {}
        }
        setKvLoaded(true);
      })
      .catch(() => {
        setKvLoaded(true);
        try {
          const p = localStorage.getItem("cc-planning");
          if (p) setPlanning(JSON.parse(p));
          const s = localStorage.getItem("cc-schedules");
          if (s) setSchedules(JSON.parse(s));
          const m = localStorage.getItem("cc-memos");
          if (m) setMemos(JSON.parse(m));
          const mv2 = localStorage.getItem("cc-memos-v2");
          if (mv2) setMemoHistory(JSON.parse(mv2));
          const n = localStorage.getItem("cc-planning-notes");
          if (n) setPlanningNotes(JSON.parse(n));
          const tn = localStorage.getItem("cc-ticket-notes");
          if (tn) setTicketNotes(JSON.parse(tn));
          const etr = localStorage.getItem("cc-etr");
          if (etr) setEtrMap(JSON.parse(etr));
          const ck = localStorage.getItem("cc-custom-keys");
          if (ck) setCustomKeys(new Set(JSON.parse(ck)));
          const ct = localStorage.getItem("cc-custom-tickets");
          if (ct) {
            const parsed: Ticket[] = JSON.parse(ct);
            setTickets(prev => {
              const jiraKeys = new Set(prev.map(t => t.key));
              const extra = parsed.filter(t => !jiraKeys.has(t.key));
              return extra.length > 0 ? [...prev, ...extra] : prev;
            });
          }
        } catch {}
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

  function startEdit() {
    if (!selected) return;
    setEditRows(getRoles(selected).length > 0
      ? getRoles(selected).map(r => ({ ...r }))
      : [newRow()]
    );
    setEditMode(true);
  }

  function saveEdit() {
    if (!selected) return;
    const invalid = editRows.find(r => !r.role || !r.person || !r.start || !r.end);
    if (invalid) {
      const missing: string[] = [];
      if (!invalid.role)   missing.push("작업명");
      if (!invalid.person) missing.push("담당자명");
      if (!invalid.start)  missing.push("시작일");
      if (!invalid.end)    missing.push("종료일");
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

  const PLANNING_DONE_STATUSES = new Set(["론치완료", "완료", "배포완료"]);
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
    const counts: Record<string, number> = { "전체": dedupedTickets.length, "진행 중": 0, "플래닝 대기·검토": 0, "완료": 0 };
    for (const t of dedupedTickets) {
      const p = getPlanningVal(planning[t.key]);
      const bothDone = p.design === "완료" && p.dev === "완료";
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
      if (planningTab !== "전체") {
        const p = getPlanningVal(planning[t.key]);
        const bothDone = p.design === "완료" && p.dev === "완료";
        const isTicketDone = PLANNING_DONE_STATUSES.has(t.status);
        const isJiraActive = PLANNING_ACTIVE_STATUSES.has(t.status);
        if (planningTab === "진행 중" && !((bothDone || isJiraActive) && !isTicketDone)) return false;
        if (planningTab === "플래닝 대기·검토" && (bothDone || isJiraActive)) return false;
        if (planningTab === "완료" && !isTicketDone) return false;
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

  const done       = preFiltered.filter((t) => DONE_STATUSES.includes(t.status)).length;
  const inProgress = preFiltered.filter((t) => INPROGRESS_STATUSES.includes(t.status)).length;
  const planned    = preFiltered.filter((t) => PLANNED_STATUSES.includes(t.status)).length;

  // statusTab + 정렬 적용 (렌더용)
  const filtered = useMemo(() => {
    const result = statusTab === "전체" ? [...preFiltered]
      : statusTab === "완료"     ? preFiltered.filter((t) => DONE_STATUSES.includes(t.status))
      : statusTab === "진행중"   ? preFiltered.filter((t) => INPROGRESS_STATUSES.includes(t.status))
      :                            preFiltered.filter((t) => PLANNED_STATUSES.includes(t.status));
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
  }, [preFiltered, statusTab, sortBy, priorities]); // eslint-disable-line react-hooks/exhaustive-deps

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
    try { localStorage.setItem("cc-planning-notes", JSON.stringify(updated)); } catch {}
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
    try { localStorage.setItem("cc-ticket-notes", JSON.stringify(updated)); } catch {}
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
    try { localStorage.setItem("cc-etr", JSON.stringify(updated)); } catch {}
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
        ? { key: trimmed, summary: data.ticket.summary, requestDept: data.ticket.requestDept }
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

  function handleSelect(t: Ticket) {
    const isSame = selected?.key === t.key;
    setSelected(isSame ? null : t);
    setEditMode(false);
    setMemoEditMode(false);
    setMemoCollapsed(true);
    setMemoHistoryOpen(false);
    setRegenError(null);
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
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <svg className="w-8 h-8 animate-spin text-indigo-400 mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <p className="text-sm text-gray-400">JIRA에서 티켓 불러오는 중…</p>
          <p className="text-xs text-gray-300 mt-1">응답 없으면 20초 후 자동 종료됩니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex bg-gray-50 min-h-screen">
      {/* ── 리스트 패널 ── */}
      <div className="flex-1 min-w-0 px-6 py-8">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">전체 과제 현황</h2>
            <p className="text-sm text-gray-400 mt-0.5">Sub Group: 29CM-P Commerce Core</p>
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
            <button
              onClick={forceRefresh}
              disabled={fetching}
              title="JIRA에서 즉시 재동기화 (서버 캐시 초기화)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <svg className={`w-3 h-3 ${fetching ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {fetching ? "Syncing…" : "Jira Sync"}
            </button>
          </div>
        </div>
        {fetchError && (
          <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 font-mono break-all">
            {fetchError}
          </div>
        )}

        {/* 과제 상태 탭 */}
        <div className="flex gap-1.5 mb-5">
          {([
            { key: "전체",           label: "전체",           desc: "모든 과제",                   activeCls: "bg-gray-800 text-white",   inactiveCls: "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50" },
            { key: "진행 중",        label: "진행 중",        desc: "플래닝 완료 · 진행 중",        activeCls: "bg-blue-600 text-white",   inactiveCls: "bg-white border border-blue-200 text-blue-600 hover:bg-blue-50" },
            { key: "플래닝 대기·검토", label: "플래닝 대기·검토", desc: "플래닝 대기 또는 검토 중", activeCls: "bg-amber-500 text-white",   inactiveCls: "bg-white border border-amber-200 text-amber-600 hover:bg-amber-50" },
            { key: "완료",           label: "완료",           desc: "론치·배포 완료",               activeCls: "bg-green-600 text-white",  inactiveCls: "bg-white border border-green-200 text-green-600 hover:bg-green-50" },
          ] as const).map(({ key, label, desc, activeCls, inactiveCls }) => {
            const active = planningTab === key;
            return (
              <button
                key={key}
                onClick={() => setPlanningTab(key)}
                title={desc}
                className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-semibold transition-all shadow-sm ${active ? activeCls : inactiveCls}`}
              >
                {label}
                <span className={`ml-1.5 text-xs font-normal ${active ? "opacity-80" : "opacity-60"}`}>
                  ({planningCounts[key] ?? 0})
                </span>
              </button>
            );
          })}
        </div>

        {/* 아젠다 미팅 서브 뷰 토글 */}
        {agenda.size > 0 && (
          <div className="flex items-center gap-2 mb-4 p-2.5 bg-orange-50 border border-orange-200 rounded-xl">
            <span className="text-xs text-orange-600 font-medium mr-1">미팅 모드:</span>
            <button
              onClick={() => setAgendaView(false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${!agendaView ? "bg-orange-500 text-white shadow-sm" : "bg-white border border-orange-200 text-orange-600 hover:bg-orange-50"}`}
            >
              플래닝 현황
            </button>
            <button
              onClick={() => setAgendaView(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${agendaView ? "bg-orange-500 text-white shadow-sm" : "bg-white border border-orange-200 text-orange-600 hover:bg-orange-50"}`}
            >
              🗓 아젠다 미팅
              <span className="ml-1 opacity-80">({agenda.size})</span>
            </button>
            {agendaView && (
              <button
                onClick={() => { saveAgenda(new Set()); setAgendaView(false); }}
                className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-red-200 text-red-500 hover:bg-red-50 transition-all"
              >
                미팅 종료 ✕
              </button>
            )}
          </div>
        )}

        {/* 요약 카드 */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {([
            { label: "전체",      count: preFiltered.length, numColor: "text-gray-900",  ring: "ring-gray-400"  },
            { label: "완료",      count: done,               numColor: "text-green-600", ring: "ring-green-400" },
            { label: "진행중",    count: inProgress,         numColor: "text-blue-600",  ring: "ring-blue-400"  },
            { label: "계획/대기", count: planned,            numColor: "text-gray-400",  ring: "ring-gray-300"  },
          ] as const).map((s) => {
            const active = statusTab === s.label;
            return (
              <button
                key={s.label}
                onClick={() => setStatusTab(active ? "전체" : s.label)}
                className={`bg-white rounded-xl border px-4 py-3 text-left transition-all ${active ? `border-transparent ring-2 ${s.ring}` : "border-gray-200 hover:border-gray-300"}`}
              >
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className={`text-2xl font-bold mt-1 ${s.numColor}`}>{s.count}</p>
              </button>
            );
          })}
        </div>

        {/* 필터 */}
        <div className="flex flex-col gap-2 mb-4">
          {[
            { label: "분기",    items: ALL_QUARTERS, state: quarters,     setState: setQuarters,     activeColor: "bg-indigo-600 text-white" },
            { label: "레벨",    items: ALL_LEVELS,   state: levels,       setState: setLevels,       activeColor: "bg-violet-600 text-white" },
            { label: "프로젝트", items: ALL_PROJECTS, state: projects,    setState: setProjects,     activeColor: "bg-gray-800 text-white" },
            { label: "상태",    items: ALL_STATUSES, state: statuses,     setState: setStatuses,     activeColor: "bg-blue-600 text-white" },
            { label: "담당자",  items: allAssignees,  state: assigneeFilter, setState: setAssigneeFilter, activeColor: "bg-pink-600 text-white" },
            { label: "도메인",  items: allDomains,   state: domainFilter,   setState: setDomainFilter,   activeColor: "bg-teal-600 text-white" },
            { label: "대상",    items: allTargets,   state: targetFilter,   setState: setTargetFilter,   activeColor: "bg-violet-600 text-white" },
          ].map(({ label, items, state, setState, activeColor }) => (
            <div key={label} className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-500 w-14 shrink-0">{label}</span>
              <button
                onClick={() => setState(new Set())}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${state.size === 0 ? activeColor : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"}`}
              >전체</button>
              {items.map((v) => (
                <button key={v} onClick={() => setState((p) => toggle(p, v))}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${state.has(v) ? activeColor : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}
                >{v}</button>
              ))}
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 w-14 shrink-0">정렬</span>
            {([
              { key: "default",   label: "기본",         color: "bg-gray-800" },
              { key: "priority",  label: "우선순위 P1↑",  color: "bg-amber-500" },
              { key: "startDate", label: "시작일순",      color: "bg-gray-800" },
              { key: "eta",       label: "ETA순",         color: "bg-gray-800" },
            ] as const).map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${sortBy === key ? `${color} text-white` : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"}`}
              >{label}</button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 w-14 shrink-0">검색</span>
            <input
              type="text"
              placeholder="티켓 번호 · 제목 · 담당자"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300 w-64"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-500 w-14 shrink-0">티켓 추가</span>
            <input
              type="text"
              placeholder="예: TM-1234, TM-5678 (쉼표/공백으로 여러 개 입력)"
              value={addKeyInput}
              onChange={(e) => { setAddKeyInput(e.target.value.toUpperCase()); setAddKeyError(null); }}
              onKeyDown={(e) => e.key === "Enter" && addTickets(addKeyInput)}
              className="border border-gray-200 rounded-lg px-3 py-1 text-sm font-mono text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 w-80"
            />
            <button
              onClick={() => addTickets(addKeyInput)}
              disabled={addKeyLoading || !addKeyInput.trim()}
              className="px-3 py-1 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {addKeyLoading
                ? addKeyProgress
                  ? `${addKeyProgress.current}/${addKeyProgress.total} 추가 중…`
                  : "추가 중…"
                : "추가"}
            </button>
            {addKeyError && (
              <span className="text-xs text-red-500">{addKeyError}</span>
            )}
          </div>
        </div>

        {/* 아젠다 미팅 뷰 */}
        {agendaView && (
          <div className="bg-white rounded-xl border border-orange-200 overflow-hidden mb-4">
            <div className="px-4 py-3 bg-orange-50 border-b border-orange-200 flex items-center gap-2">
              <span className="text-sm font-bold text-orange-700">🗓 아젠다 미팅</span>
              <span className="text-xs text-orange-500">— 논의할 티켓을 순서대로 확인하고 플래닝 상태를 업데이트하세요</span>
            </div>
            {tickets.filter(t => agenda.has(t.key)).length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">아젠다에 등록된 티켓이 없습니다.</div>
            ) : (
              tickets.filter(t => agenda.has(t.key)).map((t, idx) => {
                const p = getPlanningVal(planning[t.key]);
                const isDiscussed = p.design === "완료" && p.dev === "완료";
                return (
                  <div key={t.key} className={`border-b border-orange-100 last:border-0 transition-colors ${isDiscussed ? "bg-green-50" : "bg-white"}`}>
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
                          <span className="text-sm font-medium text-gray-800 truncate">{t.summary}</span>
                          {isDiscussed && (
                            <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">논의 완료</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-xs text-gray-500">디자인</span>
                          <div className="flex gap-1">
                            {TRACK_STATES.map(s => (
                              <button
                                key={s}
                                onClick={() => savePlanning(t.key, "design", s)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${p.design === s
                                  ? s === "완료" ? "bg-green-500 text-white border-green-500" : s === "검토중" ? "bg-violet-500 text-white border-violet-500" : "bg-gray-500 text-white border-gray-500"
                                  : "bg-white text-gray-400 border-gray-200 hover:border-gray-400"}`}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                          <span className="text-xs text-gray-500 ml-2">개발</span>
                          <div className="flex gap-1">
                            {TRACK_STATES.map(s => (
                              <button
                                key={s}
                                onClick={() => savePlanning(t.key, "dev", s)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${p.dev === s
                                  ? s === "완료" ? "bg-green-500 text-white border-green-500" : s === "검토중" ? "bg-blue-500 text-white border-blue-500" : "bg-gray-500 text-white border-gray-500"
                                  : "bg-white text-gray-400 border-gray-200 hover:border-gray-400"}`}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                          <button
                            onClick={() => toggleAgenda(t.key)}
                            className="ml-auto shrink-0 text-xs text-gray-300 hover:text-orange-400 transition-colors"
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

        {/* 티켓 목록 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* 헤더 */}
          <div className="flex items-center px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-xs text-gray-600 font-semibold">
            <span className="w-6 shrink-0 text-center" title="아젠다 체크">🗓</span>
            <span className="w-8 shrink-0 text-center">#</span>
            <span className="w-32 shrink-0">티켓</span>
            <span className="flex-1 min-w-0">제목</span>
            <span className="w-20 shrink-0 text-center">레벨</span>
            <span className="w-16 shrink-0 text-center">프로젝트</span>
            <span className="w-20 shrink-0 text-center">담당자</span>
            <span className="w-28 shrink-0 text-center">상태</span>
            <span className="w-28 shrink-0 text-center">시작일</span>
            <span className="w-28 shrink-0 text-center">ETA</span>
            <span className="w-6 shrink-0" />
          </div>

          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">검색 결과가 없습니다.</div>
          ) : (
            filtered.map((t, idx) => {
              const isSelected = selected?.key === t.key;
              const isNew = newlyAddedKeys.has(t.key);
              const isDuplicate = duplicateKeys.has(t.key);
              const tp = getPlanningVal(planning[t.key]);
              const planningComplete = tp.design === "완료" && tp.dev === "완료";
              const ticketDone = ["론치완료", "완료", "배포완료"].includes(t.status);
              const showAgenda = !planningComplete && !ticketDone;
              return (
                <div
                  key={t.key}
                  data-ticket-key={t.key}
                  className={`border-b border-gray-100 last:border-0 transition-colors duration-700 ${isSelected ? "bg-indigo-50" : isNew ? "bg-emerald-50" : isDuplicate ? "bg-amber-50 ring-1 ring-inset ring-amber-200" : "hover:bg-gray-50"}`}
                >
                  {/* 메인 행 */}
                  <div
                    className="flex items-center px-4 py-3 cursor-pointer"
                    onClick={() => handleSelect(t)}
                  >
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
                    <span className="w-8 shrink-0 text-center text-xs text-gray-300 font-mono">{idx + 1}</span>
                    <a
                      href={`${JIRA_BASE}${t.key}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="w-32 shrink-0 font-mono text-xs text-blue-500 hover:underline"
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
                    {(() => {
                      const p = getPlanningVal(planning[t.key]);
                      const designDone = p.design === "완료";
                      const devDone = p.dev === "완료";
                      if (designDone && devDone) return null;
                      return (
                        <span className="shrink-0 mr-1.5 flex items-center gap-1">
                          {!designDone && (
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${p.design === "검토중" ? "bg-violet-100 text-violet-600 border-violet-200" : "bg-gray-100 text-gray-500 border-gray-200"}`}>
                              Design{p.design === "검토중" ? " 검토" : " 대기"}
                            </span>
                          )}
                          {!devDone && (
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${p.dev === "검토중" ? "bg-blue-100 text-blue-600 border-blue-200" : "bg-gray-100 text-gray-500 border-gray-200"}`}>
                              Dev{p.dev === "검토중" ? " 검토" : " 대기"}
                            </span>
                          )}
                        </span>
                      );
                    })()}
                    <span className="flex-1 min-w-0 text-sm text-gray-800 truncate pr-3">{t.summary}</span>
                    <span className="w-20 shrink-0 flex justify-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${TYPE_COLOR[t.type] ?? "bg-gray-100 text-gray-500"}`}>
                        {t.type}
                      </span>
                    </span>
                    <span className="w-16 shrink-0 text-xs text-gray-500 text-center">{t.project}</span>
                    <span className="w-20 shrink-0 text-sm font-semibold text-gray-900 text-center truncate">{t.assignee}</span>
                    <span className="w-28 shrink-0 flex justify-center">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-sm font-semibold ${STATUS_COLOR[t.status] ?? "bg-gray-100 text-gray-500"}`}>
                        {t.status}
                      </span>
                    </span>
                    <span className={`w-28 shrink-0 text-sm font-medium text-center ${t.startDate ? "text-gray-900" : "text-gray-300"}`}>
                      {t.startDate ? formatDateWithDay(t.startDate) : "미정"}
                    </span>
                    <span className={`w-28 shrink-0 text-sm font-medium text-center ${!t.eta || t.eta === "-" ? "text-gray-300" : "text-gray-900"}`}>
                      {!t.eta || t.eta === "-" ? "미정" : formatDateWithDay(t.eta)}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeTicket(t.key); }}
                      title="목록에서 제거"
                      className="w-6 shrink-0 flex justify-center items-center text-gray-300 hover:text-red-400 transition-colors"
                    >×</button>
                  </div>

                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── 우측 상세 패널 ── */}
      {selected && (
        <div className="shrink-0 sticky top-0 h-screen overflow-y-auto border-l border-gray-200 bg-white relative" style={{ width: sidebarWidth }}>
          {/* 드래그 핸들 */}
          <div
            onMouseDown={isResizing}
            className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-indigo-300 active:bg-indigo-400 transition-colors z-10"
          />
          <div className="p-5">
            {/* 헤더 */}
            <div className="flex justify-between items-start mb-4">
              <div className="flex-1 pr-2">
                <h3 className="text-base font-bold text-gray-900 leading-snug">{selected.summary}</h3>
                {(() => {
                  const p = getPlanningVal(planning[selected.key]);
                  const designDone = p.design === "완료";
                  const devDone = p.dev === "완료";
                  if (designDone && devDone) return null;
                  return (
                    <div className="flex gap-1 mt-1.5">
                      {!designDone && (
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${p.design === "검토중" ? "bg-violet-100 text-violet-600 border-violet-200" : "bg-gray-100 text-gray-500 border-gray-200"}`}>
                          Design{p.design === "검토중" ? " 검토" : " 대기"}
                        </span>
                      )}
                      {!devDone && (
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${p.dev === "검토중" ? "bg-blue-100 text-blue-600 border-blue-200" : "bg-gray-100 text-gray-500 border-gray-200"}`}>
                          Dev{p.dev === "검토중" ? " 검토" : " 대기"}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
              <button
                onClick={() => { setSelected(null); setEditMode(false); }}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none shrink-0"
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
                    <span className="text-gray-500">{label} </span>
                    <span className="text-gray-700 font-medium">{value || "-"}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 추가 메타 정보 */}
            <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5 mb-4 space-y-1.5 text-sm">
              {[
                { label: "Main Subject",  value: selected.requestDept },
                { label: "요청부문",      value: selected.bodyRequestDept },
                { label: "요청 우선순위", value: selected.requestPriority },
                { label: "Story Points",  value: selected.storyPoints?.toString() },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-1">
                  <span className="text-gray-500 w-28 shrink-0">{label}</span>
                  <span className="text-gray-700 font-medium">{value || <span className="text-gray-300">-</span>}</span>
                </div>
              ))}
              <div className="flex items-center gap-1">
                <span className="text-gray-500 w-28 shrink-0">상위 항목</span>
                {selected.parent
                  ? <a href={`${JIRA_BASE}${selected.parent}`} target="_blank" rel="noopener noreferrer"
                      className="font-mono text-blue-500 hover:underline">{selected.parent}</a>
                  : <span className="text-gray-300">-</span>
                }
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-500 w-28 shrink-0">Health Check</span>
                {selected.healthCheck
                  ? <HealthBadge value={selected.healthCheck} />
                  : <span className="text-gray-300">-</span>
                }
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-500 w-28 shrink-0">2-Pager</span>
                {selected.twoPagerUrl
                  ? <a href={selected.twoPagerUrl} target="_blank" rel="noopener noreferrer"
                      className="text-blue-500 hover:underline truncate">링크 열기</a>
                  : <span className="text-gray-300">-</span>
                }
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-500 w-28 shrink-0">PRD Link</span>
                {selected.prdUrl
                  ? <a href={selected.prdUrl} target="_blank" rel="noopener noreferrer"
                      className="text-blue-500 hover:underline truncate">링크 열기</a>
                  : <span className="text-gray-300">-</span>
                }
              </div>
            </div>

            {/* 요구사항 출처 */}
            <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5 mb-4 text-xs">
              <p className="font-semibold text-gray-500 uppercase tracking-wide mb-2">요구사항 출처</p>

              {/* 출처 선택 */}
              <div className="flex gap-1.5 mb-3">
                {(["자체발의", "ELT", "ETR"] as const).map(src => {
                  const active = etrMap[selected.key]?.source === src;
                  const activeColor =
                    src === "자체발의" ? "bg-indigo-600 text-white border-indigo-600" :
                    src === "ELT"     ? "bg-amber-500 text-white border-amber-500" :
                                        "bg-blue-600 text-white border-blue-600";
                  const label =
                    src === "자체발의" ? "자체발의" :
                    src === "ELT"     ? "ELT 요구사항" :
                                        "외부 부서 요청";
                  return (
                    <button
                      key={src}
                      onClick={() => setEtrSource(selected.key, src)}
                      className={`flex-1 py-1.5 px-2 rounded-lg font-medium border transition-colors ${active ? activeColor : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"}`}
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
                      {(etrMap[selected.key]?.etrTickets ?? []).map(t => (
                        <div key={t.key} className="flex items-start gap-2 bg-white border border-gray-200 rounded px-2 py-1.5">
                          <a
                            href={`${JIRA_BASE}${t.key}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-blue-500 hover:underline shrink-0 mt-0.5"
                          >{t.key}</a>
                          <div className="flex-1 min-w-0">
                            {t.requestDept && (
                              <span className="inline-block text-gray-400 mr-1">[{t.requestDept}]</span>
                            )}
                            {t.summary && (
                              <span className="text-gray-600 break-words">{t.summary}</span>
                            )}
                            {!t.requestDept && !t.summary && (
                              <span className="text-gray-300 italic">정보 없음</span>
                            )}
                          </div>
                          <button
                            onClick={() => removeEtr(selected.key, t.key)}
                            className="text-gray-300 hover:text-red-400 transition-colors shrink-0 mt-0.5"
                          >×</button>
                        </div>
                      ))}
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
                      className="flex-1 border border-gray-200 rounded px-2 py-1 font-mono text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
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
            </div>

            <div className="border-t border-gray-200 pt-4">
              {/* 메모 */}
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">메모</p>

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
                        <div key={gi} className="border border-gray-100 rounded-lg overflow-hidden">
                          <div className="flex items-center justify-between bg-gray-50 px-3 py-1.5 border-b border-gray-100">
                            <span className="text-xs font-medium text-gray-600">{g.author}</span>
                            <span className="text-xs text-gray-400">{g.date}</span>
                          </div>
                          <div className="divide-y divide-gray-50">
                            {g.items.map(({ text, idx }) => (
                              <div key={idx} className="group flex items-start gap-2 px-3 py-2">
                                <p className="flex-1 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{text}</p>
                                <button
                                  onClick={() => deleteTicketNote(selected.key, idx)}
                                  className="shrink-0 text-gray-300 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
                                >삭제</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })() : (
                  <p className="text-xs text-gray-300 italic mb-2">등록된 메모가 없습니다</p>
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
                    className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
                  />
                  <button
                    onClick={() => { addTicketNote(selected.key, ticketNoteInput); setTicketNoteInput(""); }}
                    disabled={!ticketNoteInput.trim()}
                    className="self-end text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
                  >등록</button>
                </div>
              </div>

              {/* 주요 내용 요약 */}
              <div className="mb-4">
                {/* 헤더 */}
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">주요 내용 요약</p>
                  <div className="flex items-center gap-2">
                    {/* AI 재생성 버튼 */}
                    {!memoEditMode && (
                      <button
                        onClick={() => regenerateSummary(selected.key)}
                        disabled={summaryLoading.has(selected.key)}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-500 disabled:opacity-40 transition-colors"
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
                          className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">취소</button>
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
                    className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
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
                          <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-lg px-3 py-2.5 mb-1">
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
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                              {cur.isAI && <span className="px-1 py-0.5 rounded bg-indigo-50 text-indigo-400 border border-indigo-100">AI</span>}
                              {cur.author}{cur.date ? ` · ${cur.date}` : ""}
                            </span>
                            {(memoHistory[selected.key]?.length ?? 0) > 1 && (
                              <button
                                onClick={() => setMemoHistoryOpen(o => !o)}
                                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
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
                      <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                        <p className="text-xs text-gray-400 font-medium mb-1.5">이전 버전</p>
                        {[...(memoHistory[selected.key] ?? [])].reverse().slice(1).map((v, i) => (
                          <div key={i} className="border border-gray-100 rounded-lg overflow-visible opacity-70">
                            <div className="flex items-center justify-between bg-gray-50 px-3 py-1.5 rounded-t-lg border-b border-gray-100">
                              <span className="text-xs text-gray-500 flex items-center gap-1">
                                {v.isAI && <span className="px-1 py-0.5 rounded bg-indigo-50 text-indigo-400 text-xs">AI</span>}
                                {v.author}
                              </span>
                              <span className="text-xs text-gray-400">{v.date}</span>
                            </div>
                            <div className="text-sm text-gray-500 whitespace-pre-wrap leading-relaxed px-3 py-2">{v.text}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-gray-300 italic">입력된 내용이 없습니다</p>
                )}
              </div>

              {/* 플래닝 상태 */}
              <div className="border-t border-gray-100 pt-4 mb-4">
                <button
                  onClick={() => setPlanningOpen(o => !o)}
                  className="flex items-center justify-between w-full mb-2 group"
                >
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">플래닝 상태</p>
                    {(() => {
                      const p = getPlanningVal(planning[selected.key]);
                      const allDone = p.design === "완료" && p.dev === "완료";
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
                    className={`w-3.5 h-3.5 text-gray-400 transition-transform ${planningOpen ? "rotate-180" : ""}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  >
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>

                {planningOpen && (
                  <>
                <div className="space-y-1.5">
                  {(["design", "dev"] as const).map((track) => {
                    const p = getPlanningVal(planning[selected.key]);
                    const current = p[track];
                    const label = track === "design" ? "Design" : "Dev";
                    return (
                      <div key={track} className="flex items-center gap-1.5">
                        <span className={`text-sm font-medium w-12 shrink-0 ${track === "design" ? "text-violet-600" : "text-blue-600"}`}>{label}</span>
                        {TRACK_STATES.map((s) => {
                          const active = current === s;
                          const activeClass =
                            s === "완료"   ? "bg-green-600 text-white border-green-600" :
                            s === "검토중" ? (track === "design" ? "bg-violet-600 text-white border-violet-600" : "bg-blue-600 text-white border-blue-600") :
                                             "bg-gray-500 text-white border-gray-500";
                          return (
                            <button
                              key={s}
                              onClick={() => savePlanning(selected.key, track, s)}
                              className={`flex-1 py-1.5 px-2 rounded-lg text-sm font-medium border transition-colors ${active ? activeClass : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                            >{s}</button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* 플래닝 코멘트 */}
                <div className="mt-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">플래닝 코멘트</p>

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
                          <div key={gi} className="border border-gray-100 rounded-lg overflow-hidden">
                            <div className="flex items-center justify-between bg-gray-50 px-3 py-1.5 border-b border-gray-100">
                              <span className="text-xs font-medium text-gray-600">{g.author}</span>
                              <span className="text-xs text-gray-400">{g.date}</span>
                            </div>
                            <div className="divide-y divide-gray-50">
                              {g.items.map(({ text, idx }) => (
                                <div key={idx} className="group flex items-start gap-2 px-3 py-2">
                                  <p className="flex-1 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{text}</p>
                                  <button
                                    onClick={() => deletePlanningNote(selected.key, idx)}
                                    className="shrink-0 text-gray-300 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
                                  >삭제</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })() : (
                    <p className="text-xs text-gray-300 italic mb-2">등록된 코멘트가 없습니다</p>
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
                      className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
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

              <div className="border-t border-gray-200 pt-4">
              {/* 작업별 일정 헤더 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">작업별 일정</p>
                </div>
                {!editMode ? (
                  <button
                    onClick={startEdit}
                    className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                  >편집</button>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={saveEdit}
                      className="text-xs bg-indigo-600 text-white px-2.5 py-1 rounded-lg hover:bg-indigo-700 font-medium">저장</button>
                    <button onClick={() => { setEditMode(false); setEditError(null); }}
                      className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">취소</button>
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
                        onClick={startEdit}
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
                  {editRows.map((row, i) => {
                    const custom    = isCustomRole(row.role);
                    const errRole   = !!editError && !row.role;
                    const errPerson = !!editError && !row.person;
                    const errStart  = !!editError && !row.start;
                    const errEnd    = !!editError && !row.end;
                    const errBorder = "border-red-400";
                    const okBorder  = "border-gray-300";
                    return (
                      <div key={i} className="bg-gray-50 rounded-lg p-2.5 space-y-1.5">
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
                            className={`text-xs text-gray-900 border ${errRole ? errBorder : okBorder} rounded px-1.5 py-1 bg-white shrink-0 w-24`}
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
                              className={`text-xs text-gray-900 border ${errRole ? errBorder : okBorder} rounded px-1.5 py-1 w-24 shrink-0 placeholder:text-gray-500`}
                            />
                          )}
                          {/* 담당자 */}
                          <input
                            value={row.person}
                            onChange={(e) => { setEditError(null); updateRow(i, "person", e.target.value); }}
                            placeholder="담당자명"
                            className={`text-xs text-gray-900 border ${errPerson ? errBorder : okBorder} rounded px-1.5 py-1 flex-1 min-w-0 placeholder:text-gray-500`}
                          />
                          {/* 상태 */}
                          <select
                            value={row.status}
                            onChange={(e) => updateRow(i, "status", e.target.value as RoleSchedule["status"])}
                            className="text-xs text-gray-900 border border-gray-300 rounded px-1.5 py-1 bg-white w-16 shrink-0"
                          >
                            {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                          </select>
                          {/* 삭제 */}
                          <button onClick={() => { setEditError(null); setEditRows(prev => prev.filter((_, idx) => idx !== i)); }}
                            className="text-gray-300 hover:text-red-400 text-base leading-none shrink-0">×</button>
                        </div>
                        {/* 상세 작업 (프리셋 선택 시에만 표시) */}
                        {!custom && (
                          <div className="flex items-center gap-1.5 pl-1 border-l-2 border-gray-200">
                            <span className="text-gray-300 text-xs shrink-0">└</span>
                            <input
                              value={row.detail ?? ""}
                              onChange={(e) => updateRow(i, "detail", e.target.value)}
                              placeholder="상세 작업명 (선택)"
                              className="text-xs text-gray-900 border border-gray-200 rounded px-1.5 py-1 flex-1 min-w-0 placeholder:text-gray-400 bg-white"
                            />
                            <input
                              value={row.detailPerson ?? ""}
                              onChange={(e) => updateRow(i, "detailPerson", e.target.value)}
                              placeholder="담당자 (선택)"
                              className="text-xs text-gray-900 border border-gray-200 rounded px-1.5 py-1 w-20 shrink-0 placeholder:text-gray-400 bg-white"
                            />
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-500 w-6 shrink-0">시작</span>
                          <input
                            type="date"
                            value={row.start}
                            onChange={(e) => { setEditError(null); updateRow(i, "start", e.target.value); }}
                            className={`text-xs text-gray-900 border ${errStart ? errBorder : okBorder} rounded px-1.5 py-1 flex-1`}
                          />
                          <span className="text-xs text-gray-400 shrink-0">~</span>
                          <input
                            type="date"
                            value={row.end}
                            min={row.start || undefined}
                            onChange={(e) => { setEditError(null); updateRow(i, "end", e.target.value); }}
                            className={`text-xs text-gray-900 border ${errEnd ? errBorder : okBorder} rounded px-1.5 py-1 flex-1`}
                          />
                        </div>
                      </div>
                    );
                  })}
                  <button
                    onClick={() => setEditRows(prev => [...prev, newRow()])}
                    className="w-full text-xs text-gray-400 hover:text-gray-600 border border-dashed border-gray-200 rounded-lg py-1.5 hover:border-gray-300 transition-colors"
                  >+ 작업 추가</button>
                  {editError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{editError}</p>
                  )}
                </div>
              ) : (
                /* 뷰 모드: Gantt */
                <>
                  {getRoles(selected).length === 0 && (planning[selected.key] ?? "스프린트 대기중") === "플래닝 완료" && (
                    <p className="mb-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                      작업별 일정과 담당자를 입력해주세요.
                    </p>
                  )}
                  <GanttChart roles={getRoles(selected)} />
                </>
              )}
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
