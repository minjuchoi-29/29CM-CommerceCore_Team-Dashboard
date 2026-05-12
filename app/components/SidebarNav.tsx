"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/app/components/ThemeProvider";
import GuideModal from "@/app/components/GuideModal";
import QuickLinksModal from "@/app/components/QuickLinksModal";

type Props = {
  user?: { name?: string | null; email?: string | null };
  logoutAction: () => Promise<void>;
};

export default function SidebarNav({ user, logoutAction }: Props) {
  const [visible, setVisible] = useState(true);
  const [guideOpen, setGuideOpen] = useState(false);
  const [quickLinksOpen, setQuickLinksOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const pathname = usePathname();

  useEffect(() => {
    function handler(e: Event) {
      const { open } = (e as CustomEvent<{ open: boolean }>).detail;
      setVisible(!open);
    }
    window.addEventListener("detail-panel", handler);
    return () => window.removeEventListener("detail-panel", handler);
  }, []);

  if (!visible) {
    return (
      <aside className="w-10 h-screen sticky top-0 flex flex-col items-center shrink-0" style={{ background: "var(--bg-sidebar)", borderRight: "1px solid var(--border)" }}>
        <button
          onClick={() => setVisible(true)}
          title="메뉴 펼치기"
          className="mt-4 w-7 h-7 flex items-center justify-center rounded-lg transition-colors text-xs"
          style={{ background: "var(--bg-item)", border: "1px solid var(--border-2)", color: "var(--text-muted)" }}
        >
          »
        </button>
        {user && (
          <form action={logoutAction} className="mt-auto pb-4">
            <button
              type="submit"
              title="로그아웃"
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              ↩
            </button>
          </form>
        )}
      </aside>
    );
  }

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside className="w-52 h-screen sticky top-0 flex flex-col shrink-0" style={{ background: "var(--bg-sidebar)", borderRight: "1px solid var(--border)" }}>

      {/* 헤더 */}
      <div className="px-4 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
            <span className="text-[10px] font-bold text-white">29</span>
          </div>
          <div>
            <h1 className="text-xs font-bold leading-tight" style={{ color: "var(--text-primary)" }}>29CM</h1>
            <p className="text-[10px] leading-tight" style={{ color: "var(--text-subtle)" }}>Commerce Core</p>
          </div>
        </div>
        <button
          onClick={() => setVisible(false)}
          title="메뉴 접기"
          className="w-6 h-6 flex items-center justify-center rounded-md transition-all text-xs shrink-0"
          style={{ color: "var(--text-subtle)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; (e.currentTarget as HTMLElement).style.background = "var(--bg-item)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-subtle)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        >
          «
        </button>
      </div>

      {/* 메인 메뉴 */}
      <div className="px-3 pt-3 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-1.5" style={{ color: "var(--text-subtle)" }}>메뉴</p>
        <nav className="flex flex-col gap-0.5">
          <Link
            href="/"
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-all"
            style={{
              background: isActive("/") ? "var(--bg-item)" : "transparent",
              color: isActive("/") ? "var(--text-primary)" : "var(--text-muted)",
              borderLeft: isActive("/") ? "2px solid #6366f1" : "2px solid transparent",
            }}
            onMouseEnter={e => {
              if (!isActive("/")) {
                (e.currentTarget as HTMLElement).style.background = "var(--bg-item)";
                (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
              }
            }}
            onMouseLeave={e => {
              if (!isActive("/")) {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
              }
            }}
          >
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
            전체 과제 보기
          </Link>
          <Link
            href="/monthly"
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-all"
            style={{
              background: isActive("/monthly") ? "var(--bg-item)" : "transparent",
              color: isActive("/monthly") ? "var(--text-primary)" : "var(--text-muted)",
              borderLeft: isActive("/monthly") ? "2px solid #6366f1" : "2px solid transparent",
            }}
            onMouseEnter={e => {
              if (!isActive("/monthly")) {
                (e.currentTarget as HTMLElement).style.background = "var(--bg-item)";
                (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
              }
            }}
            onMouseLeave={e => {
              if (!isActive("/monthly")) {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
              }
            }}
          >
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            월별 진행 현황
          </Link>
        </nav>
      </div>

      {/* 구분선 */}
      <div className="mx-3" style={{ borderTop: "1px solid var(--border)" }} />

      {/* 도구 섹션 */}
      <div className="px-3 pt-3 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-1.5" style={{ color: "var(--text-subtle)" }}>도구</p>
        <div className="flex flex-col gap-0.5">

          {/* 사용 가이드 */}
          <button
            onClick={() => setGuideOpen(true)}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-all w-full text-left"
            style={{
              color: "var(--text-muted)",
              borderLeft: "2px solid transparent",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "var(--bg-item)";
              (e.currentTarget as HTMLElement).style.color = "#60a5fa";
              (e.currentTarget as HTMLElement).style.borderLeftColor = "#60a5fa";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
              (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent";
            }}
          >
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
            <span className="flex-1">사용 가이드</span>
            <svg className="w-3 h-3 shrink-0 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </button>

          {/* 퀵 링크 */}
          <button
            onClick={() => setQuickLinksOpen(true)}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-all w-full text-left"
            style={{
              color: "var(--text-muted)",
              borderLeft: "2px solid transparent",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "var(--bg-item)";
              (e.currentTarget as HTMLElement).style.color = "#34d399";
              (e.currentTarget as HTMLElement).style.borderLeftColor = "#34d399";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
              (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent";
            }}
          >
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            <span className="flex-1">퀵 링크</span>
            <svg className="w-3 h-3 shrink-0 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>

        </div>
      </div>

      {guideOpen && <GuideModal onClose={() => setGuideOpen(false)} />}
      {quickLinksOpen && <QuickLinksModal onClose={() => setQuickLinksOpen(false)} />}

      {/* 구분선 */}
      <div className="mx-3" style={{ borderTop: "1px solid var(--border)" }} />

      {/* 테마 토글 */}
      <div className="px-3 pt-3 pb-2">
        <button
          onClick={toggle}
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-all w-full text-left"
          style={{
            color: "var(--text-muted)",
            borderLeft: "2px solid transparent",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "var(--bg-item)";
            (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
          }}
        >
          {isDark ? (
            <>
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
              </svg>
              라이트 모드로 전환
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
              다크 모드로 전환
            </>
          )}
        </button>
      </div>

      {/* 유저 프로필 */}
      {user && (
        <div className="mt-auto px-3 py-3" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 px-2 py-2 rounded-md mb-1" style={{ background: "var(--bg-item)" }}>
            <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold text-white" style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
              {user.name?.charAt(0) ?? "?"}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium truncate leading-tight" style={{ color: "var(--text-primary)" }}>{user.name}</p>
              <p className="text-[10px] truncate leading-tight" style={{ color: "var(--text-subtle)" }}>{user.email}</p>
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <a
              href="https://docs.google.com/spreadsheets/d/1uCR-MCNpXO9b8iXIFZMgQIG-z54rzbVi4AN_1TtiSMw/edit?gid=0#gid=0"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs transition-all"
              style={{ color: "var(--text-muted)", borderLeft: "2px solid transparent" }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "var(--bg-item)";
                (e.currentTarget as HTMLElement).style.color = "#34d399";
                (e.currentTarget as HTMLElement).style.borderLeftColor = "#34d399";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
                (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent";
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0" style={{ color: "#34d399" }}>
                <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm4.75 6.75a.75.75 0 011.5 0v2.546l.943-1.048a.75.75 0 111.114 1.004l-2.25 2.5a.75.75 0 01-1.114 0l-2.25-2.5a.75.75 0 111.114-1.004l.943 1.048V8.75z" clipRule="evenodd" />
              </svg>
              우선순위 시트
            </a>
            <form action={logoutAction}>
              <button
                type="submit"
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs transition-all w-full text-left"
                style={{ color: "var(--text-subtle)", borderLeft: "2px solid transparent" }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = "var(--bg-item)";
                  (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "var(--text-subtle)";
                }}
              >
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                로그아웃
              </button>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}
