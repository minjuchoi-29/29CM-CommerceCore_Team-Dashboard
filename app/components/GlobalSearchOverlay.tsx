"use client";

/**
 * Global Search Overlay — Ctrl/Cmd+F 로 열리는 통합 검색 modal.
 *
 *  - 데이터: /api/jira-tickets (lazy, 첫 open 시점에 fetch + 메모리 캐시)
 *  - 결과: ticket / etr 통합. kind chip + location 표시
 *  - 선택: <Link> 로 destination 이동 (q + ticket/key 자동 seed)
 *  - 키보드: Esc 닫기, ↑↓ 이동, Enter 선택
 *  - Ctrl/Cmd+F 전역 listener — input/textarea/contenteditable focus 중에는 가로채지 않음
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildGlobalSearchResults,
  type GlobalSearchResult,
  type GlobalSearchSourceTicket,
} from "@/lib/global-search";

type TicketsResponse = { tickets?: GlobalSearchSourceTicket[] };

export default function GlobalSearchOverlay() {
  const [isOpen, setIsOpen]   = useState(false);
  const [query, setQuery]     = useState("");
  const [tickets, setTickets] = useState<GlobalSearchSourceTicket[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);

  const open = useCallback(() => {
    setIsOpen(true);
    setActiveIdx(0);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Ctrl/Cmd+F 전역 listener.
  // input/textarea/contenteditable focus 중에는 가로채지 않음 — 브라우저 기본 검색 유지.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" && e.key !== "F") return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName?.toLowerCase();
      // overlay 자체 안의 input 은 이미 가로채야 함 (re-focus 용도)
      const isInsideOverlay = tgt?.closest?.("[data-global-search-overlay]");
      if (!isInsideOverlay && (tag === "input" || tag === "textarea" || tgt?.isContentEditable)) return;
      e.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 첫 open 시 lazy fetch
  useEffect(() => {
    if (!isOpen) return;
    if (tickets !== null) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/jira-tickets")
      .then(r => r.ok ? r.json() as Promise<TicketsResponse> : Promise.reject(new Error(String(r.status))))
      .then(data => {
        if (cancelled) return;
        const arr = Array.isArray(data?.tickets) ? data.tickets : [];
        setTickets(arr);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTickets([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen, tickets]);

  // open 시 input focus
  useEffect(() => {
    if (!isOpen) return;
    const id = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 20);
    return () => clearTimeout(id);
  }, [isOpen]);

  const results: GlobalSearchResult[] = useMemo(() => {
    if (!isOpen) return [];
    return buildGlobalSearchResults(query, tickets ?? [], { limit: 30 });
  }, [isOpen, query, tickets]);

  // query 변경 시 active index 리셋
  useEffect(() => { setActiveIdx(0); }, [query]);

  // 활성 결과 스크롤
  useEffect(() => {
    if (!isOpen) return;
    const node = listRef.current?.querySelector<HTMLAnchorElement>(`[data-idx="${activeIdx}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, isOpen]);

  const navigateTo = useCallback((dest: string) => {
    close();
    setQuery("");
    window.location.href = dest;
  }, [close]);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (query) {
        setQuery("");
      } else {
        close();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, Math.max(results.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      const target = results[activeIdx];
      if (target) {
        e.preventDefault();
        navigateTo(target.destination);
      }
      return;
    }
  };

  if (!isOpen) return null;

  return (
    <div
      data-global-search-overlay
      role="dialog"
      aria-modal="true"
      aria-label="Dashboard 통합 검색"
      className="fixed inset-0 z-[1000] flex items-start justify-center"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", paddingTop: "12vh" }}
      onClick={close}
    >
      <div
        className="w-[640px] max-w-[92vw] rounded-xl overflow-hidden shadow-2xl"
        style={{ background: "var(--bg-canvas)", border: "1px solid var(--border)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Input row */}
        <div
          className="flex items-center gap-2 px-3 py-2.5"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="티켓 / ETR / 담당자 / 상태 통합 검색…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--text-primary)" }}
            aria-label="통합 검색"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); inputRef.current?.focus(); }}
              title="검색어 지우기 (Esc)"
              aria-label="검색어 지우기"
              className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold transition-colors"
              style={{ color: "var(--text-muted)", background: "var(--border-2)" }}
            >×</button>
          )}
          <button
            type="button"
            onClick={close}
            title="닫기 (Esc)"
            aria-label="닫기"
            className="text-[11px] font-medium px-2 py-1 rounded"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border-2)" }}
          >Esc</button>
        </div>

        {/* Result list */}
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
          {loading && tickets === null && (
            <div className="px-4 py-6 text-center text-sm" style={{ color: "var(--text-subtle)" }}>
              로드 중…
            </div>
          )}
          {!loading && query.trim() && results.length === 0 && (
            <div className="px-4 py-6 text-center text-sm" style={{ color: "var(--text-subtle)" }}>
              <span className="font-mono font-semibold" style={{ color: "var(--text-secondary)" }}>“{query}”</span>
              {" "}에 대한 결과가 없습니다.
            </div>
          )}
          {!loading && !query.trim() && (
            <div className="px-4 py-6 text-center text-sm" style={{ color: "var(--text-subtle)" }}>
              검색어를 입력하세요.
              <div className="mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                ↑ ↓ 이동 · Enter 선택 · Esc 닫기
              </div>
            </div>
          )}
          {results.map((r, idx) => {
            const isActive = idx === activeIdx;
            const kindStyle = r.kind === "etr"
              ? { background: "rgba(168,85,247,0.18)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.40)" }
              : { background: "rgba(99,102,241,0.18)",  color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.40)" };
            return (
              <a
                key={r.key}
                href={r.destination}
                data-idx={idx}
                onClick={e => { e.preventDefault(); navigateTo(r.destination); }}
                onMouseEnter={() => setActiveIdx(idx)}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors"
                style={{
                  background: isActive ? "var(--bg-item)" : "transparent",
                  borderBottom: "1px solid var(--border)",
                  color: "var(--text-primary)",
                  textDecoration: "none",
                }}
              >
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
                  style={kindStyle}
                  aria-label={`종류: ${r.kind}`}
                >
                  {r.kind === "etr" ? "ETR" : "TICKET"}
                </span>
                <span className="font-mono text-xs font-semibold shrink-0" style={{ color: "#a5b4fc", width: 110 }}>
                  {r.key}
                </span>
                <span className="flex-1 min-w-0 truncate text-sm" title={r.summary}>
                  {r.summary || <span style={{ color: "var(--text-muted)" }}>(제목 없음)</span>}
                </span>
                <span className="text-[10.5px] shrink-0 px-1.5 py-0.5 rounded" style={{ background: "var(--bg-overlay)", color: "var(--text-secondary)" }}>
                  {r.status || "—"}
                </span>
                <span className="text-[10.5px] shrink-0 truncate" style={{ color: "var(--text-muted)", maxWidth: 90 }}>
                  {r.assignee || "—"}
                </span>
                <span className="text-[10px] shrink-0" style={{ color: "var(--text-subtle)" }} title={`위치: ${r.location}`}>
                  → {r.location}
                </span>
              </a>
            );
          })}
        </div>

        {/* footer hint */}
        <div
          className="flex items-center justify-between gap-2 px-3 py-1.5 text-[10.5px]"
          style={{ borderTop: "1px solid var(--border)", color: "var(--text-subtle)", background: "var(--bg-overlay)" }}
        >
          <span>Ctrl+F / Cmd+F 로 다시 열림</span>
          <span>{results.length}건</span>
        </div>
      </div>
    </div>
  );
}
