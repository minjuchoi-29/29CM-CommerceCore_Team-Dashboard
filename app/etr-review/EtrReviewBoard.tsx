"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import type { Ticket } from "@/app/jira-tickets/TicketBoard";
import { Tooltip } from "@/app/components/Tooltip";
import TicketCopyButton from "@/app/components/TicketCopyButton";
import {
  buildEtrReverseMap,
  collectLinkedDocs,
  deriveSource,
  SOURCE_LABEL,
  deriveLinkedWorkSummary,
  hasDocs,
  isReviewPending,
  isReviewed,
  isClosed,
  ETR_REVIEW_FILTER_LABEL,
  DOC_TYPE_META,
  type LinkedWork,
  type LinkedDoc,
  type EtrReviewFilterKey,
  type EtrSource,
} from "@/lib/etr-links";

const JIRA_BASE = "https://jira.team.musinsa.com/browse/";

type Memo = string | { text?: string; author?: string; date?: string };
type EtrInfoEntry = {
  source?: "자체발의" | "ELT" | "ETR";
  etrTickets?: { key: string }[];
  wikiLinks?: { url: string; title: string }[];
};

const STATUS_PILL: Record<string, string> = {
  "검토대기":               "bg-amber-100 text-amber-700 border border-amber-300",
  "Tech 검토 대기 중":      "bg-amber-100 text-amber-700 border border-amber-300",
  "Tech 검토대기":           "bg-amber-100 text-amber-700 border border-amber-300",
  "검토중":                 "bg-blue-100 text-blue-700 border border-blue-300",
  "Tech 검토중":            "bg-blue-100 text-blue-700 border border-blue-300",
  "Tech 검토 중":           "bg-blue-100 text-blue-700 border border-blue-300",
  "검토완료-우선착수":      "bg-indigo-100 text-indigo-700 border border-indigo-300",
  "검토완료-백로그":        "bg-slate-100 text-slate-700 border border-slate-300",
  "완료":                   "bg-emerald-100 text-emerald-700 border border-emerald-300",
  "반려":                   "bg-rose-100 text-rose-700 border border-rose-300",
  "중단":                   "bg-rose-100 text-rose-700 border border-rose-300",
  "미진행":                 "bg-gray-100 text-gray-600 border border-gray-300",
};
const TYPE_PILL: Record<string, string> = {
  Initiative: "bg-indigo-100 text-indigo-700 border border-indigo-200",
  Epic:       "bg-purple-100 text-purple-700 border border-purple-200",
};

function chip(cls: string | undefined): string {
  return cls ?? "bg-gray-100 text-gray-600 border border-gray-300";
}

export default function EtrReviewBoard({ userName: _userName }: { userName?: string }) {
  const [tickets, setTickets]       = useState<Ticket[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [etrMap, setEtrMap]         = useState<Record<string, EtrInfoEntry>>({});
  const [memos, setMemos]           = useState<Record<string, Memo>>({});
  const [filter, setFilter]         = useState<EtrReviewFilterKey>("needsAction");
  const [search, setSearch]         = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // 정렬
  type SortCol = "key" | "summary" | "status" | "assignee" | "reporter" | "eta" | "priority" | "source" | "linkedWork" | "docs";
  const [sort, setSort] = useState<{ col: SortCol; dir: "asc" | "desc" } | null>(null);
  function toggleSort(col: SortCol) {
    setSort(prev => {
      if (prev?.col !== col) return { col, dir: "asc" };
      if (prev.dir === "asc") return { col, dir: "desc" };
      return null; // 3-state: asc → desc → off
    });
  }

  // 추가 UI
  const [addInput, setAddInput]   = useState("");
  const [adding, setAdding]       = useState(false);
  const [addError, setAddError]   = useState<string | null>(null);
  const [addedToast, setAddedToast] = useState<string | null>(null);

  // 액션 상태
  const [unManaging, setUnManaging] = useState<string | null>(null);
  const [hidingKey, setHidingKey]   = useState<string | null>(null);

  // Phase 3: ?key= 딥링크 — URL 에 key 가 있으면 해당 ETR 자동 선택
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const k = params.get("key");
    if (k && k.startsWith("ETR-")) {
      setSelectedKey(k);
      // 현재 필터 (default = needsAction) 에서 안 보일 수 있으므로 "전체 요청" 으로 강제 전환
      setFilter("all");
    }
  }, []);

  // ── 초기 로드 ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [ticketsRes, kvRes] = await Promise.all([
          fetch("/api/jira-tickets").then(r => r.ok ? r.json() : Promise.reject(new Error(`tickets ${r.status}`))),
          // /api/kv 는 keys= (복수) 받고 { "cc-etr": {...}, "cc-memos-v2": {...}, ... } 형태로 반환
          fetch("/api/kv?keys=cc-etr,cc-memos-v2,cc-hidden-keys").then(r => r.ok ? r.json() as Promise<Record<string, unknown>> : ({} as Record<string, unknown>)),
        ]);
        if (cancelled) return;
        setTickets(Array.isArray(ticketsRes?.tickets) ? ticketsRes.tickets : []);
        const etr = kvRes?.["cc-etr"];
        setEtrMap(etr && typeof etr === "object" && !Array.isArray(etr) ? (etr as Record<string, EtrInfoEntry>) : {});
        const m = kvRes?.["cc-memos-v2"];
        setMemos(m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, Memo>) : {});
        const h = kvRes?.["cc-hidden-keys"];
        setHiddenKeys(new Set(Array.isArray(h) ? (h as string[]) : []));
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "로드 실패");
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── derive ────────────────────────────────────────────────────────────
  const ticketByKey = useMemo(() => {
    const m = new Map<string, Ticket>();
    for (const t of tickets) m.set(t.key, t);
    return m;
  }, [tickets]);

  const etrReverseMap = useMemo(
    () => buildEtrReverseMap(etrMap, ticketByKey),
    [etrMap, ticketByKey],
  );

  // ETR 티켓만 추출 (project===ETR or key starts with ETR-)
  const allEtrTickets = useMemo(
    () => tickets
      .filter(t => t.key.startsWith("ETR-") || t.project === "ETR")
      .filter(t => !hiddenKeys.has(t.key)),
    [tickets, hiddenKeys],
  );

  // 카운트 (필터별)
  const counts = useMemo(() => {
    const c: Record<EtrReviewFilterKey, number> = {
      needsAction: 0, all: 0, noLinkedWork: 0, hasLinkedWork: 0, reviewed: 0, closed: 0,
    };
    for (const t of allEtrTickets) {
      const lwSum = deriveLinkedWorkSummary(etrReverseMap.get(t.key) ?? []);
      const noLW = lwSum.count === 0;
      c.all++;
      if (noLW) c.noLinkedWork++;
      else c.hasLinkedWork++;
      if (isReviewed(t.status)) c.reviewed++;
      if (isClosed(t.status)) c.closed++;
      if (noLW && isReviewPending(t.status)) c.needsAction++;
    }
    return c;
  }, [allEtrTickets, etrReverseMap]);

  // 필터 + 정렬 적용
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = allEtrTickets.filter(t => {
      const lwSum = deriveLinkedWorkSummary(etrReverseMap.get(t.key) ?? []);
      const noLW = lwSum.count === 0;
      let pass = true;
      switch (filter) {
        case "needsAction":   pass = noLW && isReviewPending(t.status); break;
        case "all":           pass = true; break;
        case "noLinkedWork":  pass = noLW; break;
        case "hasLinkedWork": pass = !noLW; break;
        case "reviewed":      pass = isReviewed(t.status); break;
        case "closed":        pass = isClosed(t.status); break;
      }
      if (!pass) return false;
      if (q && !t.summary.toLowerCase().includes(q) && !t.key.toLowerCase().includes(q)) return false;
      return true;
    });

    if (!sort) return out;
    const cmp = (a: Ticket, b: Ticket): number => {
      const empty = "￿"; // 빈 값은 항상 후순위
      switch (sort.col) {
        case "key": {
          // ETR-3427 → 3427 (numeric part 기준)
          const an = parseInt(a.key.split("-")[1] ?? "0", 10);
          const bn = parseInt(b.key.split("-")[1] ?? "0", 10);
          return an - bn;
        }
        case "summary": {
          // 가나다/알파벳 정렬. 빈 summary 는 asc/desc 모두 항상 후순위.
          // dir 을 보정해 sort 후 reverse() 가 적용돼도 empty 가 끝에 남도록 함.
          const av = a.summary?.trim();
          const bv = b.summary?.trim();
          if (!av && !bv) return 0;
          if (!av) return sort.dir === "desc" ? -1 : 1;
          if (!bv) return sort.dir === "desc" ? 1 : -1;
          return av.localeCompare(bv, "ko");
        }
        case "status":     return (a.status || empty).localeCompare(b.status || empty);
        case "assignee":   return (a.assignee || empty).localeCompare(b.assignee || empty);
        case "reporter":   return (a.requestMeta?.reporter || empty).localeCompare(b.requestMeta?.reporter || empty);
        case "eta":        return ((a.eta && a.eta !== "-" ? a.eta : empty)).localeCompare(b.eta && b.eta !== "-" ? b.eta : empty);
        case "priority":   return (a.requestPriority || empty).localeCompare(b.requestPriority || empty);
        case "source":     return deriveSource(a).localeCompare(deriveSource(b));
        case "linkedWork": return (etrReverseMap.get(a.key)?.length ?? 0) - (etrReverseMap.get(b.key)?.length ?? 0);
        case "docs":       return Number(hasDocs(a.key, etrReverseMap, etrMap, ticketByKey)) - Number(hasDocs(b.key, etrReverseMap, etrMap, ticketByKey));
        default:           return 0;
      }
    };
    const sorted = [...out].sort(cmp);
    if (sort.dir === "desc") sorted.reverse();
    return sorted;
  }, [allEtrTickets, filter, search, etrReverseMap, sort, etrMap, ticketByKey]);

  const selected = selectedKey ? ticketByKey.get(selectedKey) ?? null : null;

  // ── actions ───────────────────────────────────────────────────────────
  function showToast(msg: string) {
    setAddedToast(msg);
    setTimeout(() => setAddedToast(null), 4000);
  }

  async function handleAdd() {
    const trimmed = addInput.trim().toUpperCase();
    if (!trimmed) return;
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(trimmed)) {
      setAddError("형식이 올바르지 않습니다 (예: ETR-3427)");
      return;
    }
    if (!trimmed.startsWith("ETR-")) {
      setAddError("ETR 키만 입력 가능합니다. 실행 티켓은 전체 과제 현황에서 추가해주세요.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", key: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data?.error ?? `추가 실패 (${res.status})`);
        return;
      }
      // 새 ticket fetch
      const single = await fetch(`/api/jira-tickets/single?key=${trimmed}`);
      if (single.ok) {
        const sd = await single.json();
        if (sd?.ticket) {
          setTickets(prev => [...prev.filter(t => t.key !== trimmed), { ...sd.ticket, isManual: true }]);
        }
      }
      setAddInput("");
      showToast(`${trimmed}이(가) ETR 검토 목록에 추가되었습니다.`);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "추가 실패");
    } finally {
      setAdding(false);
    }
  }

  /**
   * 수동 추적 해제 — manual source 만 제거.
   * Filter source 가 있으면 row 는 filter only 로 남음.
   * cc-custom-keys 에서만 제거 (TICKET_KEYS git 파일은 변경 안 함).
   */
  async function handleUnmanage(key: string) {
    if (!confirm(`${key}을(를) 수동 추적에서 해제하시겠습니까?\n\nFilter 소스가 있으면 목록에 계속 남아 있고,\n없으면 다음 sync 까지 노출됩니다.`)) return;
    setUnManaging(key);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", key }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`해제 실패: ${data?.error ?? res.status}`);
        return;
      }
      // 클라이언트 상태 업데이트 — isManual 만 false 로
      setTickets(prev => prev.map(t => t.key === key ? { ...t, isManual: false } : t));
      showToast(`${key} 수동 추적 해제됨`);
    } finally {
      setUnManaging(null);
    }
  }

  /**
   * 목록에서 숨김 — cc-hidden-keys 에 추가.
   * 수동/필터 어느 쪽이든 row 만 숨김. 데이터는 그대로.
   */
  async function handleHide(key: string) {
    if (!confirm(`${key}을(를) ETR 검토 목록에서 숨기시겠습니까?\n\n데이터는 유지되며 cc-hidden-keys 에서 언제든 복원 가능합니다.`)) return;
    setHidingKey(key);
    try {
      const next = new Set(hiddenKeys);
      next.add(key);
      const res = await fetch("/api/kv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "cc-hidden-keys", value: Array.from(next) }),
      });
      if (!res.ok) {
        alert(`숨김 실패: ${res.status}`);
        return;
      }
      setHiddenKeys(next);
      if (selectedKey === key) setSelectedKey(null);
      showToast(`${key} 숨김 처리됨`);
    } finally {
      setHidingKey(null);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="flex items-center justify-center min-h-screen text-sm" style={{ color: "var(--text-muted)" }}>로딩 중…</div>;
  }
  if (error) {
    return <div className="flex items-center justify-center min-h-screen text-sm text-red-500">에러: {error}</div>;
  }

  // 정렬 가능 헤더 cell — click 시 toggleSort. align="left|center" 로 텍스트 정렬 보정.
  function SortHead({ col, label, className, align = "center" }: { col: SortCol; label: string; className?: string; align?: "left" | "center" }) {
    const active = sort?.col === col;
    const arrow = !active ? "" : sort?.dir === "asc" ? " ▲" : " ▼";
    const justify = align === "left" ? "justify-start" : "justify-center";
    return (
      <button
        type="button"
        onClick={() => toggleSort(col)}
        className={`flex items-center ${justify} gap-1 hover:text-indigo-300 transition-colors text-left ${className ?? ""}`}
        style={{ color: active ? "#a5b4fc" : undefined, fontWeight: active ? 600 : undefined }}
        title={`정렬: ${label}`}
      >
        {label}{arrow}
      </button>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg-canvas)" }}>
      {/* ── 좌측: list column (독립 스크롤) ── */}
      <div className={`flex flex-col min-w-0 ${selected ? "flex-1" : "flex-1"}`}>
        {/* ── Header (sticky) ── */}
        <header className="shrink-0 px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>ETR 검토</h1>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                외부 부서 요청 (Engineering Task Request) 을 검토하고 실행 티켓으로 전환합니다.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* ETR 요청 추가 */}
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
                <input
                  type="text"
                  placeholder="ETR-3427 등 요청 검토 티켓을 추가합니다."
                  value={addInput}
                  onChange={e => { setAddInput(e.target.value.toUpperCase()); setAddError(null); }}
                  onKeyDown={e => e.key === "Enter" && handleAdd()}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-mono border transition-all"
                  style={{ background: "var(--bg-item)", borderColor: "var(--border-2)", color: "var(--text-primary)", outline: "none", width: "260px" }}
                />
                <button
                  onClick={handleAdd}
                  disabled={adding || !addInput.trim()}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                  style={{ background: "#7c3aed", color: "white" }}
                >
                  {adding ? "추가 중…" : "+ ETR 요청 추가"}
                </button>
              </div>
            </div>
          </div>
          {addError && (
            <p className="mt-2 text-xs text-red-500">{addError}</p>
          )}
          {addedToast && (
            <p className="mt-2 text-xs" style={{ color: "#10b981" }}>{addedToast}</p>
          )}
        </header>

        {/* ── Filter Tabs (sticky) ── */}
        <nav className="shrink-0 px-6 py-3 flex items-center gap-1.5 flex-wrap" style={{ borderBottom: "1px solid var(--border)" }}>
          {(["needsAction", "all", "noLinkedWork", "hasLinkedWork", "reviewed", "closed"] as EtrReviewFilterKey[]).map(k => {
            const active = filter === k;
            return (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5"
                style={{
                  background: active ? "rgba(99,102,241,0.12)" : "var(--bg-item)",
                  color:      active ? "#818cf8" : "var(--text-muted)",
                  border:     `1px solid ${active ? "rgba(99,102,241,0.35)" : "var(--border)"}`,
                }}
              >
                <span>{ETR_REVIEW_FILTER_LABEL[k]}</span>
                <span className="text-[10px] font-mono opacity-70">{counts[k]}</span>
              </button>
            );
          })}
          <div className="ml-auto">
            <input
              type="text"
              placeholder="검색…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg text-xs border"
              style={{ background: "var(--bg-item)", borderColor: "var(--border-2)", color: "var(--text-primary)", width: 180, outline: "none" }}
            />
          </div>
        </nav>

        {/* ── List (독립 스크롤) ── */}
        <main className="flex-1 overflow-y-auto px-6 py-4">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-sm" style={{ color: "var(--text-subtle)" }}>
              {filter === "needsAction" ? "처리 필요한 ETR 이 없습니다 — 모두 검토되었거나 실행 티켓이 연결됨." : "결과가 없습니다."}
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
              {/* Header row — sortable */}
              <div className="flex items-center px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider sticky top-0 z-10"
                style={{ background: "var(--bg-item)", color: "var(--text-subtle)", borderBottom: "1px solid var(--border)" }}>
                <span className="w-6 shrink-0" />
                <SortHead col="key"     label="Key"     className="w-28 shrink-0"        align="left" />
                <SortHead col="summary" label="Summary" className="flex-1 min-w-0 pr-3" align="left" />
                <SortHead col="status"     label="Status"      className="w-32 shrink-0" />
                <SortHead col="assignee"   label="담당자"       className="w-24 shrink-0" />
                <SortHead col="reporter"   label="보고자"       className="w-24 shrink-0" />
                <SortHead col="eta"        label="ETA"          className="w-24 shrink-0" />
                <SortHead col="priority"   label="우선순위"      className="w-16 shrink-0" />
                <SortHead col="linkedWork" label="Linked Work"  className="w-24 shrink-0" />
                <SortHead col="docs"       label="Docs"         className="w-14 shrink-0" />
                <SortHead col="source"     label="Source"       className="w-28 shrink-0" />
                <span className="w-8 shrink-0" />
              </div>

              {/* Rows */}
              {filtered.map(t => {
                const isSelected = selectedKey === t.key;
                const lwSum = deriveLinkedWorkSummary(etrReverseMap.get(t.key) ?? []);
                const docsExist = hasDocs(t.key, etrReverseMap, etrMap, ticketByKey);
                const src = deriveSource(t);
                const reporter = t.requestMeta?.reporter ?? "-";
                const priority = t.requestPriority ?? "-";
                return (
                  <div
                    key={t.key}
                    onClick={() => setSelectedKey(t.key)}
                    className="flex items-center px-4 py-3 cursor-pointer transition-colors text-sm"
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background: isSelected ? "rgba(99,102,241,0.09)" : undefined,
                      borderLeft: isSelected ? "3px solid #6366f1" : "3px solid transparent",
                    }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "var(--bg-item)"; }}
                    onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = ""; }}
                  >
                    <span className="w-6 shrink-0 flex items-center justify-center">
                      <TicketCopyButton ticketKey={t.key} summary={t.summary} size="xs" />
                    </span>
                    <a
                      href={`${JIRA_BASE}${t.key}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="w-28 shrink-0 font-mono text-xs font-semibold text-blue-500 hover:underline truncate"
                    >{t.key}</a>
                    <span
                      className="flex-1 min-w-0 pr-3 font-medium leading-snug"
                      style={{ color: "var(--text-primary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                      title={t.summary}
                    >{t.summary}</span>
                    <span className="w-32 shrink-0 flex justify-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${chip(STATUS_PILL[t.status])}`}>
                        {t.status}
                      </span>
                    </span>
                    <span className="w-24 shrink-0 text-xs text-center truncate" style={{ color: "var(--text-secondary)" }}>{t.assignee || "-"}</span>
                    <span className="w-24 shrink-0 text-xs text-center truncate" style={{ color: "var(--text-secondary)" }}>{reporter}</span>
                    <span className="w-24 shrink-0 text-xs text-center" style={{ color: t.eta && t.eta !== "-" ? "var(--text-primary)" : "var(--text-subtle)" }}>
                      {t.eta && t.eta !== "-" ? t.eta : "—"}
                    </span>
                    <span className="w-16 shrink-0 text-xs text-center" style={{ color: "var(--text-secondary)" }}>{priority}</span>
                    <span className="w-24 shrink-0 flex justify-center">
                      {lwSum.count === 0 ? (
                        <span className="text-[11px]" style={{ color: "var(--text-subtle)" }}>—</span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <span className="text-[11px] font-mono font-semibold" style={{ color: "#34d399" }}>{lwSum.count}</span>
                          {lwSum.representativeStatus && (
                            <span className={`text-[10px] px-1 py-0.5 rounded ${chip(STATUS_PILL[lwSum.representativeStatus])}`}>
                              {lwSum.representativeStatus}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                    <span className="w-14 shrink-0 text-center text-[11px]" style={{ color: docsExist ? "#a78bfa" : "var(--text-subtle)" }}>
                      {docsExist ? "✓" : "—"}
                    </span>
                    <span className="w-28 shrink-0 flex justify-center">
                      <SourceChip source={src} isManual={t.isManual} sourceFilters={t.sourceFilters} />
                    </span>
                    <span className="w-8 shrink-0" />
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* ── Simple Detail Panel (독립 스크롤) ── */}
      {selected && (
        <aside
          className="shrink-0 h-full overflow-y-auto"
          style={{ width: "40%", maxWidth: 600, borderLeft: "1px solid var(--border)", background: "var(--bg-canvas)" }}
        >
          <SimpleDetail
            ticket={selected}
            etrMap={etrMap}
            etrReverseMap={etrReverseMap}
            ticketByKey={ticketByKey}
            memo={selected ? getMemoText(memos[selected.key]) : null}
            onClose={() => setSelectedKey(null)}
            onUnmanage={handleUnmanage}
            onHide={handleHide}
            unManaging={unManaging === selected.key}
            hiding={hidingKey === selected.key}
          />
        </aside>
      )}
    </div>
  );
}

function getMemoText(m: Memo | undefined): string | null {
  if (!m) return null;
  if (typeof m === "string") return m || null;
  return m.text || null;
}

function SourceChip({ source, isManual, sourceFilters }: { source: EtrSource; isManual?: boolean; sourceFilters?: string[] }) {
  const style: Record<EtrSource, { bg: string; color: string; border: string }> = {
    filter:          { bg: "rgba(59,130,246,0.10)",  color: "#60a5fa", border: "rgba(59,130,246,0.3)" },
    manual:          { bg: "rgba(168,85,247,0.10)",  color: "#a78bfa", border: "rgba(168,85,247,0.3)" },
    "filter+manual": { bg: "rgba(16,185,129,0.10)",  color: "#34d399", border: "rgba(16,185,129,0.3)" },
  };
  const s = style[source];
  // 검증용 hover title — 실제 source 정보 노출 (사용자 검증 보조)
  const title = [
    `Filter: ${(sourceFilters?.length ?? 0) > 0 ? sourceFilters!.join(", ") : "(none)"}`,
    `Manual: ${isManual === true ? "true" : "false"}`,
  ].join("\n");
  return (
    <span title={title} className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap cursor-help"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {SOURCE_LABEL[source]}
    </span>
  );
}

// ── Simple Detail (ETR 전용) ────────────────────────────────────────────
function SimpleDetail({
  ticket,
  etrMap,
  etrReverseMap,
  ticketByKey,
  memo,
  onClose,
  onUnmanage,
  onHide,
  unManaging,
  hiding,
}: {
  ticket: Ticket;
  etrMap: Record<string, EtrInfoEntry>;
  etrReverseMap: Map<string, LinkedWork[]>;
  ticketByKey: Map<string, Ticket>;
  memo: string | null;
  onClose: () => void;
  onUnmanage: (key: string) => void;
  onHide: (key: string) => void;
  unManaging: boolean;
  hiding: boolean;
}) {
  const linkedWork: LinkedWork[] = etrReverseMap.get(ticket.key) ?? [];
  const linkedDocs: LinkedDoc[] = collectLinkedDocs(ticket.key, etrReverseMap, etrMap, ticketByKey);
  const src = deriveSource(ticket);
  const reporter = ticket.requestMeta?.reporter ?? "-";

  return (
    <div className="p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <TicketCopyButton ticketKey={ticket.key} summary={ticket.summary} size="xs" />
            <a
              href={`${JIRA_BASE}${ticket.key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs font-semibold text-blue-500 hover:underline"
            >{ticket.key}</a>
            <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${chip(STATUS_PILL[ticket.status])}`}>
              {ticket.status}
            </span>
            <SourceChip source={src} isManual={ticket.isManual} sourceFilters={ticket.sourceFilters} />
          </div>
          <h2 className="text-base font-semibold leading-snug" style={{ color: "var(--text-primary)" }}>{ticket.summary}</h2>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-md text-sm shrink-0"
          style={{ color: "var(--text-subtle)" }}
          title="닫기"
        >×</button>
      </div>

      {/* 요청 메타 */}
      <div className="rounded-lg px-3 py-3 mb-4 grid grid-cols-2 gap-3 text-[12px]" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
        <Meta label="담당자" value={ticket.assignee || "-"} />
        <Meta label="보고자" value={reporter} />
        <Meta label="ETA" value={ticket.eta && ticket.eta !== "-" ? ticket.eta : "미정"} />
        <Meta label="요청 우선순위" value={ticket.requestPriority ?? "-"} />
        {ticket.requestDept && <Meta label="Main Subject" value={ticket.requestDept} />}
        {ticket.bodyRequestDept && <Meta label="요청부문" value={ticket.bodyRequestDept} />}
      </div>

      {/* 메모 */}
      {memo && (
        <div className="rounded-lg px-3 py-2.5 mb-4" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
          <p className="text-[11px] font-semibold mb-1.5" style={{ color: "var(--text-secondary)" }}>메모</p>
          <p className="text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>{memo}</p>
        </div>
      )}

      {/* Linked Work */}
      <div className="rounded-lg px-3 py-2.5 mb-4" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-1.5 mb-2.5">
          <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>Linked Work</p>
          <Tooltip
            content={"이 ETR을 참조해 실행 중인 티켓입니다.\nExecution Status는 보조 정보로만 표시되며,\nETR의 Origin 상태를 대체하지 않습니다."}
            side="bottom"
            maxWidth={240}
          >
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold cursor-default"
              style={{ background: "var(--bg-item)", color: "var(--text-subtle)", border: "1px solid var(--border-2)" }}>?</span>
          </Tooltip>
          {linkedWork.length > 0 && (
            <span className="ml-auto text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>{linkedWork.length}건</span>
          )}
        </div>
        {linkedWork.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--text-subtle)" }}>연결된 실행 티켓 없음</p>
        ) : (
          <div className="space-y-1.5">
            {linkedWork.map(lw => (
              <div key={lw.tmKey} className="rounded-lg px-3 py-2.5" style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)" }}>
                {lw.summary && (
                  <p className="text-[12px] font-medium mb-1.5 leading-snug" style={{ color: "var(--text-primary)" }}>{lw.summary}</p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={`${JIRA_BASE}${lw.tmKey}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[12px] hover:underline shrink-0"
                    style={{ color: "#60a5fa" }}
                  >{lw.tmKey}</a>
                  {lw.level && (
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${chip(TYPE_PILL[lw.level])}`}>
                      {lw.level}
                    </span>
                  )}
                  {lw.status && (
                    <Tooltip content={"Execution Status (보조)\nETR 상태를 대체하지 않습니다."} side="top" maxWidth={200}>
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${chip(STATUS_PILL[lw.status])}`}>
                        {lw.status}
                      </span>
                    </Tooltip>
                  )}
                  {lw.assignee && (
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>담당 {lw.assignee}</span>
                  )}
                  <span className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0"
                    style={{ background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.3)" }}>
                    High
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Linked Docs */}
      <div className="rounded-lg px-3 py-2.5 mb-4" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-1.5 mb-2">
          <p className="text-sm font-semibold" style={{ color: "var(--text-muted)" }}>Linked Docs</p>
          {linkedDocs.length > 0 && (
            <span className="ml-auto text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>{linkedDocs.length}건</span>
          )}
        </div>
        {linkedDocs.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--text-subtle)" }}>연결된 문서 없음</p>
        ) : (
          <div className="space-y-1.5">
            {linkedDocs.map(d => {
              const meta = DOC_TYPE_META[d.type];
              const sourceLabel = d.source.kind === "self" ? "self" : d.source.tmKey;
              return (
                <div key={d.url} className="rounded-lg px-3 py-2 flex items-start gap-2" style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)" }}>
                  <span className="shrink-0 text-[14px] leading-none mt-0.5" aria-hidden>{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-[13px] font-medium hover:underline leading-snug truncate"
                      style={{ color: "var(--text-primary)" }}
                      title={d.url}
                    >{d.title}</a>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px]" style={{ color: "var(--text-subtle)" }}>
                      <span style={{ color: meta.color }}>{meta.label}</span>
                      <span>·</span>
                      <span>{sourceLabel}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 액션: 수동 추적 해제 / 목록에서 숨김 */}
      <div className="rounded-lg px-3 py-3 mb-2" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
        <p className="text-[11px] font-semibold mb-2" style={{ color: "var(--text-muted)" }}>관리</p>
        <div className="flex items-center gap-2 flex-wrap">
          {ticket.isManual ? (
            <button
              onClick={() => onUnmanage(ticket.key)}
              disabled={unManaging}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-40"
              style={{ background: "var(--bg-item)", borderColor: "rgba(168,85,247,0.4)", color: "#a78bfa" }}
              title="cc-custom-keys 에서 제거 — Filter 소스가 있으면 row 는 유지됨"
            >
              {unManaging ? "해제 중…" : "수동 추적 해제"}
            </button>
          ) : (
            <span className="px-3 py-1.5 rounded-lg text-xs border opacity-50" style={{ background: "var(--bg-item)", borderColor: "var(--border-2)", color: "var(--text-subtle)" }}>
              수동 추적 아님 (Filter 소스)
            </span>
          )}
          <button
            onClick={() => onHide(ticket.key)}
            disabled={hiding}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-40"
            style={{ background: "var(--bg-item)", borderColor: "rgba(239,68,68,0.4)", color: "#f87171" }}
            title="cc-hidden-keys 에 추가 — 데이터는 보존, 목록에서만 숨김"
          >
            {hiding ? "숨김 중…" : "목록에서 숨김"}
          </button>
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed" style={{ color: "var(--text-subtle)" }}>
          · <b>수동 추적 해제</b>: cc-custom-keys 에서 제거. Filter 소스가 있으면 row 는 계속 노출됩니다.<br />
          · <b>목록에서 숨김</b>: cc-hidden-keys 에 추가. 데이터는 그대로, row 만 숨김.
        </p>
      </div>

      <Link href="/" className="inline-block text-[11px] mt-3" style={{ color: "var(--text-subtle)" }}>
        ← 전체 과제 현황으로
      </Link>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10.5px] mb-0.5" style={{ color: "var(--text-subtle)" }}>{label}</p>
      <p className="text-[12px] font-medium leading-snug" style={{ color: "var(--text-primary)" }}>{value}</p>
    </div>
  );
}
