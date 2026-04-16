"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";

const JIRA_BASE = "https://jira.team.musinsa.com/browse/";
const TICKET_CACHE_KEY = "cc-tickets-v1";

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

const TYPE_COLOR: Record<string, string> = {
  "Initiative": "bg-indigo-100 text-indigo-700",
  "Epic":       "bg-violet-100 text-violet-600",
  "Dev":        "bg-gray-100 text-gray-500",
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
};

function extractDomain(summary: string): string {
  const m = summary.match(/^\[([^\]]+)\]/);
  return m ? m[1] : "기타";
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function formatSyncedAt(d: Date): string {
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `오늘 ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]}) ${time}`;
}

export default function AssigneeView() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [priorities, setPriorities] = useState<Record<string, string>>({});
  const [planning, setPlanning]     = useState<Record<string, string>>({});

  useEffect(() => {
    let loaded = false;

    // 1. localStorage 캐시 우선 사용 (TicketBoard와 동일한 캐시 키)
    try {
      const raw = localStorage.getItem(TICKET_CACHE_KEY);
      const customRaw = localStorage.getItem("cc-custom-tickets");

      let mainTickets: Ticket[] = [];
      let customTickets: Ticket[] = [];

      if (raw) {
        const cached = JSON.parse(raw) as { tickets: Ticket[]; fetchedAt: string };
        if (cached.tickets?.length > 0) {
          mainTickets = cached.tickets;
          if (cached.fetchedAt) setSyncedAt(new Date(cached.fetchedAt));
          loaded = true;
        }
      }
      if (customRaw) {
        customTickets = JSON.parse(customRaw) as Ticket[];
      }

      if (loaded) {
        const jiraKeys = new Set(mainTickets.map((t) => t.key));
        const extra = customTickets.filter((t) => !jiraKeys.has(t.key));
        setTickets([...mainTickets, ...extra]);
        setLoading(false);
        return;
      }
    } catch {}

    // 2. 캐시 없으면 API 직접 호출
    fetch("/api/jira-tickets")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else if (data.tickets) {
          setTickets(data.tickets as Ticket[]);
          setSyncedAt(data.fetchedAt ? new Date(data.fetchedAt) : new Date());
        }
      })
      .catch(() => setError("네트워크 오류가 발생했습니다."))
      .finally(() => setLoading(false));

    // 시트 우선순위 로드
    fetch("/api/sheet-priorities")
      .then(r => r.json())
      .then(d => { if (d.priorities) setPriorities(d.priorities); })
      .catch(() => {});

    // 플래닝 상태 로드 (KV, localStorage 폴백)
    fetch("/api/kv?keys=cc-planning")
      .then((r) => r.json())
      .then((d) => { if (d["cc-planning"]) setPlanning(d["cc-planning"]); })
      .catch(() => {
        try {
          const p = localStorage.getItem("cc-planning");
          if (p) setPlanning(JSON.parse(p));
        } catch {}
      });
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    for (const t of tickets) {
      const a = t.assignee || "미지정";
      if (!map.has(a)) map.set(a, []);
      map.get(a)!.push(t);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"));
  }, [tickets]);

  const doneCnt      = tickets.filter((t) => ["론치완료", "완료", "배포완료"].includes(t.status)).length;
  const inProgressCnt = tickets.filter((t) => ["개발중", "In Progress", "QA중"].includes(t.status)).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <svg className="w-8 h-8 animate-spin text-indigo-400 mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <p className="text-sm text-gray-400">티켓 불러오는 중…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-7xl mx-auto px-8 py-8">
        {/* 헤더 */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">담당자별 과제 현황</h2>
            <p className="text-sm text-gray-400 mt-0.5">Sub Group: 29CM-P Commerce Core</p>
          </div>
          {syncedAt && (
            <span className="text-xs text-gray-400 mt-1">
              JIRA 동기화:{" "}
              <span className="text-gray-600 font-medium">{formatSyncedAt(syncedAt)}</span>
            </span>
          )}
        </div>

        {error && (
          <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
            {error}
          </div>
        )}

        {/* 요약 카드 */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: "전체 티켓",  count: tickets.length,    color: "text-gray-900" },
            { label: "담당자",     count: grouped.length,    color: "text-indigo-600" },
            { label: "진행중",     count: inProgressCnt,     color: "text-blue-600" },
            { label: "완료",       count: doneCnt,           color: "text-green-600" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.count}</p>
            </div>
          ))}
        </div>

        {/* 티켓 없을 때 안내 */}
        {tickets.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-sm text-gray-400">표시할 티켓이 없습니다.</p>
            <p className="text-xs text-gray-300 mt-2">
              먼저{" "}
              <Link href="/" className="text-blue-400 hover:underline">
                전체 과제 보기
              </Link>
              에서 JIRA 데이터를 불러오세요.
            </p>
          </div>
        ) : (
          /* 담당자별 그룹 */
          grouped.map(([assignee, items]) => (
            <div key={assignee} className="mb-8">
              <h2 className="text-base font-semibold text-gray-700 mb-3">
                {assignee}
                <span className="ml-2 text-sm font-normal text-gray-400">{items.length}건</span>
              </h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-gray-500 text-xs">
                      <th className="text-left px-4 py-3 font-medium">JIRA</th>
                      <th className="text-left px-4 py-3 font-medium w-1/2">과제</th>
                      <th className="text-left px-4 py-3 font-medium">도메인</th>
                      <th className="text-left px-4 py-3 font-medium">레벨</th>
                      <th className="text-left px-4 py-3 font-medium">상태</th>
                      <th className="text-left px-4 py-3 font-medium">ETA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((t) => (
                      <tr key={t.key} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <a
                            href={`${JIRA_BASE}${t.key}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline font-mono text-xs"
                          >
                            {t.key}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-gray-800 font-medium">
                          <span className="flex items-center gap-2">
                            {priorities[t.key] && (
                              <span className="shrink-0 px-1.5 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200 font-mono">
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
                                <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium border ${cls}`}>
                                  {ps}
                                </span>
                              );
                            })()}
                            {t.summary}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{extractDomain(t.summary)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLOR[t.type] ?? "bg-gray-100 text-gray-500"}`}>
                            {t.type}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[t.status] ?? "bg-gray-100 text-gray-500"}`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {!t.eta || t.eta === "-" ? <span className="text-gray-300">미정</span> : t.eta}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  );
}
