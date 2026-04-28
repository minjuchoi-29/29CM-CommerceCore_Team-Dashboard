"use client";
import { useState, useEffect, useMemo, useCallback } from "react";

const JIRA_BASE = "https://jira.team.musinsa.com/browse/";
const TICKET_CACHE_KEY = "cc-tickets-v1";
const CUSTOM_TICKETS_KEY = "cc-custom-tickets";
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

  const loadTickets = useCallback(async (force = false) => {
    if (!force) {
      try {
        const raw = localStorage.getItem(TICKET_CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw) as { tickets: Ticket[]; fetchedAt: string };
          if (cached.tickets.length > 0 && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_MAX_MS) {
            setTickets(mergeCustomTickets(cached.tickets, readCustomFromLocal()));
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
        fetch("/api/kv?keys=cc-custom-tickets"),
      ]);
      const jiraData = await jiraRes.json();
      const kvData = await kvRes.json();

      const base: Ticket[] = jiraData.tickets ?? [];
      const kvCustom: Ticket[] = Array.isArray(kvData["cc-custom-tickets"]) ? kvData["cc-custom-tickets"] : [];
      // KV가 없으면 localStorage fallback
      const custom = kvCustom.length > 0 ? kvCustom : readCustomFromLocal();

      setTickets(mergeCustomTickets(base, custom));
    } catch {}

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  // 다른 탭에서 cc-custom-tickets / cc-tickets-v1 이 바뀌면 즉시 반영
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === CUSTOM_TICKETS_KEY || e.key === TICKET_CACHE_KEY) {
        loadTickets();
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
    const active = tickets.filter(t => ticketActiveMonths(t).includes(selectedMonth));
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
  }, [tickets, selectedMonth]);

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
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        로딩 중...
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-5 sticky top-0 z-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-base font-semibold text-gray-900">월별 진행 현황</h1>
            <p className="text-xs text-gray-400 mt-0.5">도메인별로 묶어 월 단위 진행 이력과 계획을 확인합니다</p>
          </div>

          <div className="flex items-center gap-5 pt-0.5 shrink-0">
            <div className="flex gap-4 text-xs">
              <span className="text-gray-500">과제 <strong className="text-gray-800 text-sm">{stats.total}</strong></span>
              <span className="text-green-600">완료 <strong>{stats.completed}</strong></span>
              <span className="text-blue-600">진행중 <strong>{stats.inProgress}</strong></span>
              <span className="text-gray-400">기타 <strong>{stats.other}</strong></span>
            </div>
            <button
              onClick={() => { setRefreshing(true); loadTickets(true); }}
              disabled={refreshing}
              className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40 transition-colors"
            >
              {refreshing ? "갱신 중..." : "새로고침"}
            </button>
          </div>
        </div>

        {/* Month pills */}
        <div className="flex gap-1.5 mt-4 overflow-x-auto pb-0.5">
          {months.map(m => {
            const selected = m === selectedMonth;
            const past = m < CURRENT_MONTH;
            const current = m === CURRENT_MONTH;
            return (
              <button
                key={m}
                onClick={() => { setSelectedMonth(m); setCollapsedDomains(new Set()); }}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  selected
                    ? current
                      ? "bg-blue-600 text-white shadow-sm"
                      : past
                        ? "bg-gray-700 text-white shadow-sm"
                        : "bg-teal-600 text-white shadow-sm"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {shortMonthLabel(m)}
                {current && !selected && (
                  <span className="ml-1 inline-block w-1 h-1 rounded-full bg-blue-500 align-middle mb-0.5" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Month title */}
      <div className="px-8 pt-6 pb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-800">{monthLabel(selectedMonth)}</h2>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
          isCurrent ? "bg-blue-100 text-blue-700" :
          isPast ? "bg-gray-100 text-gray-500" :
          "bg-teal-50 text-teal-700"
        }`}>
          {isCurrent ? "이번 달" : isPast ? "지난 달" : "예정"}
        </span>
        <span className="text-xs text-gray-400">
          {domainGroups.length}개 도메인 · {stats.total}개 과제
        </span>
      </div>

      {/* Domain cards */}
      {domainGroups.length === 0 ? (
        <div className="px-8 py-16 text-center text-gray-400 text-sm">
          이 달에 등록된 과제가 없습니다.
        </div>
      ) : (
        <div className="px-8 pb-10 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
          {domainGroups.map(([domain, domainTickets]) => {
            const collapsed = collapsedDomains.has(domain);
            const done = domainTickets.filter(t => isCompleted(t.status));
            const inProg = domainTickets.filter(t => isActive(t.status));
            const rest = domainTickets.filter(t => !isCompleted(t.status) && !isActive(t.status));
            const sorted = [...inProg, ...rest, ...done];

            return (
              <div key={domain} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <button
                  onClick={() => toggleDomain(domain)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-sm text-gray-900 truncate">{domain}</span>
                    <span className="text-xs text-gray-400 shrink-0">{domainTickets.length}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {done.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">
                        완료 {done.length}
                      </span>
                    )}
                    {inProg.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
                        진행 {inProg.length}
                      </span>
                    )}
                    {rest.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                        기타 {rest.length}
                      </span>
                    )}
                    <svg
                      className={`w-3.5 h-3.5 text-gray-400 transition-transform ${collapsed ? "" : "rotate-180"}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {/* 진행률 바 */}
                {!collapsed && domainTickets.length > 0 && (
                  <div className="flex h-1">
                    <div className="bg-green-400 transition-all" style={{ width: `${(done.length / domainTickets.length) * 100}%` }} />
                    <div className="bg-blue-400 transition-all" style={{ width: `${(inProg.length / domainTickets.length) * 100}%` }} />
                    <div className="flex-1 bg-gray-100" />
                  </div>
                )}

                {!collapsed && (
                  <div className="divide-y divide-gray-50">
                    {sorted.map(t => (
                      <div key={t.key} className={`px-4 py-2.5 hover:bg-gray-50 transition-colors ${isCompleted(t.status) ? "opacity-60" : ""}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-1">
                              <a
                                href={`${JIRA_BASE}${t.key}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] font-mono text-gray-400 hover:text-blue-500 shrink-0"
                              >
                                {t.key}
                              </a>
                              <span className={`px-1.5 py-0 rounded text-[9px] font-semibold tracking-wide ${
                                t.type === "Initiative" ? "bg-indigo-100 text-indigo-600" :
                                t.type === "Epic" ? "bg-violet-100 text-violet-600" :
                                "bg-gray-100 text-gray-500"
                              }`}>
                                {t.type}
                              </span>
                            </div>
                            <p className="text-sm text-gray-800 leading-snug line-clamp-2" title={t.summary}>
                              {stripDomain(t.summary)}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              {t.assignee && t.assignee !== "-" && (
                                <span className="text-[11px] text-gray-400">{t.assignee}</span>
                              )}
                              {t.startDate && (
                                <span className="text-[11px] text-gray-300">
                                  {formatDate(t.startDate)}{t.eta && t.eta !== "-" ? ` → ${formatDate(t.eta)}` : ""}
                                </span>
                              )}
                              {!t.startDate && t.eta && t.eta !== "-" && (
                                <span className="text-[11px] text-gray-300">ETA {formatDate(t.eta)}</span>
                              )}
                            </div>
                          </div>
                          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium mt-0.5 ${STATUS_COLOR[t.status] ?? "bg-gray-100 text-gray-500"}`}>
                            {t.status}
                          </span>
                        </div>
                      </div>
                    ))}
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
