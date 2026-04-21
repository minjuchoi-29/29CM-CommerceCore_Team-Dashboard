"use client";
import { useState, useMemo, useEffect, useCallback } from "react";

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
};

// Gantt 전체 범위: 2026-01-01 ~ 2026-06-30
const G_FULL_START = new Date("2026-01-01").getTime();
const G_END        = new Date("2026-06-30").getTime();

const MONTH_DATES = [
  { label: "1월", ms: new Date("2026-01-01").getTime() },
  { label: "2월", ms: new Date("2026-02-01").getTime() },
  { label: "3월", ms: new Date("2026-03-01").getTime() },
  { label: "4월", ms: new Date("2026-04-01").getTime() },
  { label: "5월", ms: new Date("2026-05-01").getTime() },
  { label: "6월", ms: new Date("2026-06-01").getTime() },
];

// 오늘 자정 기준 ms
const TODAY_MS = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
})();

// 기본 뷰: 오늘 기준 2주 전부터
const DEFAULT_VIEW_START = Math.max(G_FULL_START, TODAY_MS - 14 * 86400000);

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
const ALL_PROJECTS = ["TM", "CMALL", "M29CMCCF", "EF"];
const ALL_STATUSES = ["론치완료/완료", "개발중", "QA중", "SUGGESTED", "HOLD/Postponed", "기타"];
const ALL_LEVELS   = ["Initiative", "Epic", "Dev"];

function extractDomain(summary: string): string {
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

function makeViewFns(viewStart: number) {
  const span = G_END - viewStart;
  function pct(ms: number) {
    return Math.max(0, Math.min(100, ((ms - viewStart) / span) * 100));
  }
  function datePct(d: string) { return pct(new Date(d).getTime()); }
  function barLeft(s: string) { return pct(Math.max(viewStart, new Date(s).getTime())); }
  function barWidth(s: string, e: string) {
    const sMs = Math.max(viewStart, new Date(s).getTime());
    const eMs = Math.min(G_END, new Date(e).getTime());
    return eMs <= sMs ? 0 : Math.max(0.3, ((eMs - sMs) / span) * 100);
  }
  return { pct, datePct, barLeft, barWidth };
}

function formatDateWithDay(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`;
}

function calcDuration(start: string, end: string): number {
  if (!start || !end) return 0;
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;
}

function GanttChart({ roles }: { roles?: RoleSchedule[] }) {
  const [showFull, setShowFull] = useState(false);

  const viewStart = showFull ? G_FULL_START : DEFAULT_VIEW_START;
  const { pct, barLeft, barWidth } = makeViewFns(viewStart);
  const todayPct = pct(TODAY_MS);

  const visibleMonths = MONTH_DATES.filter(m => m.ms >= viewStart && m.ms <= G_END);

  // 뷰 밖(과거)에 완전히 잘린 바 개수
  const hiddenCount = (roles ?? []).filter(r => r.end && new Date(r.end).getTime() < viewStart).length;

  return (
    <div className="mt-3">
      {/* 월 헤더 */}
      <div className="flex mb-0.5">
        <div className="w-36 shrink-0" />
        <div className="flex-1 relative h-5">
          {visibleMonths.map((m) => (
            <span
              key={m.label}
              className="absolute text-xs text-gray-400 -translate-x-1/2"
              style={{ left: `${pct(m.ms)}%` }}
            >
              {m.label}
            </span>
          ))}
        </div>
      </div>

      {/* 오늘 날짜 레이블 — 월 헤더 아래 별도 행 */}
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
                <span className="text-xs font-medium text-gray-600 w-14 shrink-0">{r.role}</span>
                <span className="text-xs text-gray-400 truncate">{r.person}</span>
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
            {r.start && r.end && (
              <div className="flex items-center">
                <div className="w-36 shrink-0" />
                <span className="text-xs text-gray-400">
                  {formatDateWithDay(r.start)} ~ {formatDateWithDay(r.end)}
                  <span className="ml-1.5 text-gray-300">({calcDuration(r.start, r.end)}일)</span>
                </span>
              </div>
            )}
          </div>
          );
        }) : (
          <div className="flex items-center">
            <div className="w-36 shrink-0" />
            <p className="text-xs text-gray-400 py-2">일정 데이터 없음 — 작업별 일정 입력 시 표시됩니다</p>
          </div>
        )}
      </div>

      {/* 이전 일정 collapse 토글 */}
      <button
        onClick={() => setShowFull(v => !v)}
        className="mt-2 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {showFull
            ? <path d="M5 15l7-7 7 7" strokeLinecap="round" strokeLinejoin="round"/>
            : <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round"/>
          }
        </svg>
        {showFull
          ? "최근 일정으로 돌아가기"
          : `이전 일정 전체 보기${hiddenCount > 0 ? ` (${hiddenCount}건 숨김)` : ""}`
        }
      </button>
    </div>
  );
}

const PRESET_ROLES = ["기획", "디자인", "BE-SP", "BE-PP", "BE-CE", "BE-메가존", "FE-CFE", "FE-DFE", "FE-Sotatek", "Mobile", "QA"];

function isCustomRole(role: string) {
  return !PRESET_ROLES.includes(role);
}
const STATUS_OPTIONS: RoleSchedule["status"][] = ["예정", "진행중", "완료"];

function newRow(): RoleSchedule {
  return { role: "기획", person: "", start: "", end: "", status: "예정" };
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
  const [assigneeFilter, setAssigneeFilter] = useState<Set<string>>(new Set());
  const [search, setSearch]         = useState("");

  // localStorage 기반 일정 데이터
  const [schedules, setSchedules]   = useState<Record<string, RoleSchedule[]>>({});
  const [editMode, setEditMode]     = useState(false);
  const [editRows, setEditRows]     = useState<RoleSchedule[]>([]);
  const [editError, setEditError]   = useState<string | null>(null);

  // 주요 내용 요약 (작성자/날짜 포함)
  const [memos, setMemos]           = useState<Record<string, MemoEntry | string>>({});
  const [memoEditMode, setMemoEditMode] = useState(false);
  const [memoText, setMemoText]     = useState("");

  // AI 요약 생성 중인 티켓 키 집합
  const [summaryLoading, setSummaryLoading] = useState<Set<string>>(new Set());

  // 우측 사이드바 너비 (드래그 리사이즈)
  const [sidebarWidth, setSidebarWidth] = useState(380);

  // 시트 우선순위 (key → priority 문자열)
  const [priorities, setPriorities] = useState<Record<string, string>>({});
  // 플래닝 상태 (key → "스프린트 대기중" | "검토중" | "플래닝 완료", 기본값: "스프린트 대기중")
  const [planning, setPlanning]     = useState<Record<string, string>>({});
  const [planningTab, setPlanningTab] = useState("전체");
  // 플래닝 코멘트 (key → PlanningNote[])
  const [planningNotes, setPlanningNotes] = useState<Record<string, PlanningNote[]>>({});
  const [noteInput, setNoteInput]   = useState("");
  // 정렬
  const [sortBy, setSortBy] = useState<"default" | "priority" | "startDate" | "eta">("default");
  const [statusTab, setStatusTab] = useState<"전체" | "완료" | "진행중" | "계획/대기">("전체");

  // 사용자 직접 추가 티켓 관리
  const [addKeyInput, setAddKeyInput]     = useState("");
  const [addKeyLoading, setAddKeyLoading] = useState(false);
  const [addKeyError, setAddKeyError]     = useState<string | null>(null);
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
      for (const t of localExtra) if (!extraByKey.has(t.key)) extraByKey.set(t.key, t);
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
            for (const t of localExtra) if (!extraByKey.has(t.key)) extraByKey.set(t.key, t);
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

      // 시트 우선순위 + 공유 KV 데이터 (planning, schedules, memos) 함께 갱신
      fetch("/api/sheet-priorities")
        .then(r => r.json())
        .then(d => { if (d.priorities) setPriorities(d.priorities); })
        .catch(() => {});
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
    if (!/^[A-Z]+-\d+$/.test(trimmed)) {
      setAddKeyError("올바른 형식이 아닙니다. 예: TM-1234");
      return;
    }
    if (tickets.some(t => t.key === trimmed) || customKeys.has(trimmed)) {
      setAddKeyError("이미 등록된 티켓입니다.");
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

        // 메모가 없을 때만 AI 요약 1회 생성
        const hasMemo = !!memos[trimmed]?.text?.trim();
        if (!hasMemo) {
          setSummaryLoading(prev => new Set([...prev, trimmed]));
          fetch(`/api/ai-summary?key=${encodeURIComponent(trimmed)}`)
            .then(r => {
              console.log("[ai-summary] HTTP status:", r.status, r.statusText);
              return r.json();
            })
            .then(d => {
              console.log("[ai-summary] response body:", d);
              if (d.summary) {
                const entry: MemoEntry = {
                  text: d.summary,
                  author: "AI 자동 요약",
                  date: new Date().toISOString().slice(0, 10),
                };
                setMemos(prev => {
                  const updated = { ...prev, [trimmed]: entry };
                  fetch("/api/kv", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ key: "cc-memos", value: updated }),
                  }).catch(() => {});
                  return updated;
                });
              }
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

  // 사용자 추가 티켓 제거
  function removeTicket(key: string) {
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

  // 시트 우선순위 로드
  useEffect(() => {
    fetch("/api/sheet-priorities")
      .then(r => r.json())
      .then(d => { if (d.priorities) setPriorities(d.priorities); })
      .catch(() => {});
  }, []);

  // tickets 갱신 시 선택된 티켓도 최신 데이터로 동기화
  useEffect(() => {
    if (selected) {
      const updated = tickets.find(t => t.key === selected.key);
      if (updated && updated !== selected) setSelected(updated);
    }
  }, [tickets]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // 공유 데이터: KV에서 로드 (planning, schedules, memos, custom-keys, custom-tickets, planning-notes)
    fetch("/api/kv?keys=cc-planning,cc-schedules,cc-memos,cc-custom-keys,cc-custom-tickets,cc-planning-notes")
      .then((r) => r.json())
      .then((data) => {
        if (data["cc-planning"])  setPlanning(data["cc-planning"]);
        if (data["cc-schedules"]) setSchedules(data["cc-schedules"]);
        if (data["cc-memos"])     setMemos(data["cc-memos"]);
        if (data["cc-planning-notes"]) {
          setPlanningNotes(data["cc-planning-notes"]);
          try { localStorage.setItem("cc-planning-notes", JSON.stringify(data["cc-planning-notes"])); } catch {}
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
      })
      .catch(() => {
        try {
          const p = localStorage.getItem("cc-planning");
          if (p) setPlanning(JSON.parse(p));
          const s = localStorage.getItem("cc-schedules");
          if (s) setSchedules(JSON.parse(s));
          const m = localStorage.getItem("cc-memos");
          if (m) setMemos(JSON.parse(m));
          const n = localStorage.getItem("cc-planning-notes");
          if (n) setPlanningNotes(JSON.parse(n));
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

  const PLANNING_STATES = ["스프린트 대기중", "검토중", "플래닝 완료"] as const;

  const planningCounts = useMemo(() => {
    const counts: Record<string, number> = { "전체": tickets.length };
    for (const s of PLANNING_STATES) counts[s] = 0;
    for (const t of tickets) {
      const p = planning[t.key] ?? "스프린트 대기중";
      counts[p] = (counts[p] ?? 0) + 1;
    }
    return counts;
  }, [tickets, planning]); // eslint-disable-line react-hooks/exhaustive-deps

  const allDomains = useMemo(() => {
    const set = new Set(tickets.map((t) => extractDomain(t.summary)));
    return [...set].sort((a, b) => a === "기타" ? 1 : b === "기타" ? -1 : a.localeCompare(b, "ko"));
  }, [tickets]);

  const allAssignees = useMemo(() => {
    const set = new Set(tickets.map((t) => t.assignee).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [tickets]);

  const DONE_STATUSES      = ["론치완료", "완료", "배포완료"];
  const INPROGRESS_STATUSES = ["개발중", "In Progress", "QA중"];
  const PLANNED_STATUSES   = ["SUGGESTED", "Backlog", "HOLD", "Postponed", "기획중", "기획완료", "디자인완료", "준비중", "디자인중"];

  // statusTab 제외한 필터 (카운트 계산용)
  const preFiltered = useMemo(() => {
    return tickets.filter((t: Ticket) => {
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
      if (planningTab !== "전체" && (planning[t.key] ?? "스프린트 대기중") !== planningTab) return false;
      if (levels.size > 0 && !levels.has(t.type)) return false;
      if (assigneeFilter.size > 0 && !assigneeFilter.has(t.assignee)) return false;
      if (domainFilter.size > 0 && !domainFilter.has(extractDomain(t.summary))) return false;
      if (projects.size > 0 && !projects.has(t.project)) return false;
      if (statuses.size > 0 && !Array.from(statuses).some((s) => matchStatus(t.status, s))) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!t.summary.toLowerCase().includes(q) && !t.key.toLowerCase().includes(q) && !t.assignee.includes(search)) return false;
      }
      return true;
    });
  }, [tickets, planningTab, quarters, projects, statuses, levels, assigneeFilter, domainFilter, search, planning]); // eslint-disable-line react-hooks/exhaustive-deps

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
        parseInt(priorities[a.key] ?? "999") - parseInt(priorities[b.key] ?? "999")
      );
    } else if (sortBy === "startDate") {
      result.sort((a: Ticket, b: Ticket) => dateVal(a.startDate) - dateVal(b.startDate));
    } else if (sortBy === "eta") {
      result.sort((a: Ticket, b: Ticket) => dateVal(a.eta) - dateVal(b.eta));
    }
    return result;
  }, [preFiltered, statusTab, sortBy, priorities]); // eslint-disable-line react-hooks/exhaustive-deps

  function saveMemo(key: string, text: string) {
    const entry: MemoEntry = {
      text,
      author: userName,
      date: new Date().toISOString().slice(0, 10),
    };
    const updated = { ...memos, [key]: entry };
    setMemos(updated);
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-memos", value: updated }),
    }).catch(() => {});
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

  /** 구버전(string) 호환 — 메모 텍스트 추출 */
  function getMemoText(key: string): string {
    const m = memos[key];
    if (!m) return "";
    return typeof m === "string" ? m : m.text;
  }

  /** 메모 메타 정보 (작성자/날짜) */
  function getMemoMeta(key: string): { author: string; date: string } | null {
    const m = memos[key];
    if (!m || typeof m === "string") return null;
    return { author: m.author, date: m.date };
  }

  function savePlanning(key: string, state: string) {
    const updated = { ...planning, [key]: state };
    setPlanning(updated);
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "cc-planning", value: updated }),
    }).catch(() => {});
  }

  function handleSelect(t: Ticket) {
    const isSame = selected?.key === t.key;
    setSelected(isSame ? null : t);
    setEditMode(false);
    setMemoEditMode(false);
    setNoteInput("");
    if (!isSame) setMemoText(getMemoText(t.key));
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
              {fetching ? "동기화 중…" : "강제 업데이트"}
            </button>
          </div>
        </div>
        {fetchError && (
          <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 font-mono break-all">
            {fetchError}
          </div>
        )}

        {/* 플래닝 탭 */}
        <div className="flex gap-1 mb-5 bg-white rounded-xl border border-gray-200 p-1">
          {(["전체", ...PLANNING_STATES] as string[]).map((tab) => {
            const active = planningTab === tab;
            const activeColor =
              tab === "플래닝 완료" ? "bg-green-600" :
              tab === "검토중"     ? "bg-orange-500" :
              tab === "스프린트 대기중" ? "bg-gray-500" :
              "bg-gray-900";
            return (
              <button
                key={tab}
                onClick={() => setPlanningTab(tab)}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${active ? `${activeColor} text-white` : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"}`}
              >
                {tab}
                <span className="ml-1.5 text-xs opacity-75">({planningCounts[tab] ?? 0})</span>
              </button>
            );
          })}
        </div>

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
            { label: "도메인",  items: allDomains,   state: domainFilter, setState: setDomainFilter, activeColor: "bg-teal-600 text-white" },
          ].map(({ label, items, state, setState, activeColor }) => (
            <div key={label} className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-400 w-14 shrink-0">{label}</span>
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
            <span className="text-xs text-gray-400 w-14 shrink-0">정렬</span>
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
            <span className="text-xs text-gray-400 w-14 shrink-0">검색</span>
            <input
              type="text"
              placeholder="티켓 번호 · 제목 · 담당자"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-300 w-64"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400 w-14 shrink-0">티켓 추가</span>
            <input
              type="text"
              placeholder="예: TM-1234"
              value={addKeyInput}
              onChange={(e) => { setAddKeyInput(e.target.value.toUpperCase()); setAddKeyError(null); }}
              onKeyDown={(e) => e.key === "Enter" && addTicket(addKeyInput)}
              className="border border-gray-200 rounded-lg px-3 py-1 text-sm font-mono placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-300 w-36"
            />
            <button
              onClick={() => addTicket(addKeyInput)}
              disabled={addKeyLoading || !addKeyInput.trim()}
              className="px-3 py-1 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {addKeyLoading ? "추가 중…" : "추가"}
            </button>
            {addKeyError && (
              <span className="text-xs text-red-500">{addKeyError}</span>
            )}
          </div>
        </div>

        {/* 티켓 목록 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* 헤더 */}
          <div className="flex items-center px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium">
            <span className="w-8 shrink-0 text-center">#</span>
            <span className="w-32 shrink-0">티켓</span>
            <span className="flex-1 min-w-0">제목</span>
            <span className="w-20 shrink-0 text-center">레벨</span>
            <span className="w-16 shrink-0 text-center">프로젝트</span>
            <span className="w-16 shrink-0 text-center">담당자</span>
            <span className="w-24 shrink-0 text-center">상태</span>
            <span className="w-24 shrink-0 text-center">시작일</span>
            <span className="w-24 shrink-0 text-center">ETA</span>
            <span className="w-6 shrink-0" />
          </div>

          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">검색 결과가 없습니다.</div>
          ) : (
            filtered.map((t, idx) => {
              const isSelected = selected?.key === t.key;
              return (
                <div
                  key={t.key}
                  className={`border-b border-gray-50 last:border-0 transition-colors ${isSelected ? "bg-indigo-50" : "hover:bg-gray-50"}`}
                >
                  {/* 메인 행 */}
                  <div
                    className="flex items-center px-4 py-3 cursor-pointer"
                    onClick={() => handleSelect(t)}
                  >
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
                    {priorities[t.key] && (
                      <span className="shrink-0 mr-2 px-1.5 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200 font-mono">
                        P{priorities[t.key]}
                      </span>
                    )}
                    {(() => {
                      const ps = planning[t.key] ?? "스프린트 대기중";
                      if (ps === "플래닝 완료") return null;
                      const cls = ps === "검토중"
                        ? "bg-orange-100 text-orange-600 border-orange-200"
                        : "bg-gray-100 text-gray-500 border-gray-200";
                      return (
                        <span className={`shrink-0 mr-2 px-1.5 py-0.5 rounded text-xs font-medium border ${cls}`}>
                          {ps}
                        </span>
                      );
                    })()}
                    <span className="flex-1 min-w-0 text-sm text-gray-800 truncate pr-3">{t.summary}</span>
                    <span className="w-20 shrink-0 flex justify-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${TYPE_COLOR[t.type] ?? "bg-gray-100 text-gray-500"}`}>
                        {t.type}
                      </span>
                    </span>
                    <span className="w-16 shrink-0 text-xs text-gray-400 text-center">{t.project}</span>
                    <span className="w-16 shrink-0 text-xs text-gray-500 text-center truncate">{t.assignee}</span>
                    <span className="w-24 shrink-0 flex justify-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[t.status] ?? "bg-gray-100 text-gray-500"}`}>
                        {t.status}
                      </span>
                    </span>
                    <span className={`w-24 shrink-0 text-xs text-center ${t.startDate ? "text-gray-600" : "text-gray-300"}`}>
                      {t.startDate ?? "미정"}
                    </span>
                    <span className={`w-24 shrink-0 text-xs text-center ${!t.eta || t.eta === "-" ? "text-gray-300" : "text-gray-600"}`}>
                      {!t.eta || t.eta === "-" ? "미정" : t.eta}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeTicket(t.key); }}
                      title="목록에서 제거"
                      className="w-6 shrink-0 flex justify-center items-center text-gray-300 hover:text-red-400 transition-colors"
                    >×</button>
                  </div>

                  {/* 펼침: Gantt */}
                  {isSelected && (
                    <div className="px-4 pb-4 border-t border-indigo-100">
                      <GanttChart roles={getRoles(t)} />
                    </div>
                  )}
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
                <h3 className="text-sm font-bold text-gray-900 leading-snug">{selected.summary}</h3>
                {(() => {
                  const ps = planning[selected.key] ?? "스프린트 대기중";
                  if (ps === "플래닝 완료") return null;
                  const cls = ps === "검토중"
                    ? "bg-orange-100 text-orange-600 border-orange-200"
                    : "bg-gray-100 text-gray-500 border-gray-200";
                  return (
                    <span className={`inline-block mt-1.5 px-1.5 py-0.5 rounded text-xs font-medium border ${cls}`}>{ps}</span>
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
              <div className="grid grid-cols-2 gap-y-1.5 text-xs">
                {[
                  { label: "담당자",  value: selected.assignee },
                  { label: "프로젝트", value: selected.project },
                  { label: "시작일",  value: selected.startDate ?? "미정" },
                  { label: "ETA",     value: (!selected.eta || selected.eta === "-") ? "미정" : selected.eta },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <span className="text-gray-400">{label} </span>
                    <span className="text-gray-700 font-medium">{value || "-"}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 추가 메타 정보 */}
            <div className="bg-gray-50 rounded-lg px-3 py-2.5 mb-4 space-y-1.5 text-xs">
              {[
                { label: "요청부문",        value: selected.requestDept },
                { label: "요청 우선순위",   value: selected.requestPriority },
                { label: "상위 항목",       value: selected.parent },
                { label: "Health Check",    value: selected.healthCheck },
                { label: "Story Points",    value: selected.storyPoints?.toString() },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-1">
                  <span className="text-gray-400 w-28 shrink-0">{label}</span>
                  <span className="text-gray-700 font-medium">{value || <span className="text-gray-300">-</span>}</span>
                </div>
              ))}
              {selected.twoPagerUrl && (
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 w-28 shrink-0">2-Pager</span>
                  <a href={selected.twoPagerUrl} target="_blank" rel="noopener noreferrer"
                    className="text-blue-500 hover:underline truncate">링크 열기</a>
                </div>
              )}
              {!selected.twoPagerUrl && (
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 w-28 shrink-0">2-Pager</span>
                  <span className="text-gray-300">-</span>
                </div>
              )}
              {selected.prdUrl && (
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 w-28 shrink-0">PRD Link</span>
                  <a href={selected.prdUrl} target="_blank" rel="noopener noreferrer"
                    className="text-blue-500 hover:underline truncate">링크 열기</a>
                </div>
              )}
              {!selected.prdUrl && (
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 w-28 shrink-0">PRD Link</span>
                  <span className="text-gray-300">-</span>
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 pt-4">
              {/* 주요 내용 요약 */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">주요 내용 요약</p>
                  {!memoEditMode ? (
                    <button
                      onClick={() => { setMemoText(getMemoText(selected.key)); setMemoEditMode(true); }}
                      className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                    >{getMemoText(selected.key) ? "편집" : "입력"}</button>
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
                {memoEditMode ? (
                  <textarea
                    value={memoText}
                    onChange={(e) => setMemoText(e.target.value)}
                    placeholder="주요 내용, 이슈, 결정 사항 등을 입력하세요"
                    rows={4}
                    className="w-full text-xs text-gray-700 border border-gray-200 rounded-lg px-3 py-2 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
                  />
                ) : summaryLoading.has(selected.key) ? (
                  <div className="flex items-center gap-2 text-xs text-indigo-400 bg-indigo-50 rounded-lg px-3 py-2">
                    <svg className="animate-spin h-3.5 w-3.5 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    AI가 티켓 내용을 분석하고 있습니다...
                  </div>
                ) : getMemoText(selected.key) ? (
                  <div>
                    <p className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-lg px-3 py-2 mb-1.5">
                      {getMemoText(selected.key)}
                    </p>
                    {getMemoMeta(selected.key) && (
                      <p className="text-xs text-gray-400 text-right">
                        {getMemoMeta(selected.key)!.author} · {getMemoMeta(selected.key)!.date}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-300 italic">입력된 내용이 없습니다</p>
                )}
              </div>

              {/* 플래닝 상태 */}
              <div className="border-t border-gray-100 pt-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">플래닝 상태</p>
                  {(planning[selected.key] ?? "스프린트 대기중") === "플래닝 완료" && getRoles(selected).length === 0 && (
                    <span className="text-xs font-medium text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">등록 필요</span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  {PLANNING_STATES.map((s) => {
                    const active = (planning[selected.key] ?? "스프린트 대기중") === s;
                    const activeClass =
                      s === "플래닝 완료" ? "bg-green-600 text-white border-green-600" :
                      s === "검토중"      ? "bg-orange-500 text-white border-orange-500" :
                                           "bg-gray-500 text-white border-gray-500";
                    return (
                      <button
                        key={s}
                        onClick={() => savePlanning(selected.key, s)}
                        className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium border transition-colors ${active ? activeClass : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                      >{s}</button>
                    );
                  })}
                </div>

                {/* 플래닝 코멘트 */}
                <div className="mt-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">플래닝 코멘트</p>

                  {/* 작성자+날짜 기준 그룹핑 */}
                  {(planningNotes[selected.key] ?? []).length > 0 ? (() => {
                    // 같은 author + 같은 날짜(YYYY-MM-DD)끼리 묶기
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
                      <div className="space-y-3 mb-3">
                        {groups.map((g, gi) => (
                          <div key={gi} className="border border-gray-100 rounded-lg overflow-hidden">
                            {/* 그룹 헤더 */}
                            <div className="flex items-center justify-between bg-gray-50 px-3 py-1.5 border-b border-gray-100">
                              <span className="text-xs font-medium text-gray-600">{g.author}</span>
                              <span className="text-xs text-gray-400">{g.date}</span>
                            </div>
                            {/* 내용 */}
                            <div className="divide-y divide-gray-50">
                              {g.items.map(({ text, idx }) => (
                                <div key={idx} className="group flex items-start gap-2 px-3 py-2">
                                  <p className="flex-1 text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{text}</p>
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

                  {/* 새 코멘트 입력 */}
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
                      className="w-full text-xs text-gray-700 border border-gray-200 rounded-lg px-3 py-2 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
                    />
                    <button
                      onClick={() => { addPlanningNote(selected.key, noteInput); setNoteInput(""); }}
                      disabled={!noteInput.trim()}
                      className="self-end text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
                    >등록</button>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
              {/* 작업별 일정 헤더 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">작업별 일정</p>
                  {(() => {
                    const ps = planning[selected.key] ?? "스프린트 대기중";
                    if (ps === "플래닝 완료") return null;
                    const cls = ps === "검토중"
                      ? "bg-orange-100 text-orange-600 border-orange-200"
                      : "bg-gray-100 text-gray-500 border-gray-200";
                    return <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${cls}`}>{ps}</span>;
                  })()}
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
                              if (e.target.value === "직접입력") updateRow(i, "role", "");
                              else updateRow(i, "role", e.target.value);
                            }}
                            className={`text-xs text-gray-900 border ${errRole ? errBorder : okBorder} rounded px-1.5 py-1 bg-white shrink-0 w-24`}
                          >
                            {PRESET_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            <option value="직접입력">직접입력</option>
                          </select>
                          {/* 직접입력 시: 작업명만 입력 */}
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
