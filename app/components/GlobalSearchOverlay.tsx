"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  buildGlobalSearchResults,
  type GlobalSearchResult,
  type GlobalSearchSourceTicket,
} from "@/lib/global-search";
import {
  filterTicketsByManagedArea,
  getManagedTicketArea,
  getManagedTicketAreaLabel,
  getManagedTicketDestination,
  invalidManagedTicketKeys,
  parseManagedTicketKeys,
  type ManagedTicketArea,
} from "@/lib/dashboard-ticket-actions";
import {
  DASHBOARD_JIRA_SYNC_REQUEST_EVENT,
  DASHBOARD_JIRA_SYNC_STATE_EVENT,
  DASHBOARD_LIST_CONTEXT_EVENT,
  DASHBOARD_SEARCH_CHANGE_EVENT,
  DASHBOARD_TICKET_INDEX_EVENT,
  DASHBOARD_TICKETS_ADDED_EVENT,
  type DashboardJiraSyncStateDetail,
  type DashboardListContextDetail,
  type DashboardTicketIndexDetail,
} from "@/lib/dashboard-events";
import { setSearchTarget } from "@/lib/search-target";

type SearchTicket = GlobalSearchSourceTicket & {
  status: string;
  statusCategory?: string;
  resolutionDate?: string;
  updatedAt?: string;
};

type TicketsResponse = { tickets?: SearchTicket[] };

type AddOutcome = {
  ticket: SearchTicket;
  added: boolean;
};

const SUPPORTED_PATHS = new Set(["/", "/etr-review"]);
const AREA_OPTIONS: Array<{ value: ManagedTicketArea | "all"; label: string }> = [
  { value: "all", label: "전체 상태" },
  { value: "active", label: "진행 중" },
  { value: "planning", label: "플래닝 대기·검토" },
  { value: "done", label: "완료" },
  { value: "etr", label: "ETR 검토" },
];

function uniqueSorted(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(value => value?.trim()).filter((value): value is string => !!value))]
    .sort((a, b) => a.localeCompare(b, "ko"));
}

function mergeTickets(current: SearchTicket[], next: SearchTicket[]): SearchTicket[] {
  const byKey = new Map(current.map(ticket => [ticket.key, ticket]));
  for (const ticket of next) byKey.set(ticket.key, ticket);
  return [...byKey.values()];
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export default function GlobalSearchOverlay() {
  const pathname = usePathname();
  const supported = SUPPORTED_PATHS.has(pathname);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tickets, setTickets] = useState<SearchTicket[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [applyToCurrentList, setApplyToCurrentList] = useState(true);
  const [areaFilter, setAreaFilter] = useState<ManagedTicketArea | "all">("all");
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [listContext, setListContext] = useState<DashboardListContextDetail | null>(null);
  const [syncState, setSyncState] = useState<DashboardJiraSyncStateDetail>({ running: false });

  const [addOpen, setAddOpen] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addProgress, setAddProgress] = useState<{ current: number; total: number } | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [addOutcomes, setAddOutcomes] = useState<AddOutcome[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const addTimerRef = useRef<number | null>(null);

  const loadTickets = useCallback(async () => {
    if (tickets !== null || loading) return;
    setLoading(true);
    try {
      const response = await fetchWithTimeout("/api/jira-tickets", { cache: "no-store" });
      const data = await response.json() as TicketsResponse & { error?: string };
      if (!response.ok) throw new Error(data.error ?? `티켓 조회 실패 (${response.status})`);
      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [loading, tickets]);

  useEffect(() => {
    const onIndex = (event: Event) => {
      const detail = (event as CustomEvent<DashboardTicketIndexDetail<SearchTicket>>).detail;
      if (Array.isArray(detail?.tickets)) setTickets(detail.tickets);
    };
    const onContext = (event: Event) => {
      const detail = (event as CustomEvent<DashboardListContextDetail>).detail;
      if (detail?.scope && Array.isArray(detail.keys)) setListContext(detail);
    };
    const onSyncState = (event: Event) => {
      const detail = (event as CustomEvent<DashboardJiraSyncStateDetail>).detail;
      if (detail && typeof detail.running === "boolean") setSyncState(detail);
    };
    window.addEventListener(DASHBOARD_TICKET_INDEX_EVENT, onIndex);
    window.addEventListener(DASHBOARD_LIST_CONTEXT_EVENT, onContext);
    window.addEventListener(DASHBOARD_JIRA_SYNC_STATE_EVENT, onSyncState);
    return () => {
      window.removeEventListener(DASHBOARD_TICKET_INDEX_EVENT, onIndex);
      window.removeEventListener(DASHBOARD_LIST_CONTEXT_EVENT, onContext);
      window.removeEventListener(DASHBOARD_JIRA_SYNC_STATE_EVENT, onSyncState);
    };
  }, []);

  useEffect(() => {
    if (!supported) return;
    const params = new URLSearchParams(window.location.search);
    const nextQuery = params.get("q") ?? "";
    setQuery(nextQuery);
    setSearchOpen(false);
    setAddOpen(false);
    setAreaFilter("all");
    setProjectFilter("");
    setStatusFilter("");
    setAssigneeFilter("");
    setListContext(null);
  }, [pathname, supported]);

  useEffect(() => {
    if (!supported) return;
    window.dispatchEvent(new CustomEvent(DASHBOARD_SEARCH_CHANGE_EVENT, {
      detail: { query, applyToCurrentList },
    }));
  }, [applyToCurrentList, query, supported]);

  const openSearch = useCallback(() => {
    if (!supported) return;
    setSearchOpen(true);
    setActiveIdx(0);
    void loadTickets();
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [loadTickets, supported]);

  useEffect(() => {
    if (!supported) return;
    const onKey = (event: KeyboardEvent) => {
      const wantsSearch = (event.metaKey || event.ctrlKey) && ["f", "F", "k", "K"].includes(event.key);
      if (!wantsSearch) return;
      const target = event.target as HTMLElement | null;
      const isOwnInput = target === inputRef.current;
      const tag = target?.tagName.toLowerCase();
      if (!isOwnInput && (tag === "input" || tag === "textarea" || target?.isContentEditable)) return;
      event.preventDefault();
      openSearch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSearch, supported]);

  const availableProjects = useMemo(() => uniqueSorted((tickets ?? []).map(ticket => ticket.project)), [tickets]);
  const availableStatuses = useMemo(() => uniqueSorted((tickets ?? []).map(ticket => ticket.status)), [tickets]);
  const availableAssignees = useMemo(() => uniqueSorted((tickets ?? []).map(ticket => ticket.assignee)), [tickets]);

  const scopedTickets = useMemo(() => {
    let next = tickets ?? [];
    if (applyToCurrentList) {
      const currentScope = pathname === "/etr-review" ? "etr" : "tickets";
      if (listContext?.scope === currentScope) {
        const visibleKeys = new Set(listContext.keys);
        next = next.filter(ticket => visibleKeys.has(ticket.key));
      } else if (currentScope === "etr") {
        next = next.filter(ticket => getManagedTicketArea(ticket) === "etr");
      } else {
        next = next.filter(ticket => getManagedTicketArea(ticket) !== "etr");
      }
    }
    next = filterTicketsByManagedArea(next, areaFilter);
    if (projectFilter) next = next.filter(ticket => ticket.project === projectFilter);
    if (statusFilter) next = next.filter(ticket => ticket.status === statusFilter);
    if (assigneeFilter) next = next.filter(ticket => ticket.assignee === assigneeFilter);
    return next;
  }, [applyToCurrentList, areaFilter, assigneeFilter, listContext, pathname, projectFilter, statusFilter, tickets]);

  const results = useMemo(
    () => buildGlobalSearchResults(query, scopedTickets, { limit: 30 }),
    [query, scopedTickets],
  );

  const ticketByKey = useMemo(() => new Map((tickets ?? []).map(ticket => [ticket.key, ticket])), [tickets]);

  useEffect(() => setActiveIdx(0), [query, areaFilter, projectFilter, statusFilter, assigneeFilter, applyToCurrentList]);

  useEffect(() => {
    if (!searchOpen) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-search-index="${activeIdx}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, searchOpen]);

  const navigateToResult = useCallback((result: GlobalSearchResult) => {
    setSearchTarget({
      kind: result.kind,
      key: result.key,
      query,
      focus: result.kind === "ticket",
      createdAt: Date.now(),
    });
    window.location.href = result.destination;
  }, [query]);

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (query) setQuery("");
      else setSearchOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIdx(index => Math.min(index + 1, Math.max(results.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIdx(index => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter" && results[activeIdx]) {
      event.preventDefault();
      navigateToResult(results[activeIdx]);
    }
  }

  function openAddDialog() {
    setSearchOpen(false);
    setAddOpen(true);
    setAddInput("");
    setAddError(null);
    setAddOutcomes([]);
    setAddProgress(null);
    void loadTickets();
  }

  function closeAddDialog() {
    if (adding) return;
    if (addTimerRef.current) window.clearTimeout(addTimerRef.current);
    setAddOpen(false);
  }

  function navigateAddedTicket(ticket: SearchTicket) {
    const destination = getManagedTicketDestination(ticket);
    setSearchTarget({
      kind: destination.area === "etr" ? "etr" : "ticket",
      key: ticket.key,
      query: "",
      focus: false,
      createdAt: Date.now(),
    });
    window.location.href = destination.href;
  }

  async function addManagedTickets() {
    const keys = parseManagedTicketKeys(addInput);
    if (keys.length === 0) return;
    const invalid = invalidManagedTicketKeys(keys);
    if (invalid.length > 0) {
      setAddError(`형식을 확인해주세요: ${invalid.join(", ")} (예: TM-1234, ETR-3427)`);
      return;
    }

    setAdding(true);
    setAddError(null);
    setAddOutcomes([]);

    const knownByKey = new Map((tickets ?? []).map(ticket => [ticket.key, ticket]));
    const outcomes: AddOutcome[] = [];
    const fetched: SearchTicket[] = [];
    const failed: string[] = [];

    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      setAddProgress({ current: index + 1, total: keys.length });
      const known = knownByKey.get(key);
      if (known) {
        outcomes.push({ ticket: known, added: false });
        continue;
      }
      try {
        const response = await fetchWithTimeout(`/api/jira-tickets/single?key=${encodeURIComponent(key)}&strict=1`, { cache: "no-store" });
        const data = await response.json() as { ticket?: SearchTicket; error?: string };
        if (!response.ok || !data.ticket) {
          failed.push(key);
          continue;
        }
        fetched.push(data.ticket);
        outcomes.push({ ticket: data.ticket, added: true });
      } catch {
        failed.push(key);
      }
    }

    if (fetched.length > 0) {
      try {
        const response = await fetchWithTimeout("/api/tickets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "add", keys: fetched.map(ticket => ticket.key) }),
        });
        const data = await response.json() as { ok?: boolean; error?: string };
        if (!response.ok || data.ok !== true) throw new Error(data.error ?? "공용 티켓 목록 저장에 실패했습니다.");
      } catch (error) {
        setAddError(error instanceof Error ? error.message : "공용 티켓 목록 저장에 실패했습니다.");
        setAdding(false);
        setAddProgress(null);
        return;
      }

      const merged = mergeTickets(tickets ?? [], fetched);
      setTickets(merged);
      window.dispatchEvent(new CustomEvent(DASHBOARD_TICKETS_ADDED_EVENT, { detail: { tickets: fetched } }));

      const executionKeys = fetched
        .filter(ticket => getManagedTicketArea(ticket) !== "etr")
        .map(ticket => ticket.key);
      if (executionKeys.length > 0) {
        fetch("/api/sheet-append", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keys: executionKeys }),
        }).catch(() => {});
      }
    }

    setAddOutcomes(outcomes);
    setAdding(false);
    setAddProgress(null);
    if (failed.length > 0) setAddError(`Jira에서 확인하지 못한 티켓: ${failed.join(", ")}`);

    const successfulAdds = outcomes.filter(outcome => outcome.added);
    if (successfulAdds.length === 1 && failed.length === 0 && keys.length === 1) {
      addTimerRef.current = window.setTimeout(() => navigateAddedTicket(successfulAdds[0].ticket), 900);
    }
  }

  function requestJiraSync() {
    setSyncState({ running: true, label: "동기화 준비 중…" });
    window.dispatchEvent(new CustomEvent(DASHBOARD_JIRA_SYNC_REQUEST_EVENT));
  }

  if (!supported) return null;

  const currentContextLabel = listContext?.label ?? (pathname === "/etr-review" ? "ETR 검토" : "전체 과제 현황");

  return (
    <>
      <header
        className="sticky top-14 z-[190] h-14 shrink-0 flex items-center gap-3 px-4"
        style={{ background: "var(--bg-canvas)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="relative flex-1 max-w-[620px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#52677b" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onFocus={openSearch}
            onChange={event => { setQuery(event.target.value); setSearchOpen(true); }}
            onKeyDown={handleSearchKeyDown}
            placeholder="등록된 티켓 번호 · 제목 · 담당자 검색"
            aria-label="등록된 티켓 통합 검색"
            className="w-full h-9 pl-9 pr-24 rounded-lg text-[13px] outline-none"
            style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded"
            style={{ color: "var(--text-subtle)", border: "1px solid var(--border)" }}>⌘ K</span>
        </div>
        <button
          type="button"
          onClick={openAddDialog}
          className="h-9 inline-flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold"
          style={{ background: "#17324d", border: "1px solid #17324d", color: "white" }}
        >
          <span className="text-base leading-none">＋</span><span className="hidden sm:inline">티켓 추가</span>
        </button>
        <button
          type="button"
          onClick={requestJiraSync}
          disabled={syncState.running}
          className="h-9 inline-flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold disabled:opacity-50"
          style={{ background: "var(--bg-item)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}
          title="현재 메뉴 정책에 맞는 Jira 티켓을 갱신합니다."
        >
          <svg className={`w-3.5 h-3.5 ${syncState.running ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/>
          </svg>
          <span className="hidden md:inline">{syncState.running ? (syncState.label ?? "Sync 중…") : "Jira Sync"}</span>
        </button>

        {searchOpen && (
          <>
            <button type="button" className="fixed inset-0 z-[-1] cursor-default" aria-label="검색 닫기" onClick={() => setSearchOpen(false)} />
            <section
              role="dialog"
              aria-label="등록 티켓 통합 검색"
              className="absolute left-4 right-4 top-[calc(100%+6px)] max-w-[760px] rounded-xl overflow-hidden shadow-2xl"
              style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)" }}
            >
              <div className="flex items-center gap-2 flex-wrap px-3 py-2.5" style={{ background: "var(--bg-overlay)", borderBottom: "1px solid var(--border)" }}>
                <label className="inline-flex items-center gap-2 pr-3 mr-1 text-xs" style={{ color: "var(--text-secondary)", borderRight: "1px solid var(--border)" }}>
                  <input type="checkbox" checked={applyToCurrentList} onChange={event => setApplyToCurrentList(event.target.checked)} />
                  현재 목록 조건 적용
                </label>
                {applyToCurrentList && (
                  <span className="text-[11px] px-2 py-1 rounded-md font-medium" style={{ background: "rgba(47,125,134,0.12)", color: "#2f7d86" }}>
                    {currentContextLabel}
                  </span>
                )}
                <select value={areaFilter} onChange={event => setAreaFilter(event.target.value as ManagedTicketArea | "all")}
                  className="h-7 px-2 rounded-md text-[11px]" style={{ background: "var(--bg-item)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}>
                  {AREA_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <select value={projectFilter} onChange={event => setProjectFilter(event.target.value)}
                  className="h-7 px-2 rounded-md text-[11px]" style={{ background: "var(--bg-item)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}>
                  <option value="">프로젝트 전체</option>
                  {availableProjects.map(project => <option key={project} value={project}>{project}</option>)}
                </select>
                <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}
                  className="h-7 px-2 rounded-md text-[11px] max-w-40" style={{ background: "var(--bg-item)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}>
                  <option value="">상태 전체</option>
                  {availableStatuses.map(status => <option key={status} value={status}>{status}</option>)}
                </select>
                <select value={assigneeFilter} onChange={event => setAssigneeFilter(event.target.value)}
                  className="h-7 px-2 rounded-md text-[11px] max-w-36" style={{ background: "var(--bg-item)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}>
                  <option value="">담당자 전체</option>
                  {availableAssignees.map(assignee => <option key={assignee} value={assignee}>{assignee}</option>)}
                </select>
              </div>
              <div ref={listRef} className="max-h-[56vh] overflow-y-auto">
                {loading && tickets === null ? (
                  <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>등록 티켓을 불러오는 중…</div>
                ) : !query.trim() ? (
                  <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>검색어를 입력하세요.</div>
                ) : results.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>현재 조건에 맞는 등록 티켓이 없습니다.</div>
                ) : results.map((result, index) => {
                  const sourceTicket = ticketByKey.get(result.key);
                  const area = sourceTicket ? getManagedTicketArea(sourceTicket) : (result.kind === "etr" ? "etr" : "active");
                  return (
                    <button
                      key={result.key}
                      type="button"
                      data-search-index={index}
                      onMouseEnter={() => setActiveIdx(index)}
                      onClick={() => navigateToResult(result)}
                      className="w-full grid grid-cols-[94px_minmax(0,1fr)_100px_84px] gap-2 items-center px-4 py-2.5 text-left transition-colors"
                      style={{ background: index === activeIdx ? "rgba(47,125,134,0.09)" : "transparent", borderBottom: "1px solid var(--border)" }}
                    >
                      <span className="font-mono text-xs font-semibold" style={{ color: "#245673" }}>{result.key}</span>
                      <span className="truncate text-[13px]" style={{ color: "var(--text-primary)" }}>{result.summary || "(제목 없음)"}</span>
                      <span className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>{result.assignee || "담당자 미정"}</span>
                      <span className="text-[10px] text-right font-medium" style={{ color: "#2f7d86" }}>{getManagedTicketAreaLabel(area)}</span>
                    </button>
                  );
                })}
              </div>
              <footer className="flex justify-between px-3 py-2 text-[10px]" style={{ background: "var(--bg-overlay)", color: "var(--text-subtle)" }}>
                <span>대시보드에 등록된 티켓만 검색</span><span>{results.length}건 · ↑↓ 이동 · Enter 열기</span>
              </footer>
            </section>
          </>
        )}
      </header>

      {addOpen && (
        <div className="fixed inset-0 z-[1000] flex items-start justify-center px-4 pt-[12vh]" style={{ background: "rgba(15,23,42,0.38)" }} onMouseDown={event => { if (event.target === event.currentTarget) closeAddDialog(); }}>
          <section role="dialog" aria-modal="true" aria-label="티켓 추가" className="w-full max-w-[540px] rounded-xl overflow-hidden shadow-2xl" style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)" }}>
            <header className="flex items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
              <div><h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>티켓 추가</h2><p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Jira 프로젝트와 상태를 확인해 적절한 목록으로 자동 분류합니다.</p></div>
              <button type="button" onClick={closeAddDialog} disabled={adding} aria-label="닫기" className="w-7 h-7 rounded-md disabled:opacity-40" style={{ background: "var(--bg-item)", color: "var(--text-muted)" }}>×</button>
            </header>
            <div className="px-5 py-4">
              {addOutcomes.length === 0 ? (
                <>
                  <label htmlFor="global-ticket-add-input" className="block text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>Jira 티켓 번호</label>
                  <textarea
                    id="global-ticket-add-input"
                    autoFocus
                    value={addInput}
                    onChange={event => { setAddInput(event.target.value.toUpperCase()); setAddError(null); }}
                    placeholder="TM-1234, ETR-3427"
                    className="w-full min-h-20 px-3 py-2.5 rounded-lg text-sm font-mono outline-none resize-none"
                    style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-2)", color: "var(--text-primary)" }}
                  />
                  <p className="mt-2 text-[11px]" style={{ color: "var(--text-subtle)" }}>공백 또는 쉼표로 여러 개를 추가할 수 있습니다. 실제 Jira에서 확인되는 티켓만 공용 목록에 저장됩니다.</p>
                  <div className="grid grid-cols-2 gap-2 mt-4 text-[11px]">
                    {["공용 저장 · 다른 사용자에게도 반영", "프로젝트 · Jira 상태 기준 자동 분류", "기존 수동 일정과 메모 보호", "단일 추가 후 해당 목록 자동 이동"].map(text => (
                      <div key={text} className="px-3 py-2 rounded-lg" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>✓ {text}</div>
                    ))}
                  </div>
                </>
              ) : (
                <div>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center mb-3" style={{ background: "rgba(31,112,93,0.12)", color: "#1f705d" }}>✓</div>
                  <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>분류 결과</h3>
                  <div className="mt-3 space-y-2">
                    {addOutcomes.map(outcome => {
                      const destination = getManagedTicketDestination(outcome.ticket);
                      return (
                        <button key={outcome.ticket.key} type="button" onClick={() => navigateAddedTicket(outcome.ticket)} className="w-full grid grid-cols-[88px_minmax(0,1fr)_auto] gap-2 items-center px-3 py-2.5 rounded-lg text-left" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}>
                          <span className="font-mono text-xs font-semibold" style={{ color: "#245673" }}>{outcome.ticket.key}</span>
                          <span className="truncate text-xs" style={{ color: "var(--text-primary)" }}>{outcome.ticket.summary || "(제목 없음)"}</span>
                          <span className="text-[10px] font-semibold" style={{ color: outcome.added ? "#1f705d" : "var(--text-muted)" }}>{outcome.added ? destination.label : "이미 등록됨"} →</span>
                        </button>
                      );
                    })}
                  </div>
                  {addOutcomes.length === 1 && addOutcomes[0].added && !addError && <p className="mt-3 text-[11px]" style={{ color: "var(--text-muted)" }}>잠시 후 {getManagedTicketDestination(addOutcomes[0].ticket).label} 목록으로 이동합니다.</p>}
                </div>
              )}
              {addError && <p className="mt-3 text-xs" style={{ color: "#dc2626" }}>{addError}</p>}
            </div>
            <footer className="flex items-center justify-end gap-2 px-5 py-3" style={{ background: "var(--bg-overlay)", borderTop: "1px solid var(--border)" }}>
              {addOutcomes.length > 0 ? (
                <>
                  <button type="button" onClick={() => { if (addTimerRef.current) window.clearTimeout(addTimerRef.current); setAddOutcomes([]); setAddInput(""); setAddError(null); }} className="h-8 px-3 rounded-lg text-xs font-semibold" style={{ background: "var(--bg-item)", border: "1px solid var(--border-2)", color: "var(--text-secondary)" }}>다른 티켓 추가</button>
                  <button type="button" onClick={closeAddDialog} className="h-8 px-3 rounded-lg text-xs font-semibold" style={{ background: "#17324d", color: "white" }}>닫기</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={closeAddDialog} disabled={adding} className="h-8 px-3 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: "var(--bg-item)", border: "1px solid var(--border-2)", color: "var(--text-secondary)" }}>취소</button>
                  <button type="button" onClick={() => { void addManagedTickets(); }} disabled={adding || !addInput.trim()} className="h-8 px-3 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: "#17324d", color: "white" }}>{adding ? (addProgress ? `${addProgress.current}/${addProgress.total} 확인 중…` : "확인 중…") : "Jira 확인 후 추가"}</button>
                </>
              )}
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
