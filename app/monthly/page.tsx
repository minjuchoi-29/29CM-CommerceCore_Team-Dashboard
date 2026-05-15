"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import TicketCopyButton from "@/app/components/TicketCopyButton";

const JIRA_BASE = "https://jira.team.musinsa.com/browse/";
const TICKET_CACHE_KEY = "cc-tickets-v1";
const CUSTOM_TICKETS_KEY = "cc-custom-tickets";
const HIDDEN_KEYS_KEY = "cc-hidden-keys";
const CACHE_MAX_MS = 12 * 60 * 60 * 1000;

function mergeCustomTickets(base: Ticket[], custom: Ticket[]): Ticket[] {
  const baseKeys = new Set(base.map(t => t.key));
  return [...base, ...custom.filter(t => !baseKeys.has(t.key))];
}

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

type Ticket = {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  startDate?: string;
  eta: string;
  type: string;
  project: string;
  requestDept?: string;
  parent?: string;
  storyPoints?: number;
};

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

function stripDomain(summary: string): string {
  return summary
    .replace(/^\[(29CM|29Connect)\]\s*/, "")
    .replace(/^\[[^\]]+\]\s*/, "");
}

function isCompleted(status: string): boolean {
  return ["론치완료", "완료", "배포완료"].includes(status);
}

function isActive(status: string): boolean {
  return ["개발중", "In Progress", "QA중", "디자인중", "디자인완료", "기획중", "기획완료", "준비중"].includes(status);
}

// 티켓이 활성 상태인 모든 YYYY-MM 반환
function ticketActiveMonths(ticket: Ticket): string[] {
  const end = ticket.eta && ticket.eta !== "-" ? ticket.eta : null;
  const start = ticket.startDate ?? null;

  if (!start && !end) return [];
  if (!start && end) return [end.slice(0, 7)];
  if (start && !end) return [start.slice(0, 7)];

  const startYM = start!.slice(0, 7);
  const endYM = end!.slice(0, 7);
  if (startYM > endYM) return [endYM];

  const months: string[] = [];
  let [sy, sm] = startYM.split("-").map(Number);
  const [ey, em] = endYM.split("-").map(Number);
  while (sy < ey || (sy === ey && sm <= em)) {
    months.push(`${sy}-${String(sm).padStart(2, "0")}`);
    sm++;
    if (sm > 12) { sm = 1; sy++; }
  }
  return months;
}

const TODAY = new Date();
const CURRENT_MONTH = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}`;

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}

function shortMonthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return y !== TODAY.getFullYear().toString() ? `${y}.${m}` : `${Number(m)}월`;
}

function formatDate(d: string): string {
  if (!d || d === "-") return "";
  const dt = new Date(d + "T00:00:00");
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

export default function MonthlyProgressPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(CURRENT_MONTH);
  const [collapsedDomains, setCollapsedDomains] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  function readCustomFromLocal(): Ticket[] {
    try {
      const raw = localStorage.getItem(CUSTOM_TICKETS_KEY);
      return raw ? (JSON.parse(raw) as Ticket[]) : [];
    } catch { return []; }
  }

  function readHiddenFromLocal(): string[] {
    try {
      const raw = localStorage.getItem(HIDDEN_KEYS_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch { return []; }
  }

  const loadTickets = useCallback(async (force = false) => {
    if (!force) {
      try {
        const raw = localStorage.getItem(TICKET_CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw) as { tickets: Ticket[]; fetchedAt: string };
          if (cached.tickets.length > 0 && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_MAX_MS) {
            setTickets(mergeCustomTickets(cached.tickets, readCustomFromLocal()));
            setHiddenKeys(new Set(readHiddenFromLocal()));
            setLoading(false);
            return;
          }
        }
      } catch {}
    }

    // 캐시 만료 또는 강제 갱신: JIRA + KV custom 티켓 모두 재조회
    try {
      const [jiraRes, kvRes] = await Promise.all([
        fetch("/api/jira-tickets"),
        fetch("/api/kv?keys=cc-custom-tickets,cc-hidden-keys"),
      ]);
      const jiraData = await jiraRes.json();
      const kvData = await kvRes.json();

      const base: Ticket[] = jiraData.tickets ?? [];
      const kvCustom: Ticket[] = Array.isArray(kvData["cc-custom-tickets"]) ? kvData["cc-custom-tickets"] : [];
      // KV가 없으면 localStorage fallback
      const custom = kvCustom.length > 0 ? kvCustom : readCustomFromLocal();

      const kvHidden: string[] = Array.isArray(kvData["cc-hidden-keys"]) ? kvData["cc-hidden-keys"] : [];
      const localHidden = readHiddenFromLocal();
      const mergedHidden = new Set([...kvHidden, ...localHidden]);
      setHiddenKeys(mergedHidden);

      setTickets(mergeCustomTickets(base, custom));
    } catch {}

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  // 다른 탭에서 cc-custom-tickets / cc-tickets-v1 / cc-hidden-keys 가 바뀌면 즉시 반영
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === CUSTOM_TICKETS_KEY || e.key === TICKET_CACHE_KEY) {
        loadTickets();
      }
      if (e.key === HIDDEN_KEYS_KEY) {
        setHiddenKeys(new Set(readHiddenFromLocal()));
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [loadTickets]);

  const months = useMemo(() => {
    const set = new Set<string>([CURRENT_MONTH]);
    for (const t of tickets) {
      for (const m of ticketActiveMonths(t)) set.add(m);
    }
    return [...set].filter(m => m >= "2025-01" && m <= "2027-12").sort();
  }, [tickets]);

  const domainGroups = useMemo(() => {
    const active = tickets.filter(t =>
      !hiddenKeys.has(t.key) && ticketActiveMonths(t).includes(selectedMonth)
    );
    const map = new Map<string, Ticket[]>();
    for (const t of active) {
      const d = extractDomain(t.summary);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(t);
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === "기타") return 1;
      if (b[0] === "기타") return -1;
      return b[1].length - a[1].length;
    });
  }, [tickets, hiddenKeys, selectedMonth]);

  const stats = useMemo(() => {
    const all = [...new Map(domainGroups.flatMap(([, ts]) => ts).map(t => [t.key, t])).values()];
    return {
      total: all.length,
      completed: all.filter(t => isCompleted(t.status)).length,
      inProgress: all.filter(t => isActive(t.status)).length,
      other: all.filter(t => !isCompleted(t.status) && !isActive(t.status)).length,
    };
  }, [domainGroups]);

  function toggleDomain(d: string) {
    setCollapsedDomains(prev => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  }

  const isPast = selectedMonth < CURRENT_MONTH;
  const isCurrent = selectedMonth === CURRENT_MONTH;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-400 dark:text-neutral-500 font-medium">로딩 중...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--bg-canvas)" }}>
      {/* ── Sticky Header ── */}
      <div className="bg-white dark:bg-neutral-900 border-b border-gray-200 dark:border-neutral-700 px-8 py-4 sticky top-0 z-10 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div>
            <h1 className="text-[15px] font-semibold text-gray-900 dark:text-neutral-100 leading-tight">월별 진행 현황</h1>
            <p className="text-[11px] text-gray-400 dark:text-neutral-500 mt-0.5">도메인별 월 단위 진행 이력 및 계획</p>
          </div>

          <div className="flex items-center gap-5 shrink-0">
            {/* Stats row */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-gray-400 dark:text-neutral-500 font-medium">전체</span>
                <span className="text-sm font-bold text-gray-800 dark:text-neutral-200">{stats.total}</span>
              </div>
              <div className="w-px h-3 bg-gray-200 dark:bg-neutral-700" />
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                <span className="text-[11px] text-gray-500 dark:text-neutral-500 font-medium">완료 {stats.completed}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
                <span className="text-[11px] text-gray-500 dark:text-neutral-500 font-medium">진행 {stats.inProgress}</span>
              </div>
              {stats.other > 0 && (
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block" />
                  <span className="text-[11px] text-gray-400 dark:text-neutral-500 font-medium">기타 {stats.other}</span>
                </div>
              )}
            </div>
            <button
              onClick={() => { setRefreshing(true); loadTickets(true); }}
              disabled={refreshing}
              className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-neutral-500 hover:text-gray-600 disabled:opacity-40 transition-colors font-medium px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-neutral-800"
            >
              <svg className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {refreshing ? "갱신 중..." : "새로고침"}
            </button>
          </div>
        </div>

        {/* Month pills */}
        <div className="flex gap-1 overflow-x-auto pb-0.5 -mx-1 px-1">
          {months.map(m => {
            const sel = m === selectedMonth;
            const past = m < CURRENT_MONTH;
            const current = m === CURRENT_MONTH;
            return (
              <button
                key={m}
                onClick={() => { setSelectedMonth(m); setCollapsedDomains(new Set()); }}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-all relative"
                style={sel ? {
                  background: current ? "#2563eb" : past ? "var(--text-muted)" : "#0d9488",
                  color: "#fff",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                } : {
                  background: current ? "#eff6ff" : "var(--bg-overlay)",
                  color: current ? "#2563eb" : "#6b7280",
                }}
              >
                {shortMonthLabel(m)}
                {current && !sel && (
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-blue-500 border border-white" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Month Section Header ── */}
      <div className="px-8 pt-5 pb-3 flex items-center gap-2.5">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-neutral-200">{monthLabel(selectedMonth)}</h2>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
          isCurrent ? "bg-blue-100 text-blue-700" :
          isPast    ? "bg-gray-100 dark:bg-neutral-800 text-gray-500 dark:text-neutral-500" :
                      "bg-teal-50 text-teal-700"
        }`}>
          {isCurrent ? "이번 달" : isPast ? "지난 달" : "예정"}
        </span>
        <span className="text-[11px] text-gray-400 dark:text-neutral-500">
          {domainGroups.length}개 도메인 · {stats.total}개 과제
        </span>
      </div>

      {/* ── Domain Cards ── */}
      {domainGroups.length === 0 ? (
        <div className="px-8 py-20 flex flex-col items-center gap-3 text-center">
          <span className="text-3xl opacity-20">□</span>
          <p className="text-sm font-medium text-gray-500 dark:text-neutral-500">이 달에 등록된 과제가 없습니다</p>
          <p className="text-[11px] text-gray-400 dark:text-neutral-500">다른 월을 선택하거나 티켓의 일정을 확인해주세요</p>
        </div>
      ) : (
        <div className="px-8 pb-12 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
          {domainGroups.map(([domain, domainTickets]) => {
            const collapsed = collapsedDomains.has(domain);
            const done = domainTickets.filter(t => isCompleted(t.status));
            const inProg = domainTickets.filter(t => isActive(t.status));
            const rest = domainTickets.filter(t => !isCompleted(t.status) && !isActive(t.status));
            const sorted = [...inProg, ...rest, ...done];
            const todayStr = new Date().toISOString().split("T")[0];
            const overdueList = domainTickets.filter(t =>
              t.eta && t.eta !== "-" && t.eta < todayStr && !["론치완료","완료","배포완료"].includes(t.status)
            );
            const doneRatio = domainTickets.length > 0 ? (done.length / domainTickets.length) : 0;
            const inProgRatio = domainTickets.length > 0 ? (inProg.length / domainTickets.length) : 0;

            return (
              <div
                key={domain}
                className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden transition-shadow hover:shadow-md"
                style={{ border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
              >
                {/* Card header */}
                <button
                  onClick={() => toggleDomain(domain)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left transition-colors hover:bg-gray-50/70 dark:hover:bg-neutral-800/70 active:bg-gray-100/80 dark:active:bg-neutral-700/80"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-[13px] text-gray-900 dark:text-neutral-100 truncate">{domain}</span>
                    <span className="text-[11px] font-medium text-gray-400 dark:text-neutral-500 shrink-0 tabular-nums">{domainTickets.length}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {done.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-green-50 text-green-700 border border-green-100">
                        완료 {done.length}
                      </span>
                    )}
                    {inProg.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                        진행 {inProg.length}
                      </span>
                    )}
                    {overdueList.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-red-50 text-red-600 border border-red-100">
                        ⚠ {overdueList.length}
                      </span>
                    )}
                    <svg
                      className={`w-3.5 h-3.5 text-gray-300 dark:text-neutral-600 transition-transform ml-0.5 ${collapsed ? "" : "rotate-180"}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {/* Progress bar — always visible */}
                {domainTickets.length > 0 && (
                  <div className="flex h-[3px] bg-gray-100 dark:bg-neutral-800">
                    <div
                      className="bg-green-400 transition-all duration-500"
                      style={{ width: `${doneRatio * 100}%` }}
                    />
                    <div
                      className="bg-blue-400 transition-all duration-500"
                      style={{ width: `${inProgRatio * 100}%` }}
                    />
                  </div>
                )}

                {!collapsed && (
                  <div className="divide-y divide-gray-50 dark:divide-neutral-800">
                    {sorted.map(t => {
                      const isOverdue = !!(t.eta && t.eta !== "-" && t.eta < todayStr && !["론치완료","완료","배포완료"].includes(t.status));
                      const isDone = isCompleted(t.status);

                      return (
                        <div
                          key={t.key}
                          className={`group px-4 py-2.5 transition-colors ${
                            isOverdue
                              ? "bg-red-50/60 hover:bg-red-50"
                              : isDone
                                ? "bg-gray-50/50 dark:bg-neutral-900/50 hover:bg-gray-50 dark:hover:bg-neutral-800/50"
                                : "hover:bg-blue-50/30 dark:hover:bg-blue-900/10"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              {/* Row 1: key + type badge */}
                              <div className="flex items-center gap-1.5 mb-1">
                                <a
                                  href={`${JIRA_BASE}${t.key}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`text-[10px] font-mono shrink-0 transition-colors ${
                                    isDone ? "text-gray-300 dark:text-neutral-600 line-through hover:text-gray-400" : "text-gray-400 dark:text-neutral-500 hover:text-blue-500"
                                  }`}
                                >
                                  {t.key}
                                </a>
                                <span className={`px-1 py-0 rounded text-[9px] font-semibold tracking-wide ${
                                  t.type === "Initiative" ? "bg-indigo-50 text-indigo-500" :
                                  t.type === "Epic"       ? "bg-violet-50 text-violet-500" :
                                                            "bg-gray-100 dark:bg-neutral-800 text-gray-400 dark:text-neutral-500"
                                }`}>
                                  {t.type}
                                </span>
                                {isOverdue && (
                                  <span className="text-[9px] font-semibold text-red-500 bg-red-50 px-1 py-0 rounded">ETA 초과</span>
                                )}
                              </div>

                              {/* Row 2: summary */}
                              <p
                                className={`text-[13px] leading-snug line-clamp-2 ${
                                  isDone ? "text-gray-400 dark:text-neutral-500" : "text-gray-800 dark:text-neutral-200"
                                }`}
                                title={t.summary}
                              >
                                {stripDomain(t.summary)}
                              </p>

                              {/* Row 3: assignee + date */}
                              <div className="flex items-center gap-2 mt-1">
                                {t.assignee && t.assignee !== "-" && (
                                  <span className="text-[10px] text-gray-400 dark:text-neutral-500 font-medium">{t.assignee}</span>
                                )}
                                {(t.startDate || (t.eta && t.eta !== "-")) && (
                                  <span className={`text-[10px] font-medium tabular-nums ${
                                    isOverdue ? "text-red-400" : isDone ? "text-gray-300 dark:text-neutral-600" : "text-gray-400 dark:text-neutral-500"
                                  }`}>
                                    {t.startDate
                                      ? `${formatDate(t.startDate)}${t.eta && t.eta !== "-" ? ` → ${formatDate(t.eta)}` : ""}`
                                      : `ETA ${formatDate(t.eta)}`
                                    }
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Right: status + copy */}
                            <div className="flex items-center gap-1 shrink-0 mt-0.5">
                              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${STATUS_COLOR[t.status] ?? "bg-gray-100 dark:bg-neutral-800 text-gray-500 dark:text-neutral-500"}`}>
                                {t.status}
                              </span>
                              <TicketCopyButton ticketKey={t.key} summary={t.summary} size="xs" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Collapsed summary footer */}
                {collapsed && domainTickets.length > 0 && (
                  <div className="px-4 py-2 flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full bg-gray-100 dark:bg-neutral-800 overflow-hidden">
                      <div
                        className="h-full bg-green-400 rounded-full transition-all"
                        style={{ width: `${doneRatio * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-medium text-gray-400 dark:text-neutral-500 tabular-nums shrink-0">
                      {done.length}/{domainTickets.length}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
