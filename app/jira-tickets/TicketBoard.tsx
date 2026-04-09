"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { STATIC_TICKETS } from "./tickets-data";

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
        {roles && roles.length > 0 ? roles.map((r) => (
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
        )) : (
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

const PRESET_ROLES = ["기획", "디자인", "BE-SP", "BE-PP", "BE-CE", "FE-CFE", "FE-DFE", "Mobile", "QA"];

function isCustomRole(role: string) {
  return !PRESET_ROLES.includes(role);
}
const STATUS_OPTIONS: RoleSchedule["status"][] = ["예정", "진행중", "완료"];

function newRow(): RoleSchedule {
  return { role: "기획", person: "", start: "", end: "", status: "예정" };
}

export default function TicketBoard() {
  const [tickets, setTickets]       = useState<Ticket[]>(STATIC_TICKETS);
  const [fetching, setFetching]     = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [selected, setSelected]     = useState<Ticket | null>(null);
  const [quarters, setQuarters]     = useState<Set<string>>(new Set());
  const [projects, setProjects]     = useState<Set<string>>(new Set());
  const [statuses, setStatuses]     = useState<Set<string>>(new Set());
  const [domainFilter, setDomainFilter] = useState<Set<string>>(new Set());
  const [search, setSearch]         = useState("");

  // localStorage 기반 일정 데이터
  const [schedules, setSchedules]   = useState<Record<string, RoleSchedule[]>>({});
  const [editMode, setEditMode]     = useState(false);
  const [editRows, setEditRows]     = useState<RoleSchedule[]>([]);

  // localStorage 기반 주요 내용 요약
  const [memos, setMemos]           = useState<Record<string, string>>({});
  const [memoEditMode, setMemoEditMode] = useState(false);
  const [memoText, setMemoText]     = useState("");

  // 우측 사이드바 너비 (드래그 리사이즈)
  const [sidebarWidth, setSidebarWidth] = useState(380);
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

  const fetchTickets = useCallback(async () => {
    setFetching(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/jira-tickets");
      const data = await res.json();
      if (!res.ok || data.error) {
        setFetchError(data.error ?? "알 수 없는 오류");
      } else {
        setTickets(data.tickets);
        setLastUpdated(new Date());
      }
    } catch {
      setFetchError("네트워크 오류가 발생했습니다.");
    } finally {
      setFetching(false);
    }
  }, []);

  // 자동 fetch 비활성화 — 새로고침 버튼으로만 호출
  // useEffect(() => { fetchTickets(); }, [fetchTickets]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("cc-schedules");
      if (saved) setSchedules(JSON.parse(saved));
      const savedMemos = localStorage.getItem("cc-memos");
      if (savedMemos) setMemos(JSON.parse(savedMemos));
    } catch {}
  }, []);

  function getRoles(t: Ticket): RoleSchedule[] {
    return schedules[t.key] ?? t.roles ?? [];
  }

  function saveSchedule(key: string, rows: RoleSchedule[]) {
    const updated = { ...schedules, [key]: rows };
    setSchedules(updated);
    localStorage.setItem("cc-schedules", JSON.stringify(updated));
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
    saveSchedule(selected.key, editRows.filter(r => r.role && r.start && r.end));
    setEditMode(false);
  }

  function updateRow(i: number, field: keyof RoleSchedule, value: string) {
    setEditRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  }

  const allDomains = useMemo(() => {
    const set = new Set(tickets.map((t) => extractDomain(t.summary)));
    return [...set].sort((a, b) => a === "기타" ? 1 : b === "기타" ? -1 : a.localeCompare(b, "ko"));
  }, [tickets]);

  const filtered = useMemo(() => {
    return tickets.filter((t) => {
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
      if (domainFilter.size > 0 && !domainFilter.has(extractDomain(t.summary))) return false;
      if (projects.size > 0 && !projects.has(t.project)) return false;
      if (statuses.size > 0 && !Array.from(statuses).some((s) => matchStatus(t.status, s))) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!t.summary.toLowerCase().includes(q) && !t.key.toLowerCase().includes(q) && !t.assignee.includes(search)) return false;
      }
      return true;
    });
  }, [tickets, quarters, projects, statuses, domainFilter, search]);

  const done       = filtered.filter((t) => ["론치완료", "완료", "배포완료"].includes(t.status)).length;
  const inProgress = filtered.filter((t) => ["개발중", "In Progress", "QA중"].includes(t.status)).length;
  const planned    = filtered.filter((t) => ["SUGGESTED", "Backlog", "HOLD", "Postponed", "기획중", "기획완료", "디자인완료", "준비중", "디자인중"].includes(t.status)).length;

  function saveMemo(key: string, text: string) {
    const updated = { ...memos, [key]: text };
    setMemos(updated);
    localStorage.setItem("cc-memos", JSON.stringify(updated));
  }

  function handleSelect(t: Ticket) {
    const isSame = selected?.key === t.key;
    setSelected(isSame ? null : t);
    setEditMode(false);
    setMemoEditMode(false);
    if (!isSame) setMemoText(memos[t.key] ?? "");
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
            {lastUpdated && (
              <span className="text-xs text-gray-400">
                {lastUpdated.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준
              </span>
            )}
            <button
              onClick={fetchTickets}
              disabled={fetching}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <svg className={`w-3 h-3 ${fetching ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {fetching ? "불러오는 중…" : "새로고침"}
            </button>
          </div>
        </div>
        {fetchError && (
          <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 font-mono break-all">
            {fetchError}
          </div>
        )}

        {/* 요약 카드 */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[
            { label: "전체",    count: filtered.length, color: "text-gray-900" },
            { label: "완료",    count: done,             color: "text-green-600" },
            { label: "진행중",  count: inProgress,       color: "text-blue-600" },
            { label: "계획/대기", count: planned,        color: "text-gray-400" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.count}</p>
            </div>
          ))}
        </div>

        {/* 필터 */}
        <div className="flex flex-col gap-2 mb-4">
          {[
            { label: "분기",    items: ALL_QUARTERS, state: quarters,     setState: setQuarters,     activeColor: "bg-indigo-600 text-white" },
            { label: "프로젝트", items: ALL_PROJECTS, state: projects,    setState: setProjects,     activeColor: "bg-gray-800 text-white" },
            { label: "상태",    items: ALL_STATUSES, state: statuses,     setState: setStatuses,     activeColor: "bg-blue-600 text-white" },
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
            <span className="text-xs text-gray-400 w-14 shrink-0">검색</span>
            <input
              type="text"
              placeholder="티켓 번호 · 제목 · 담당자"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 w-64"
            />
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
              <h3 className="text-sm font-bold text-gray-900 leading-snug pr-2 flex-1">{selected.summary}</h3>
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
                      onClick={() => { setMemoText(memos[selected.key] ?? ""); setMemoEditMode(true); }}
                      className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                    >{memos[selected.key] ? "편집" : "입력"}</button>
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
                    className="w-full text-xs text-gray-700 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
                  />
                ) : memos[selected.key] ? (
                  <p className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-lg px-3 py-2">
                    {memos[selected.key]}
                  </p>
                ) : (
                  <p className="text-xs text-gray-300 italic">입력된 내용이 없습니다</p>
                )}
              </div>

              <div className="border-t border-gray-100 pt-4">
              {/* 작업별 일정 헤더 */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">작업별 일정 (2026 H1)</p>
                {!editMode ? (
                  <button
                    onClick={startEdit}
                    className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                  >편집</button>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={saveEdit}
                      className="text-xs bg-indigo-600 text-white px-2.5 py-1 rounded-lg hover:bg-indigo-700 font-medium">저장</button>
                    <button onClick={() => setEditMode(false)}
                      className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">취소</button>
                  </div>
                )}
              </div>

              {/* 편집 모드 */}
              {editMode ? (
                <div className="space-y-2">
                  {editRows.map((row, i) => {
                    const custom = isCustomRole(row.role);
                    const dashIdx = row.role.indexOf("-");
                    const customD1 = custom ? (dashIdx === -1 ? "" : row.role.slice(0, dashIdx)) : "";
                    const customD2 = custom ? (dashIdx === -1 ? row.role : row.role.slice(dashIdx + 1)) : "";
                    const combineRole = (d1: string, d2: string) => d1 && d2 ? `${d1}-${d2}` : d1 || d2;
                    return (
                      <div key={i} className="bg-gray-50 rounded-lg p-2.5 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          {/* 작업 프리셋 선택 */}
                          <select
                            value={custom ? "직접입력" : row.role}
                            onChange={(e) => {
                              if (e.target.value === "직접입력") updateRow(i, "role", "");
                              else updateRow(i, "role", e.target.value);
                            }}
                            className="text-xs text-gray-900 border border-gray-300 rounded px-1.5 py-1 bg-white shrink-0 w-24"
                          >
                            {PRESET_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            <option value="직접입력">직접입력</option>
                          </select>
                          {/* 직접입력 시: depth1 + depth2 입력 */}
                          {custom && (
                            <>
                              <input
                                value={customD1}
                                onChange={(e) => updateRow(i, "role", combineRole(e.target.value, customD2))}
                                placeholder="분류"
                                className="text-xs text-gray-900 border border-gray-300 rounded px-1.5 py-1 w-14 shrink-0"
                              />
                              <input
                                value={customD2}
                                onChange={(e) => updateRow(i, "role", combineRole(customD1, e.target.value))}
                                placeholder="작업명"
                                className="text-xs text-gray-900 border border-gray-300 rounded px-1.5 py-1 w-16 shrink-0"
                              />
                            </>
                          )}
                          {/* 담당자 */}
                          <input
                            value={row.person}
                            onChange={(e) => updateRow(i, "person", e.target.value)}
                            placeholder="담당자명"
                            className="text-xs text-gray-900 border border-gray-300 rounded px-1.5 py-1 flex-1 min-w-0"
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
                          <button onClick={() => setEditRows(prev => prev.filter((_, idx) => idx !== i))}
                            className="text-gray-300 hover:text-red-400 text-base leading-none shrink-0">×</button>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-500 w-6 shrink-0">시작</span>
                          <input
                            type="date"
                            value={row.start}
                            onChange={(e) => updateRow(i, "start", e.target.value)}
                            className="text-xs text-gray-900 border border-gray-300 rounded px-1.5 py-1 flex-1"
                          />
                          <span className="text-xs text-gray-400 shrink-0">~</span>
                          <input
                            type="date"
                            value={row.end}
                            min={row.start || undefined}
                            onChange={(e) => updateRow(i, "end", e.target.value)}
                            className="text-xs text-gray-900 border border-gray-300 rounded px-1.5 py-1 flex-1"
                          />
                        </div>
                      </div>
                    );
                  })}
                  <button
                    onClick={() => setEditRows(prev => [...prev, newRow()])}
                    className="w-full text-xs text-gray-400 hover:text-gray-600 border border-dashed border-gray-200 rounded-lg py-1.5 hover:border-gray-300 transition-colors"
                  >+ 작업 추가</button>
                </div>
              ) : (
                /* 뷰 모드: Gantt */
                <>
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
