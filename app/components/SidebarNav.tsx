"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTheme } from "@/app/components/ThemeProvider";

type Props = {
  user?: { name?: string | null; email?: string | null };
  logoutAction: () => Promise<void>;
};

export default function SidebarNav({ user, logoutAction }: Props) {
  const [visible, setVisible] = useState(true);
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

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

  return (
    <aside className="w-52 h-screen sticky top-0 flex flex-col shrink-0" style={{ background: "var(--bg-sidebar)", borderRight: "1px solid var(--border)" }}>
      <div className="px-5 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <h1 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>29CM</h1>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Commerce Core</p>
      </div>
      <nav className="flex flex-col gap-1 p-3 mt-1">
        <Link
          href="/"
          className="px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-item)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
        >
          전체 과제 보기
        </Link>
        <Link
          href="/monthly"
          className="px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-item)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
        >
          월별 진행 현황
        </Link>
      </nav>

      {/* 테마 토글 */}
      <div className="px-4 pb-3">
        <button
          onClick={toggle}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors"
          style={{
            background: "var(--bg-item)",
            border: "1px solid var(--border-2)",
            color: "var(--text-muted)",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
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

      {user && (
        <div className="mt-auto px-4 py-4" style={{ borderTop: "1px solid var(--border)" }}>
          <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{user.name}</p>
          <p className="text-[11px] truncate mb-2" style={{ color: "var(--text-subtle)" }}>{user.email}</p>
          <a
            href="https://docs.google.com/spreadsheets/d/1uCR-MCNpXO9b8iXIFZMgQIG-z54rzbVi4AN_1TtiSMw/edit?gid=0#gid=0"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs py-1 transition-colors mb-1"
            style={{ color: "var(--text-muted)" }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0" style={{ color: "#34d399" }}>
              <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm4.75 6.75a.75.75 0 011.5 0v2.546l.943-1.048a.75.75 0 111.114 1.004l-2.25 2.5a.75.75 0 01-1.114 0l-2.25-2.5a.75.75 0 111.114-1.004l.943 1.048V8.75z" clipRule="evenodd" />
            </svg>
            우선순위 시트
          </a>
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full text-xs text-left py-1 transition-colors"
              style={{ color: "var(--text-subtle)" }}
            >
              로그아웃
            </button>
          </form>
        </div>
      )}
    </aside>
  );
}
