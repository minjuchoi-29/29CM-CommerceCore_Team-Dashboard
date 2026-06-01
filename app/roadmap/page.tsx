"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { RoadmapInitiative, SAMPLE_INITIATIVES } from "@/app/types/roadmap";
import { Ticket, TrackState, DevTrackKey, RoleSchedule } from "@/lib/types";
import {
  computeInitiativeSummary,
  InitiativeSummary,
} from "@/lib/derived/roadmap";
import { classifyType } from "@/lib/derived/tickets";
import type { JiraTypeGroup } from "@/lib/types";
import { getPlanningView } from "@/lib/planning-helpers";

// ─── 로컬 유틸 (roadmap 페이지 내부 전용) ───────────────────────────────────

function isScheduleUndecided(r: RoleSchedule): boolean {
  return (!r.start && !r.end) || r.status === "미정" || r.status === "확인필요";
}

// Planning helper는 lib/planning-helpers.ts 공통 source of truth에서 import
// 이전: roadmap 자체 getPlanningEntry — devTracks 보존하지만 dev 상위는 v.dev 그대로 (집계 없음)
// 변경: getPlanningView 사용 — TicketBoard/q2-initiative와 동일하게 devTracks 있으면 aggregateDevState로 집계
// UI 표시 로직은 그대로 유지 (정책 변경 없음).

// ─── 상수 ────────────────────────────────────────────────────────────────────
const TICKET_CACHE_KEY = "cc-tickets-v1";
const JIRA_BASE = "https://jira.team.musinsa.com/browse/";
const QUARTERS: Array<"Q1" | "Q2" | "Q3" | "Q4"> = ["Q1", "Q2", "Q3", "Q4"];
const MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

// Jira 이슈 타입 순서 (UI 표시용)
const JIRA_TYPE_ORDER = ["Initiative", "Epic", "Task", "기타"] as const;
// classifyType은 lib/derived/tickets에서 import

// 이슈 타입 badge 스타일
function typeBadgeStyle(type: string): React.CSSProperties {
  switch (classifyType(type)) {
    case "Initiative": return { background: "rgba(139,92,246,0.15)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.4)" };
    case "Epic":       return { background: "rgba(59,130,246,0.15)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.3)" };
    case "Task":       return { background: "rgba(107,114,128,0.15)", color: "var(--text-muted)", border: "1px solid rgba(107,114,128,0.3)" };
    default:           return { background: "rgba(107,114,128,0.1)", color: "#6b7280", border: "1px solid rgba(107,114,128,0.2)" };
  }
}

// ─── 스타일 헬퍼 ─────────────────────────────────────────────────────────────
function statusBg(status: RoadmapInitiative["status"]): string {
  switch (status) {
    case "진행 중":  return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
    case "계획 중":  return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
    case "모니터링": return "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
    case "완료":     return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
    case "보류":     return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
  }
}

function statusBarColor(status: RoadmapInitiative["status"]): string {
  switch (status) {
    case "진행 중":  return "#3b82f6";
    case "계획 중":  return "#6b7280";
    case "모니터링": return "#d97706";
    case "완료":     return "#22c55e";
    case "보류":     return "#ef4444";
  }
}

function priorityStyle(p: RoadmapInitiative["priority"]): string {
  switch (p) { case "높음": return "text-red-400"; case "중간": return "text-amber-400"; case "낮음": return "text-green-400"; }
}
function pressureStyle(p: RoadmapInitiative["pressure"]): string {
  switch (p) { case "높음": return "text-red-400"; case "중간": return "text-amber-400"; case "낮음": return "text-green-400"; }
}
function pressureLabel(p: RoadmapInitiative["pressure"]): string {
  return p; // 높음/중간/낮음
}

// ─── 타임라인 계산 헬퍼 ──────────────────────────────────────────────────────
function monthIndex(ym: string): number { return parseInt(ym.split("-")[1], 10) - 1; }

function getBarRange(init: RoadmapInitiative, year: number): { start: number; end: number } | null {
  const yearStr = String(year);
  if (init.startMonth || init.endMonth) {
    if (init.startMonth && init.startMonth > `${yearStr}-12`) return null;
    if (init.endMonth && init.endMonth < `${yearStr}-01`) return null;
    const s = init.startMonth?.startsWith(yearStr) ? monthIndex(init.startMonth) : 0;
    const e = init.endMonth?.startsWith(yearStr) ? monthIndex(init.endMonth) : 11;
    return { start: s, end: e };
  }
  if (init.targetQuarters.length > 0) {
    const qToMonth: Record<string, [number, number]> = { Q1:[0,2], Q2:[3,5], Q3:[6,8], Q4:[9,11] };
    const starts = init.targetQuarters.map(q => qToMonth[q][0]);
    const ends   = init.targetQuarters.map(q => qToMonth[q][1]);
    return { start: Math.min(...starts), end: Math.max(...ends) };
  }
  return null;
}

// ─── 빈 로드맵 과제 팩토리 ───────────────────────────────────────────────────
function emptyInitiative(year: number): RoadmapInitiative {
  return {
    id: "", title: "", description: "", year,
    startMonth: "", endMonth: "", targetQuarters: [],
    status: "계획 중", priority: "중간", pressure: "낮음",
    objective: "", background: "", capacityMemo: "", bottleneck: "",
    isFutureQueue: false, futureMemo: "", linkedTickets: [], owner: "", tags: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

// ─── 공통 입력 스타일 ────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  background: "var(--bg-overlay)", border: "1px solid var(--border-2)", color: "var(--text-primary)",
};

// ─── Field 래퍼 ──────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>{label}</label>
      {children}
    </div>
  );
}

// ─── 티켓 타입별 그룹핑 헬퍼 ─────────────────────────────────────────────────
function groupTicketsByType(keys: string[], allTickets: Ticket[]): Record<JiraTypeGroup, Ticket[]> {
  const groups: Record<JiraTypeGroup, Ticket[]> = { Initiative: [], Epic: [], Task: [], 기타: [] };
  for (const key of keys) {
    const t = allTickets.find(x => x.key === key);
    if (t) {
      const g = classifyType(t.type);
      groups[g].push(t);
    } else {
      // 캐시에 없는 티켓은 기타로
      groups["기타"].push({ key, summary: "(캐시에 없는 티켓)", status: "-", assignee: "-", type: "기타", project: "-" });
    }
  }
  return groups;
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────
export default function RoadmapPage() {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [initiatives, setInitiatives] = useState<RoadmapInitiative[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedYear, setSelectedYear] = useState(2026);
  const [allTickets, setAllTickets] = useState<Ticket[]>([]);
  const [ticketSearch, setTicketSearch] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // View 모드 카드 상세 펼침
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  // View 모드 우측 Drawer
  const [drawerInitId, setDrawerInitId] = useState<string | null>(null);
  // cc-planning / cc-schedules (자동 집계용)
  const [planning, setPlanning] = useState<Record<string, unknown>>({});
  const [schedules, setSchedules] = useState<Record<string, RoleSchedule[]>>({});
  // 숨김 키 (cc-hidden-keys) — aggregate에서 hidden 티켓 제외
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());

  // 편집 폼 상태
  const [form, setForm] = useState<RoadmapInitiative>(emptyInitiative(2026));

  // ── 데이터 로드 ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/roadmap");
        const data = await res.json();
        if (Array.isArray(data.initiatives) && data.initiatives.length > 0) {
          setInitiatives(data.initiatives as RoadmapInitiative[]);
        } else {
          setInitiatives(SAMPLE_INITIATIVES);
        }
      } catch {
        setInitiatives(SAMPLE_INITIATIVES);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // 티켓 캐시 로드
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TICKET_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as { tickets: Ticket[] };
        if (Array.isArray(cached.tickets)) setAllTickets(cached.tickets);
      }
    } catch {}
  }, []);

  // cc-planning / cc-schedules / cc-hidden-keys 로드 (자동 집계용)
  useEffect(() => {
    fetch("/api/kv?keys=cc-planning,cc-schedules,cc-hidden-keys")
      .then(r => r.json())
      .then(data => {
        if (data["cc-planning"] && typeof data["cc-planning"] === "object") {
          setPlanning(data["cc-planning"] as Record<string, unknown>);
        }
        if (data["cc-schedules"] && typeof data["cc-schedules"] === "object") {
          setSchedules(data["cc-schedules"] as Record<string, RoleSchedule[]>);
        }
        if (Array.isArray(data["cc-hidden-keys"])) {
          setHiddenKeys(new Set(data["cc-hidden-keys"] as string[]));
        }
      })
      .catch(() => {});
  }, []);

  const selectedInit = initiatives.find(i => i.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedInit) setForm({ ...selectedInit });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 저장 ──────────────────────────────────────────────────────────────────
  const saveAll = useCallback(async (list: RoadmapInitiative[]) => {
    setSaving(true);
    try {
      await fetch("/api/roadmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initiatives: list }),
      });
      setInitiatives(list);
    } finally {
      setSaving(false);
    }
  }, []);

  function handleSave() {
    const now = new Date().toISOString();
    const tagsArr = typeof form.tags === "string"
      ? (form.tags as string).split(",").map(t => t.trim()).filter(Boolean)
      : (form.tags ?? []);
    if (!form.id) {
      const newInit: RoadmapInitiative = { ...form, id: crypto.randomUUID(), tags: tagsArr, createdAt: now, updatedAt: now };
      const next = [...initiatives, newInit];
      saveAll(next);
      setSelectedId(newInit.id);
    } else {
      const next = initiatives.map(i => i.id === form.id ? { ...form, tags: tagsArr, updatedAt: now } : i);
      saveAll(next);
    }
  }

  function handleDelete() {
    if (!selectedId) return;
    const next = initiatives.filter(i => i.id !== selectedId);
    saveAll(next);
    setSelectedId(null);
    setForm(emptyInitiative(selectedYear));
  }

  function handleAddNew() {
    setForm(emptyInitiative(selectedYear));
    setSelectedId(null);
  }

  function linkTicket(key: string) {
    if (form.linkedTickets.includes(key)) return;
    setForm(f => ({ ...f, linkedTickets: [...f.linkedTickets, key] }));
  }
  function unlinkTicket(key: string) {
    setForm(f => ({ ...f, linkedTickets: f.linkedTickets.filter(k => k !== key) }));
  }

  // 티켓 검색 결과
  const searchResults = ticketSearch.trim()
    ? allTickets.filter(t =>
        t.key.toLowerCase().includes(ticketSearch.toLowerCase()) ||
        t.summary.toLowerCase().includes(ticketSearch.toLowerCase())
      ).slice(0, 10)
    : [];

  // ── 자동 집계 (전체 initiative → summary map, hidden 제외) ────────────────
  const summaryMap = useMemo(() => {
    const map = new Map<string, InitiativeSummary>();
    for (const init of initiatives) {
      map.set(init.id, computeInitiativeSummary(init.linkedTickets, allTickets, planning, schedules, hiddenKeys));
    }
    return map;
  }, [initiatives, allTickets, planning, schedules, hiddenKeys]);

  // ── Edit 모드 파생 데이터 (early return 전에 위치해야 Hooks 순서 유지) ──────
  const linkedGroups = useMemo(
    () => groupTicketsByType(form.linkedTickets, allTickets),
    [form.linkedTickets, allTickets],
  );
  const editSummary = useMemo(
    () => computeInitiativeSummary(form.linkedTickets, allTickets, planning, schedules, hiddenKeys),
    [form, allTickets, planning, schedules, hiddenKeys],
  );
  const tagsString = Array.isArray(form.tags) ? form.tags.join(", ") : (form.tags ?? "");

  // ── 요약 통계 ─────────────────────────────────────────────────────────────
  const inYear = initiatives.filter(i => i.year === selectedYear);
  const allLinkedKeys = [...new Set(inYear.flatMap(i => i.linkedTickets))];
  const stats = {
    total: inYear.length,
    inProgress: inYear.filter(i => i.status === "진행 중").length,
    planned: inYear.filter(i => i.status === "계획 중").length,
    linkedCount: allLinkedKeys.length,
    futureQueue: inYear.filter(i => i.isFutureQueue).length,
  };

  // 오늘 기준선
  const today = new Date();
  const todayCol = today.getFullYear() === selectedYear ? today.getMonth() : -1;
  const todayFrac = today.getDate() / 31;

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm" style={{ color: "var(--text-muted)" }}>
        로딩 중...
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW 모드
  // ═══════════════════════════════════════════════════════════════════════════
  if (mode === "view") {
    const bottlenecks = inYear.filter(i => i.bottleneck);
    const futureQueue = inYear.filter(i => i.isFutureQueue);
    const mainItems   = inYear.filter(i => !i.isFutureQueue);

    return (
      <div className="flex flex-col min-h-screen" style={{ background: "var(--bg-canvas)", color: "var(--text-primary)" }}>
        {/* 헤더 */}
        <div className="px-8 py-5 sticky top-0 z-10 flex items-start justify-between gap-4"
          style={{ background: "var(--bg-canvas)", borderBottom: "1px solid var(--border)" }}>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>로드맵</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              기존 과제 현황의 티켓을 상위 목적 단위로 묶어, 팀의 방향성과 병목을 공유합니다
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
              className="text-xs rounded-md px-2.5 py-1.5 outline-none"
              style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}
            >
              {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}년</option>)}
            </select>
            <button
              onClick={() => { setMode("edit"); if (initiatives.length > 0) setSelectedId(inYear[0]?.id ?? null); }}
              className="text-xs px-3 py-1.5 rounded-md font-medium"
              style={{ background: "#7c3aed", color: "#fff" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#6d28d9"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#7c3aed"; }}
            >
              + 로드맵 과제 편집
            </button>
          </div>
        </div>

        <div className="px-8 py-6 flex flex-col gap-8">

          {/* ── 요약 카드 행 ── */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "전체 로드맵 과제", value: stats.total,      color: "#a78bfa" },
              { label: "진행 중",          value: stats.inProgress,  color: "#60a5fa" },
              { label: "계획 중",          value: stats.planned,     color: "var(--text-muted)" },
              { label: "연결 티켓",        value: stats.linkedCount, color: "#34d399" },
              { label: "향후 검토 과제",   value: stats.futureQueue, color: "#fb923c" },
            ].map(card => (
              <div key={card.label} className="rounded-xl p-4 flex flex-col gap-1"
                style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)", boxShadow: "var(--shadow-card)" }}>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>{card.label}</p>
                <p className="text-2xl font-bold" style={{ color: card.color }}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* ── 타임라인 ── */}
          <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)", boxShadow: "var(--shadow-card)" }}>
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {selectedYear}년 로드맵 과제 타임라인
              </h2>
            </div>
            <div className="p-4 overflow-x-auto">
              <div className="flex" style={{ marginLeft: 160 }}>
                {MONTHS.map((m, i) => (
                  <div key={i} className="text-[10px] text-center shrink-0"
                    style={{ width: "calc((100% - 160px) / 12)", minWidth: 52,
                      color: i === todayCol ? "#a78bfa" : "var(--text-subtle)",
                      fontWeight: i === todayCol ? 700 : 400 }}>
                    {m}
                  </div>
                ))}
              </div>
              {inYear.length === 0 ? (
                <p className="text-xs mt-4 text-center" style={{ color: "var(--text-subtle)" }}>
                  {selectedYear}년 로드맵 과제가 없습니다.
                </p>
              ) : (
                <div className="relative flex flex-col gap-1.5 mt-2">
                  {todayCol >= 0 && (
                    <div className="absolute top-0 bottom-0 pointer-events-none z-10"
                      style={{ left: `calc(160px + (100% - 160px) / 12 * ${todayCol + todayFrac})`,
                        borderLeft: "1.5px dashed #ef4444", opacity: 0.6 }} />
                  )}
                  {inYear.map(init => {
                    const range = getBarRange(init, selectedYear);
                    return (
                      <div key={init.id} className="flex items-center gap-2 cursor-pointer group"
                        onClick={() => {
                          setHighlightId(init.id === highlightId ? null : init.id);
                          document.getElementById(`card-${init.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}>
                        <div className="text-xs truncate shrink-0 group-hover:text-purple-300 transition-colors"
                          style={{ width: 152, color: "var(--text-secondary)" }} title={init.title}>
                          {init.title}
                        </div>
                        <div className="relative flex-1 h-6" style={{ minWidth: 52 * 12 }}>
                          {range ? (
                            <div className="absolute top-1 h-4 rounded-full flex items-center px-2 text-[10px] font-medium truncate"
                              style={{ left: `calc(100% / 12 * ${range.start})`,
                                width: `calc(100% / 12 * ${range.end - range.start + 1})`,
                                background: statusBarColor(init.status), opacity: 0.85, color: "#fff" }}>
                              {init.title}
                            </div>
                          ) : (
                            <div className="absolute top-1 left-0 h-4 flex items-center px-2 text-[10px]"
                              style={{ color: "var(--text-subtle)" }}>—</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── 로드맵 과제 카드 그리드 ── */}
          <div>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>로드맵 과제</h2>
            {mainItems.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-subtle)" }}>로드맵 과제가 없습니다.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {mainItems.map(init => {
                  const isExpanded = expandedCardId === init.id;
                  const groups = groupTicketsByType(init.linkedTickets, allTickets);
                  const top3 = init.linkedTickets.slice(0, 3).map(k => allTickets.find(t => t.key === k)).filter(Boolean) as Ticket[];
                  const moreCount = init.linkedTickets.length - 3;

                  return (
                    <div key={init.id} id={`card-${init.id}`}
                      className="rounded-xl flex flex-col transition-all"
                      style={{
                        background: "var(--bg-overlay)",
                        border: highlightId === init.id ? "1px solid #7c3aed" : "1px solid var(--border-2)",
                        boxShadow: highlightId === init.id ? "0 0 0 2px rgba(124,58,237,0.2)" : "var(--shadow-card)",
                      }}>
                      {/* 카드 헤더 (클릭 → 편집 모드) */}
                      <div className="p-4 flex flex-col gap-2.5 cursor-pointer"
                        onClick={() => { setSelectedId(init.id); setMode("edit"); }}>

                        {/* 타이틀 + 상태 */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {/* 로드맵 과제 badge */}
                            <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded font-semibold"
                              style={{ background: "rgba(124,58,237,0.2)", color: "#a78bfa", border: "1px solid rgba(124,58,237,0.4)" }}>
                              로드맵
                            </span>
                            <p className="text-sm font-semibold leading-snug truncate" style={{ color: "var(--text-primary)" }}>
                              {init.title}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${statusBg(init.status)}`}>
                              {init.status}
                            </span>
                            <button
                              onClick={e => { e.stopPropagation(); setDrawerInitId(init.id); }}
                              className="text-[9px] px-1.5 py-0.5 rounded transition-all"
                              style={{ background: "rgba(124,58,237,0.1)", color: "#a78bfa", border: "1px solid rgba(124,58,237,0.3)" }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(124,58,237,0.25)"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(124,58,237,0.1)"; }}
                              title="상세 보기"
                            >
                              상세
                            </button>
                          </div>
                        </div>

                        {/* 목적 */}
                        {init.objective && (
                          <p className="text-xs leading-relaxed line-clamp-2" style={{ color: "var(--text-muted)" }}>
                            {init.objective}
                          </p>
                        )}

                        {/* 우선순위 / 리소스 압력 / owner */}
                        <div className="flex items-center gap-3 flex-wrap text-[11px]">
                          <span style={{ color: "var(--text-muted)" }}>
                            우선순위 <span className={`font-semibold ${priorityStyle(init.priority)}`}>{init.priority}</span>
                          </span>
                          <span style={{ color: "var(--text-muted)" }}>
                            리소스 압력 <span className={`font-semibold ${pressureStyle(init.pressure)}`}>{pressureLabel(init.pressure)}</span>
                          </span>
                          {init.owner && <span style={{ color: "var(--text-muted)" }}>{init.owner}</span>}
                        </div>

                        {/* 기간 */}
                        {(init.startMonth || init.endMonth) && (
                          <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
                            {init.startMonth ?? "?"} → {init.endMonth ?? "?"}
                          </p>
                        )}

                        {/* 병목/리스크 */}
                        {init.bottleneck && (
                          <div className="text-[11px] px-2.5 py-1.5 rounded-lg"
                            style={{ background: "rgba(245,158,11,0.08)", color: "var(--accent-warning)", border: "1px solid rgba(245,158,11,0.25)" }}>
                            ⚠ {init.bottleneck}
                          </div>
                        )}
                      </div>

                      {/* 연결 티켓 요약 (자동 집계 포함) */}
                      {(() => {
                        const sm = summaryMap.get(init.id);
                        return (
                          <div className="px-4 pb-3 flex flex-col gap-2"
                            style={{ borderTop: "1px solid var(--border)" }}>
                            {/* 연결 티켓 수 + 타입별 badge */}
                            <div className="flex items-center gap-2 flex-wrap pt-2.5">
                              <span className="text-xs font-semibold" style={{ color: "#34d399" }}>
                                연결 티켓 {init.linkedTickets.length}
                              </span>
                              {sm && (["Initiative", "Epic", "Task", "기타"] as JiraTypeGroup[]).map(g => {
                                const cnt = sm.byType[g];
                                if (!cnt) return null;
                                return (
                                  <span key={g} className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                    style={typeBadgeStyle(g)}>
                                    {g} {cnt}
                                  </span>
                                );
                              })}
                            </div>

                            {/* 자동 집계: Design/Dev 상태 + 리뷰/미정 */}
                            {sm && sm.total > 0 && (
                              <div className="flex items-center gap-3 flex-wrap text-[10px]">
                                {sm.design["검토중"] > 0 && (
                                  <span className="px-1.5 py-0.5 rounded"
                                    style={{ background: "rgba(124,58,237,0.15)", color: "#a78bfa" }}>
                                    Design 검토중 {sm.design["검토중"]}
                                  </span>
                                )}
                                {sm.dev["검토중"] > 0 && (
                                  <span className="px-1.5 py-0.5 rounded"
                                    style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa" }}>
                                    Dev 검토중 {sm.dev["검토중"]}
                                  </span>
                                )}
                                {sm.reviewNeeded > 0 && (
                                  <span className="px-1.5 py-0.5 rounded"
                                    style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24" }}>
                                    검토필요 {sm.reviewNeeded}
                                  </span>
                                )}
                                {sm.scheduleUndecided > 0 && (
                                  <span className="px-1.5 py-0.5 rounded"
                                    style={{ background: "rgba(249,115,22,0.12)", color: "#fb923c" }}>
                                    일정 미정 {sm.scheduleUndecided}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* [AUTO] 리소스 요약 섹션 */}
                            {sm && sm.total > 0 && Object.keys(sm.roleActive).length > 0 && (
                              <div className="rounded-lg px-2.5 py-2 flex flex-col gap-1.5"
                                style={{ background: "rgba(124,58,237,0.05)", border: "1px solid rgba(124,58,237,0.15)" }}>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[8px] px-1 py-0.5 rounded font-bold"
                                    style={{ background: "rgba(124,58,237,0.2)", color: "#a78bfa" }}>AUTO</span>
                                  <span className="text-[10px] font-semibold" style={{ color: "var(--text-muted)" }}>리소스 요약</span>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap text-[10px]">
                                  {Object.entries(sm.roleActive)
                                    .sort((a, b) => b[1] - a[1])
                                    .slice(0, 3)
                                    .map(([role, cnt]) => (
                                      <span key={role} className="flex items-center gap-1">
                                        <span style={{ color: "var(--text-muted)" }}>{role}</span>
                                        <span className="font-bold" style={{ color: "var(--text-primary)" }}>{cnt}</span>
                                      </span>
                                    ))}
                                  {Object.keys(sm.roleActive).length > 3 && (
                                    <span style={{ color: "var(--text-subtle)" }}>+{Object.keys(sm.roleActive).length - 3}</span>
                                  )}
                                </div>
                                {(sm.scheduleUndecided > 0 || sm.scheduleEtaOverdue > 0 || sm.reviewNeeded > 0) && (
                                  <div className="flex items-center gap-2 flex-wrap text-[10px]">
                                    {sm.reviewNeeded > 0 && (
                                      <span className="px-1 py-0.5 rounded"
                                        style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24" }}>
                                        ⚠ 확인필요 {sm.reviewNeeded}
                                      </span>
                                    )}
                                    {sm.scheduleUndecided > 0 && (
                                      <span className="px-1 py-0.5 rounded"
                                        style={{ background: "rgba(249,115,22,0.12)", color: "#fb923c" }}>
                                        일정미정 {sm.scheduleUndecided}
                                      </span>
                                    )}
                                    {sm.scheduleEtaOverdue > 0 && (
                                      <span className="px-1 py-0.5 rounded"
                                        style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
                                        기한초과 {sm.scheduleEtaOverdue}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* [AUTO] 병목 감지 섹션 */}
                            {sm && sm.bottleneckCandidates.length > 0 && (
                              <div className="rounded-lg px-2.5 py-2 flex flex-col gap-1.5"
                                style={{ background: "rgba(124,58,237,0.05)", border: "1px solid rgba(124,58,237,0.15)" }}>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[8px] px-1 py-0.5 rounded font-bold"
                                    style={{ background: "rgba(124,58,237,0.2)", color: "#a78bfa" }}>AUTO</span>
                                  <span className="text-[10px] font-semibold" style={{ color: "var(--text-muted)" }}>병목 감지</span>
                                </div>
                                <div className="flex flex-col gap-0.5">
                                  {sm.bottleneckCandidates.slice(0, 4).map((b, i) => (
                                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                                      <span>{b.level === "red" ? "🔴" : b.level === "amber" ? "🟡" : "⚪"}</span>
                                      <span style={{ color: b.level === "red" ? "#f87171" : b.level === "amber" ? "#fbbf24" : "#6b7280" }}>
                                        {b.message}
                                      </span>
                                    </div>
                                  ))}
                                  {sm.bottleneckCandidates.length > 4 && (
                                    <p className="text-[10px]" style={{ color: "var(--text-subtle)" }}>
                                      +{sm.bottleneckCandidates.length - 4}개
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* 주요 티켓 3개 */}
                            {top3.length > 0 && (
                              <div className="flex flex-col gap-1">
                                {top3.map(t => (
                                  <div key={t.key} className="flex items-center gap-1.5 text-[11px]">
                                    <a href={`${JIRA_BASE}${t.key}`} target="_blank" rel="noopener noreferrer"
                                      className="font-mono font-semibold hover:underline shrink-0"
                                      style={{ color: "#60a5fa" }}
                                      onClick={e => e.stopPropagation()}>
                                      {t.key}
                                    </a>
                                    <span className="text-[9px] px-1 py-0.5 rounded shrink-0"
                                      style={typeBadgeStyle(t.type)}>
                                      {t.type}
                                    </span>
                                    <span className="truncate" style={{ color: "var(--text-muted)" }}>{t.summary}</span>
                                  </div>
                                ))}
                                {moreCount > 0 && (
                                  <button
                                    className="text-[11px] text-left mt-0.5 hover:underline"
                                    style={{ color: "var(--text-muted)" }}
                                    onClick={e => { e.stopPropagation(); setExpandedCardId(isExpanded ? null : init.id); }}>
                                    {isExpanded ? "▲ 접기" : `+ ${moreCount}개 더 보기`}
                                  </button>
                                )}
                              </div>
                            )}
                            {init.linkedTickets.length === 0 && (
                              <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>연결된 티켓 없음</p>
                            )}
                          </div>
                        );
                      })()}

                      {/* 확장 영역 — 연결 티켓 전체 목록 (타입별 그룹) */}
                      {isExpanded && (
                        <div className="px-4 pb-4 flex flex-col gap-3"
                          style={{ borderTop: "1px solid var(--border)" }}>
                          <p className="text-[11px] font-semibold pt-3" style={{ color: "var(--text-muted)" }}>전체 연결 티켓</p>
                          {JIRA_TYPE_ORDER.map(g => {
                            const list = groups[g];
                            if (!list.length) return null;
                            return (
                              <div key={g}>
                                <p className="text-[10px] font-semibold mb-1" style={{ color: "var(--text-subtle)" }}>
                                  {g === "Initiative" ? "Jira Initiative" : g}
                                </p>
                                <div className="flex flex-col gap-1">
                                  {list.map(t => (
                                    <div key={t.key} className="flex items-center gap-1.5 text-[11px]">
                                      <a href={`${JIRA_BASE}${t.key}`} target="_blank" rel="noopener noreferrer"
                                        className="font-mono font-semibold hover:underline shrink-0"
                                        style={{ color: "#60a5fa" }}>
                                        {t.key}
                                      </a>
                                      <span className="truncate" style={{ color: "var(--text-muted)" }}>{t.summary}</span>
                                      {t.assignee && t.assignee !== "-" && (
                                        <span className="shrink-0" style={{ color: "var(--text-subtle)" }}>· {t.assignee}</span>
                                      )}
                                      {t.status && t.status !== "-" && (
                                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded"
                                          style={{ background: "var(--bg-overlay)", color: "var(--text-muted)" }}>
                                          {t.status}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* 하단: 태그 + Future Queue */}
                      <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
                        {(init.tags ?? []).map(tag => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded"
                            style={{ background: "var(--bg-item)", color: "var(--text-muted)" }}>
                            {tag}
                          </span>
                        ))}
                        {init.isFutureQueue && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                            style={{ background: "rgba(249,115,22,0.1)", color: "#fb923c", border: "1px solid rgba(249,115,22,0.3)" }}>
                            향후 검토
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── 병목/리스크 요약 패널 ── */}
          {bottlenecks.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", boxShadow: "var(--shadow-card)" }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>현재 병목/리스크 요약</h2>
              <div className="flex flex-col gap-2">
                {bottlenecks.map(init => (
                  <div key={init.id} className="flex items-start gap-3">
                    <span className="text-xs font-medium shrink-0 mt-0.5" style={{ color: "#a78bfa" }}>
                      {init.title}
                    </span>
                    <span className="text-xs" style={{ color: "#f59e0b" }}>{init.bottleneck}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 향후 검토 과제 ── */}
          {futureQueue.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", boxShadow: "var(--shadow-card)" }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>향후 검토 과제</h2>
              <div className="flex flex-col gap-2">
                {futureQueue.map(init => (
                  <div key={init.id} className="flex items-start gap-3 py-2"
                    style={{ borderBottom: "1px solid var(--border)" }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{init.title}</p>
                      {init.futureMemo && (
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{init.futureMemo}</p>
                      )}
                    </div>
                    <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium ${statusBg(init.status)}`}>
                      {init.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Drawer Overlay ── */}
        {drawerInitId && (() => {
          const drawerInit = initiatives.find(i => i.id === drawerInitId);
          if (!drawerInit) return null;
          const dsm = summaryMap.get(drawerInitId);
          const drawerGroups = groupTicketsByType(drawerInit.linkedTickets, allTickets);
          return (
            <>
              {/* Overlay */}
              <div
                className="fixed inset-0 z-40"
                style={{ background: "rgba(0,0,0,0.5)" }}
                onClick={() => setDrawerInitId(null)}
              />
              {/* Drawer 패널 */}
              <div
                className="fixed top-0 right-0 z-50 flex flex-col overflow-y-auto"
                style={{ width: 480, height: "100vh", background: "var(--bg-overlay)", borderLeft: "1px solid var(--border-2)", boxShadow: "-4px 0 16px rgba(0,0,0,0.06)" }}
              >
                {/* 상단: 과제 개요 */}
                <div className="px-5 py-4 flex flex-col gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold self-start"
                        style={{ background: "rgba(124,58,237,0.2)", color: "#a78bfa", border: "1px solid rgba(124,58,237,0.4)" }}>
                        로드맵 과제 개요
                      </span>
                      <h2 className="text-base font-bold leading-snug" style={{ color: "var(--text-primary)" }}>
                        {drawerInit.title}
                      </h2>
                    </div>
                    <button
                      onClick={() => setDrawerInitId(null)}
                      className="shrink-0 text-lg leading-none mt-0.5"
                      style={{ color: "var(--text-muted)" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
                    >×</button>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap text-[11px]">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusBg(drawerInit.status)}`}>
                      {drawerInit.status}
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>
                      우선순위 <span className={`font-semibold ${priorityStyle(drawerInit.priority)}`}>{drawerInit.priority}</span>
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>
                      리소스 압력 <span className={`font-semibold ${pressureStyle(drawerInit.pressure)}`}>{drawerInit.pressure}</span>
                    </span>
                  </div>
                  {drawerInit.objective && (
                    <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>{drawerInit.objective}</p>
                  )}
                  {drawerInit.bottleneck && (
                    <div className="text-xs px-2.5 py-1.5 rounded-lg"
                      style={{ background: "rgba(245,158,11,0.08)", color: "var(--accent-warning)", border: "1px solid rgba(245,158,11,0.25)" }}>
                      ⚠ {drawerInit.bottleneck}
                    </div>
                  )}
                  {(drawerInit.startMonth || drawerInit.endMonth) && (
                    <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
                      기간: {drawerInit.startMonth ?? "?"} → {drawerInit.endMonth ?? "?"}
                    </p>
                  )}
                </div>

                {/* 중단: 자동 집계 요약 */}
                {dsm && (
                  <div className="px-5 py-4 flex flex-col gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] px-1 py-0.5 rounded font-bold"
                        style={{ background: "rgba(124,58,237,0.2)", color: "#a78bfa" }}>AUTO</span>
                      <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>자동 집계 요약</span>
                    </div>
                    {/* 티켓 수 */}
                    <div className="flex items-center gap-4 flex-wrap text-[11px]">
                      <span style={{ color: "var(--text-muted)" }}>전체 <span className="font-bold" style={{ color: "#34d399" }}>{dsm.total}</span></span>
                      {(["Initiative", "Epic", "Task", "기타"] as JiraTypeGroup[]).map(g => {
                        const cnt = dsm.byType[g];
                        if (!cnt) return null;
                        return <span key={g} style={{ color: "var(--text-muted)" }}>{g} <span className="font-bold" style={{ color: "var(--text-primary)" }}>{cnt}</span></span>;
                      })}
                    </div>
                    {/* 경고 집계 */}
                    {(dsm.reviewNeeded > 0 || dsm.scheduleUndecided > 0 || dsm.scheduleEtaOverdue > 0) && (
                      <div className="flex items-center gap-3 flex-wrap text-[10px]">
                        {dsm.reviewNeeded > 0 && (
                          <span className="px-1.5 py-0.5 rounded"
                            style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24" }}>검토필요 {dsm.reviewNeeded}</span>
                        )}
                        {dsm.scheduleUndecided > 0 && (
                          <span className="px-1.5 py-0.5 rounded"
                            style={{ background: "rgba(249,115,22,0.12)", color: "#fb923c" }}>일정 미정 {dsm.scheduleUndecided}</span>
                        )}
                        {dsm.scheduleEtaOverdue > 0 && (
                          <span className="px-1.5 py-0.5 rounded"
                            style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>ETA 경과 {dsm.scheduleEtaOverdue}</span>
                        )}
                      </div>
                    )}
                    {/* 리소스 분포 (roleActive) */}
                    {Object.keys(dsm.roleActive).length > 0 && (
                      <div className="flex flex-col gap-1">
                        <p className="text-[10px] font-semibold" style={{ color: "var(--text-subtle)" }}>리소스 분포 (진행중/예정/확인필요)</p>
                        <div className="flex flex-col gap-0.5">
                          {Object.entries(dsm.roleActive).sort((a, b) => b[1] - a[1]).map(([role, cnt]) => (
                            <div key={role} className="flex items-center gap-2 text-[10px]">
                              <span className="w-16 shrink-0 truncate" style={{ color: "var(--text-muted)" }}>{role}</span>
                              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, cnt * 20)}%`, background: "#7c3aed" }} />
                              </div>
                              <span className="font-bold w-4 text-right" style={{ color: "var(--text-primary)" }}>{cnt}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* 인원별 (personActive) */}
                    {Object.keys(dsm.personActive).length > 0 && (
                      <div className="flex flex-col gap-1">
                        <p className="text-[10px] font-semibold" style={{ color: "var(--text-subtle)" }}>인원별</p>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(dsm.personActive).sort((a, b) => b[1] - a[1]).map(([person, cnt]) => (
                            <span key={person} className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: "var(--bg-item)", color: "var(--text-muted)", border: "1px solid var(--border-2)" }}>
                              {person} <span className="font-bold" style={{ color: "#a78bfa" }}>{cnt}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 하단: 연결 티켓 목록 */}
                <div className="px-5 py-4 flex flex-col gap-3">
                  <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>연결 티켓 목록</p>
                  {drawerInit.linkedTickets.length === 0 ? (
                    <p className="text-xs" style={{ color: "var(--text-subtle)" }}>연결된 티켓 없음</p>
                  ) : (
                    JIRA_TYPE_ORDER.map(g => {
                      const list = drawerGroups[g];
                      if (!list.length) return null;
                      return (
                        <div key={g}>
                          <p className="text-[10px] font-semibold mb-1.5 px-1"
                            style={{ color: "var(--text-subtle)" }}>{g === "Initiative" ? "Jira Initiative" : g}</p>
                          <div className="flex flex-col gap-1">
                            {list.map(t => {
                              const tp = getPlanningView(planning[t.key]);
                              const ticketRoles = schedules[t.key] ?? [];
                              const hasUndecidedSchedule = ticketRoles.some(r => isScheduleUndecided(r));
                              return (
                                <div key={t.key} className="rounded-lg px-3 py-2 flex flex-col gap-1"
                                  style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <a href={`${JIRA_BASE}${t.key}`} target="_blank" rel="noopener noreferrer"
                                      className="text-[10px] font-mono font-semibold hover:underline shrink-0"
                                      style={{ color: "#60a5fa" }}>
                                      {t.key}
                                    </a>
                                    <span className="text-[9px] px-1 py-0.5 rounded shrink-0" style={typeBadgeStyle(t.type)}>{t.type}</span>
                                    {tp.reviewNeeded && (
                                      <span className="text-[9px] px-1 py-0.5 rounded shrink-0"
                                        style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24" }}>검토필요</span>
                                    )}
                                    {hasUndecidedSchedule && (
                                      <span className="text-[9px] px-1 py-0.5 rounded shrink-0"
                                        style={{ background: "rgba(249,115,22,0.12)", color: "#fb923c" }}>일정미정</span>
                                    )}
                                  </div>
                                  <p className="text-xs leading-snug line-clamp-2" style={{ color: "var(--text-secondary)" }}>{t.summary}</p>
                                  <div className="flex items-center gap-2 text-[10px]" style={{ color: "var(--text-subtle)" }}>
                                    {t.assignee && t.assignee !== "-" && <span>{t.assignee}</span>}
                                    {t.eta && t.eta !== "-" && <span>ETA {t.eta}</span>}
                                    {tp.design && tp.design !== "대기중" && (
                                      <span style={{ color: "#a78bfa" }}>Design {tp.design}</span>
                                    )}
                                    {tp.dev && tp.dev !== "대기중" && (
                                      <span style={{ color: "#60a5fa" }}>Dev {tp.dev}</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          );
        })()}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EDIT 모드
  // ═══════════════════════════════════════════════════════════════════════════
  // linkedGroups, editSummary, tagsString 은 early return 전에 이미 계산됨

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--bg-canvas)", color: "var(--text-primary)" }}>
      {/* 헤더 */}
      <div className="px-6 py-4 sticky top-0 z-10 flex items-center justify-between gap-4"
        style={{ background: "var(--bg-canvas)", borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setMode("view")}
            className="text-xs px-3 py-1.5 rounded-md transition-all"
            style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", color: "var(--text-muted)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}>
            ← 보기로 돌아가기
          </button>
          <h1 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>로드맵 과제 편집</h1>
          {saving && <span className="text-xs" style={{ color: "var(--text-muted)" }}>저장 중…</span>}
        </div>
        <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
          className="text-xs rounded-md px-2.5 py-1.5 outline-none"
          style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}>
          {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}년</option>)}
        </select>
      </div>

      {/* 3열 레이아웃 */}
      <div className="flex flex-1 overflow-hidden" style={{ height: "calc(100vh - 57px)" }}>

        {/* 좌측: 로드맵 과제 목록 */}
        <div className="flex flex-col shrink-0 overflow-y-auto"
          style={{ width: 224, background: "var(--bg-sidebar)", borderRight: "1px solid var(--border)" }}>
          <div className="p-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <button onClick={handleAddNew}
              className="w-full text-xs py-1.5 rounded-md font-medium transition-all"
              style={{ background: "var(--bg-item)", border: "1px solid var(--border-2)", color: "#a78bfa" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--border)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-item)"; }}>
              + 로드맵 과제 추가
            </button>
          </div>
          <div className="flex flex-col gap-0.5 p-2">
            {inYear.map(init => (
              <button key={init.id} onClick={() => setSelectedId(init.id)}
                className="w-full text-left px-2.5 py-2 rounded-md text-xs transition-all"
                style={{
                  background: selectedId === init.id ? "#1c1040" : "transparent",
                  borderLeft: selectedId === init.id ? "2px solid #7c3aed" : "2px solid transparent",
                  color: selectedId === init.id ? "var(--text-primary)" : "var(--text-muted)",
                }}
                onMouseEnter={e => { if (selectedId !== init.id) (e.currentTarget as HTMLElement).style.background = "var(--bg-item)"; }}
                onMouseLeave={e => { if (selectedId !== init.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                <p className="truncate font-medium leading-snug">{init.title || "(제목 없음)"}</p>
                <span className={`text-[10px] ${statusBg(init.status)} px-1.5 py-0.5 rounded-full mt-0.5 inline-block`}>
                  {init.status}
                </span>
              </button>
            ))}
            {initiatives.filter(i => i.year !== selectedYear).length > 0 && (
              <p className="text-[10px] px-2.5 pt-2" style={{ color: "var(--text-subtle)" }}>
                타 연도는 연도 변경 후 확인
              </p>
            )}
          </div>
        </div>

        {/* 가운데: 편집 폼 */}
        <div className="flex-1 overflow-y-auto p-6">
          {(!selectedId && !form.title && form.id === "") ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
                좌측에서 로드맵 과제를 선택하거나 새로 추가하세요.
              </p>
            </div>
          ) : (
            <div className="max-w-2xl flex flex-col gap-4">
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {form.id ? "로드맵 과제 편집" : "새 로드맵 과제"}
              </h2>

              <Field label="제목 *">
                <input type="text" value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="로드맵 과제 제목"
                  className="w-full text-sm px-3 py-2 rounded-md outline-none" style={inputStyle} />
              </Field>

              <Field label="설명">
                <textarea rows={2} value={form.description ?? ""}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="간략한 설명"
                  className="w-full text-sm px-3 py-2 rounded-md outline-none resize-none" style={inputStyle} />
              </Field>

              <Field label="목표 (Objective)">
                <textarea rows={2} value={form.objective ?? ""}
                  onChange={e => setForm(f => ({ ...f, objective: e.target.value }))}
                  placeholder="이 로드맵 과제의 목표"
                  className="w-full text-sm px-3 py-2 rounded-md outline-none resize-none" style={inputStyle} />
              </Field>

              <Field label="배경">
                <textarea rows={2} value={form.background ?? ""}
                  onChange={e => setForm(f => ({ ...f, background: e.target.value }))}
                  placeholder="추진 배경"
                  className="w-full text-sm px-3 py-2 rounded-md outline-none resize-none" style={inputStyle} />
              </Field>

              <div className="grid grid-cols-3 gap-3">
                <Field label="상태">
                  <select value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value as RoadmapInitiative["status"] }))}
                    className="w-full text-sm px-2 py-2 rounded-md outline-none" style={inputStyle}>
                    {(["계획 중", "진행 중", "모니터링", "완료", "보류"] as const).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="우선순위">
                  <select value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: e.target.value as RoadmapInitiative["priority"] }))}
                    className="w-full text-sm px-2 py-2 rounded-md outline-none" style={inputStyle}>
                    {(["높음", "중간", "낮음"] as const).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="리소스 압력">
                  <select value={form.pressure}
                    onChange={e => setForm(f => ({ ...f, pressure: e.target.value as RoadmapInitiative["pressure"] }))}
                    className="w-full text-sm px-2 py-2 rounded-md outline-none" style={inputStyle}>
                    {(["높음", "중간", "낮음"] as const).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="연도">
                  <input type="number" value={form.year}
                    onChange={e => setForm(f => ({ ...f, year: Number(e.target.value) }))}
                    className="w-full text-sm px-3 py-2 rounded-md outline-none" style={inputStyle} />
                </Field>
                <Field label="시작 월 (YYYY-MM)">
                  <input type="text" value={form.startMonth ?? ""}
                    onChange={e => setForm(f => ({ ...f, startMonth: e.target.value }))}
                    placeholder="2026-01"
                    className="w-full text-sm px-3 py-2 rounded-md outline-none" style={inputStyle} />
                </Field>
                <Field label="종료 월 (YYYY-MM)">
                  <input type="text" value={form.endMonth ?? ""}
                    onChange={e => setForm(f => ({ ...f, endMonth: e.target.value }))}
                    placeholder="2026-06"
                    className="w-full text-sm px-3 py-2 rounded-md outline-none" style={inputStyle} />
                </Field>
              </div>

              <Field label="대상 분기">
                <div className="flex gap-4">
                  {QUARTERS.map(q => (
                    <label key={q} className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--text-secondary)" }}>
                      <input type="checkbox" checked={form.targetQuarters.includes(q)}
                        onChange={e => setForm(f => ({
                          ...f, targetQuarters: e.target.checked
                            ? [...f.targetQuarters, q]
                            : f.targetQuarters.filter(x => x !== q),
                        }))}
                        className="rounded" style={{ accentColor: "#7c3aed" }} />
                      {q}
                    </label>
                  ))}
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="담당자 (Owner)">
                  <input type="text" value={form.owner ?? ""}
                    onChange={e => setForm(f => ({ ...f, owner: e.target.value }))}
                    placeholder="최민주"
                    className="w-full text-sm px-3 py-2 rounded-md outline-none" style={inputStyle} />
                </Field>
                <Field label="태그 (쉼표 구분)">
                  <input type="text" value={tagsString}
                    onChange={e => setForm(f => ({ ...f, tags: e.target.value.split(",").map(t => t.trim()).filter(Boolean) }))}
                    placeholder="구조개선, 기술부채"
                    className="w-full text-sm px-3 py-2 rounded-md outline-none" style={inputStyle} />
                </Field>
              </div>

              <Field label="리소스 메모">
                <textarea rows={2} value={form.capacityMemo ?? ""}
                  onChange={e => setForm(f => ({ ...f, capacityMemo: e.target.value }))}
                  placeholder="리소스/인력 관련 메모"
                  className="w-full text-sm px-3 py-2 rounded-md outline-none resize-none" style={inputStyle} />
              </Field>

              <Field label="병목/리스크">
                <textarea rows={2} value={form.bottleneck ?? ""}
                  onChange={e => setForm(f => ({ ...f, bottleneck: e.target.value }))}
                  placeholder="현재 병목 또는 리스크"
                  className="w-full text-sm px-3 py-2 rounded-md outline-none resize-none" style={inputStyle} />
              </Field>

              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "var(--text-secondary)" }}>
                  <input type="checkbox" checked={form.isFutureQueue ?? false}
                    onChange={e => setForm(f => ({ ...f, isFutureQueue: e.target.checked }))}
                    style={{ accentColor: "#fb923c" }} />
                  향후 검토 과제로 분류
                </label>
                {form.isFutureQueue && (
                  <textarea rows={2} value={form.futureMemo ?? ""}
                    onChange={e => setForm(f => ({ ...f, futureMemo: e.target.value }))}
                    placeholder="향후 검토 메모"
                    className="w-full text-sm px-3 py-2 rounded-md outline-none resize-none" style={inputStyle} />
                )}
              </div>

              {/* 저장/삭제 */}
              <div className="flex items-center gap-2 pt-2">
                <button onClick={handleSave} disabled={saving || !form.title.trim()}
                  className="text-xs px-4 py-2 rounded-md font-medium transition-all disabled:opacity-50"
                  style={{ background: "#7c3aed", color: "#fff" }}
                  onMouseEnter={e => { if (!saving) (e.currentTarget as HTMLElement).style.background = "#6d28d9"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#7c3aed"; }}>
                  {saving ? "저장 중…" : "저장"}
                </button>
                <button onClick={() => { setSelectedId(null); setForm(emptyInitiative(selectedYear)); }}
                  className="text-xs px-4 py-2 rounded-md transition-all"
                  style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", color: "var(--text-muted)" }}>
                  취소
                </button>
                {form.id && (
                  <button onClick={handleDelete}
                    className="text-xs px-4 py-2 rounded-md transition-all ml-auto"
                    style={{ background: "transparent", border: "1px solid #6e1313", color: "#f85149" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#1c0909"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                    삭제
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 우측: 연결 티켓 관리 */}
        <div className="flex flex-col shrink-0 overflow-y-auto"
          style={{ width: 320, background: "var(--bg-sidebar)", borderLeft: "1px solid var(--border)" }}>
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>연결 티켓 관리</p>
          </div>

          {/* 자동 집계 요약 카드 */}
          {form.linkedTickets.length > 0 && (
            <div className="mx-3 mt-3 rounded-lg p-3 flex flex-col gap-2.5"
              style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
              {/* 타입별 */}
              <div className="grid grid-cols-4 gap-1.5">
                {([
                  { label: "전체",       value: editSummary.total,              color: "#34d399" },
                  { label: "Initiative", value: editSummary.byType.Initiative,  color: "#a78bfa" },
                  { label: "Epic",       value: editSummary.byType.Epic,        color: "#60a5fa" },
                  { label: "Task",       value: editSummary.byType.Task,        color: "var(--text-muted)" },
                ] as const).map(c => (
                  <div key={c.label} className="flex flex-col gap-0.5">
                    <p className="text-[10px]" style={{ color: "var(--text-subtle)" }}>{c.label}</p>
                    <p className="text-base font-bold" style={{ color: c.color }}>{c.value}</p>
                  </div>
                ))}
              </div>
              {/* Planning 상태 */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <p className="text-[10px] font-semibold mb-1.5" style={{ color: "var(--text-subtle)" }}>플래닝 상태</p>
                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                  {(["대기중", "검토중", "완료", "대상아님"] as TrackState[]).map(s => (
                    <div key={`d-${s}`} className="flex items-center justify-between">
                      <span style={{ color: "var(--text-muted)" }}>Design {s}</span>
                      <span className="font-semibold" style={{ color: editSummary.design[s] > 0 ? "var(--text-primary)" : "var(--text-subtle)" }}>
                        {editSummary.design[s]}
                      </span>
                    </div>
                  ))}
                  {(["대기중", "검토중", "완료", "대상아님"] as TrackState[]).map(s => (
                    <div key={`v-${s}`} className="flex items-center justify-between">
                      <span style={{ color: "var(--text-muted)" }}>Dev {s}</span>
                      <span className="font-semibold" style={{ color: editSummary.dev[s] > 0 ? "var(--text-primary)" : "var(--text-subtle)" }}>
                        {editSummary.dev[s]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Dev 트랙별 */}
              {Object.values(editSummary.devTracks).some(v => v > 0) && (
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  <p className="text-[10px] font-semibold mb-1.5" style={{ color: "var(--text-subtle)" }}>Dev 트랙 (대기/검토)</p>
                  <div className="flex gap-2 flex-wrap">
                    {(["SP", "PP", "CFE", "기타"] as DevTrackKey[]).map(tk => {
                      const cnt = editSummary.devTracks[tk];
                      if (!cnt) return null;
                      return (
                        <span key={tk} className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: "var(--bg-item)", color: "var(--text-muted)", border: "1px solid var(--border-2)" }}>
                          {tk} {cnt}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* 검토필요 / 일정미정 */}
              <div className="flex items-center gap-3" style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span style={{ color: "var(--text-muted)" }}>검토필요</span>
                  <span className="font-bold" style={{ color: editSummary.reviewNeeded > 0 ? "#fbbf24" : "var(--text-subtle)" }}>
                    {editSummary.reviewNeeded}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span style={{ color: "var(--text-muted)" }}>일정 미정</span>
                  <span className="font-bold" style={{ color: editSummary.scheduleUndecided > 0 ? "#fb923c" : "var(--text-subtle)" }}>
                    {editSummary.scheduleUndecided}
                  </span>
                </div>
              </div>
              {/* 자동 감지 병목 후보 */}
              {editSummary.bottleneckCandidates.length > 0 && (
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  <p className="text-[10px] font-semibold mb-1.5" style={{ color: "#f59e0b" }}>⚠ 자동 감지 병목 후보</p>
                  <div className="flex flex-col gap-0.5">
                    {editSummary.bottleneckCandidates.slice(0, 6).map((b, i) => (
                      <p key={i} className="text-[10px]"
                        style={{ color: b.level === "red" ? "#f87171" : b.level === "amber" ? "#fbbf24" : "var(--text-muted)" }}>
                        {b.level === "red" ? "🔴" : b.level === "amber" ? "🟡" : "⚪"} {b.message}
                      </p>
                    ))}
                    {editSummary.bottleneckCandidates.length > 6 && (
                      <p className="text-[10px]" style={{ color: "var(--text-subtle)" }}>
                        외 {editSummary.bottleneckCandidates.length - 6}개
                      </p>
                    )}
                  </div>
                </div>
              )}
              {/* 활성 role 분포 */}
              {Object.keys(editSummary.roleActive).length > 0 && (
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  <p className="text-[10px] font-semibold mb-1.5" style={{ color: "var(--text-subtle)" }}>리소스 분포 (진행중/예정/확인필요)</p>
                  <div className="flex flex-col gap-0.5">
                    {Object.entries(editSummary.roleActive).sort((a, b) => b[1] - a[1]).map(([role, cnt]) => (
                      <div key={role} className="flex items-center gap-1.5 text-[10px]">
                        <span className="font-medium" style={{ color: "var(--text-muted)" }}>{role}</span>
                        <span className="font-bold" style={{ color: "var(--text-primary)" }}>{cnt}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* 인원별 분포 */}
              {Object.keys(editSummary.personActive).length > 0 && (
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  <p className="text-[10px] font-semibold mb-1.5" style={{ color: "var(--text-subtle)" }}>인원별</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(editSummary.personActive).sort((a, b) => b[1] - a[1]).map(([person, cnt]) => (
                      <span key={person} className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: "var(--bg-item)", color: "var(--text-muted)", border: "1px solid var(--border-2)" }}>
                        {person} {cnt}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 검색 */}
          <div className="px-3 pt-3 pb-2">
            <input type="text" value={ticketSearch}
              onChange={e => setTicketSearch(e.target.value)}
              placeholder="티켓 번호 또는 제목 검색"
              className="w-full text-xs px-3 py-2 rounded-md outline-none" style={inputStyle} />
          </div>

          {/* 검색 결과 */}
          {searchResults.length > 0 && (
            <div className="mx-3 mb-2 rounded-md overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              {searchResults.map(t => {
                const already = form.linkedTickets.includes(t.key);
                return (
                  <div key={t.key} className="flex items-start gap-2 px-3 py-2"
                    style={{ borderBottom: "1px solid var(--border)" }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <a href={`${JIRA_BASE}${t.key}`} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] font-mono hover:underline shrink-0" style={{ color: "#60a5fa" }}>
                          {t.key}
                        </a>
                        <span className="text-[9px] px-1 py-0.5 rounded" style={typeBadgeStyle(t.type)}>{t.type}</span>
                      </div>
                      <p className="text-xs truncate leading-snug" style={{ color: "var(--text-secondary)" }}>{t.summary}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px]" style={{ color: "var(--text-subtle)" }}>
                        {t.assignee && t.assignee !== "-" && <span>{t.assignee}</span>}
                        <span>{t.status}</span>
                      </div>
                    </div>
                    <button onClick={() => linkTicket(t.key)} disabled={already}
                      className="shrink-0 text-[10px] px-2 py-1 rounded transition-all disabled:opacity-40"
                      style={{ background: already ? "var(--bg-item)" : "#1c1040",
                        color: already ? "var(--text-subtle)" : "#a78bfa",
                        border: `1px solid ${already ? "var(--border)" : "#7c3aed"}` }}>
                      {already ? "연결됨" : "+ 연결"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* 연결된 티켓 목록 — 타입별 그룹 */}
          <div className="flex-1 px-3 pb-3">
            {form.linkedTickets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                <p className="text-xs" style={{ color: "var(--text-subtle)" }}>아직 연결된 티켓이 없습니다.</p>
                <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
                  기존 과제 현황의 티켓을 검색해 연결해보세요.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3 mt-2">
                {JIRA_TYPE_ORDER.map(g => {
                  const list = linkedGroups[g];
                  if (!list.length) return null;
                  return (
                    <div key={g}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          style={typeBadgeStyle(g)}>
                          {g === "Initiative" ? "Jira Initiative" : g}
                        </span>
                        <span className="text-[10px]" style={{ color: "var(--text-subtle)" }}>{list.length}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        {list.map(t => (
                          <div key={t.key} className="rounded-md px-3 py-2"
                            style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
                            <div className="flex items-center justify-between gap-2">
                              <a href={`${JIRA_BASE}${t.key}`} target="_blank" rel="noopener noreferrer"
                                className="text-[10px] font-mono hover:underline" style={{ color: "#60a5fa" }}>
                                {t.key}
                              </a>
                              <button onClick={() => unlinkTicket(t.key)}
                                className="text-[11px] transition-colors shrink-0"
                                style={{ color: "var(--text-subtle)" }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#f85149"; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-subtle)"; }}>
                                ×
                              </button>
                            </div>
                            <p className="text-xs leading-snug mt-0.5 line-clamp-2" style={{ color: "var(--text-secondary)" }}>
                              {t.summary}
                            </p>
                            {t.summary !== "(캐시에 없는 티켓)" && (
                              <div className="flex items-center gap-2 mt-1 text-[10px]" style={{ color: "var(--text-subtle)" }}>
                                {t.assignee && t.assignee !== "-" && <span>{t.assignee}</span>}
                                {t.status && t.status !== "-" && <span>{t.status}</span>}
                                {t.eta && t.eta !== "-" && <span>ETA {t.eta}</span>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
