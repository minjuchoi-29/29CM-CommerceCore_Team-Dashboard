"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type Props = {
  user?: { name?: string | null; email?: string | null };
  logoutAction: () => Promise<void>;
};

export default function SidebarNav({ user, logoutAction }: Props) {
  const [visible, setVisible] = useState(true);

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
      <aside className="w-10 min-h-screen bg-white border-r border-gray-200 flex flex-col items-center shrink-0">
        {user && (
          <form action={logoutAction} className="mt-auto pb-4">
            <button
              type="submit"
              title="로그아웃"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors text-xs"
            >
              ↩
            </button>
          </form>
        )}
      </aside>
    );
  }

  return (
    <aside className="w-52 min-h-screen bg-white border-r border-gray-200 flex flex-col shrink-0">
      <div className="px-5 py-5 border-b border-gray-100">
        <h1 className="text-sm font-bold text-gray-900">29CM</h1>
        <p className="text-xs text-gray-400 mt-0.5">Commerce Core</p>
      </div>
      <nav className="flex flex-col gap-1 p-3 mt-1">
        <Link
          href="/"
          className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
        >
          전체 과제 보기
        </Link>
        <Link
          href="/monthly"
          className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
        >
          월별 진행 현황
        </Link>
        <a
          href="https://docs.google.com/spreadsheets/d/1uCR-MCNpXO9b8iXIFZMgQIG-z54rzbVi4AN_1TtiSMw/edit?gid=0#gid=0"
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors flex items-center gap-1.5"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-green-600 shrink-0">
            <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm4.75 6.75a.75.75 0 011.5 0v2.546l.943-1.048a.75.75 0 111.114 1.004l-2.25 2.5a.75.75 0 01-1.114 0l-2.25-2.5a.75.75 0 111.114-1.004l.943 1.048V8.75z" clipRule="evenodd" />
          </svg>
          우선순위 시트
        </a>
      </nav>

      {user && (
        <div className="mt-auto px-4 py-4 border-t border-gray-100">
          <p className="text-xs text-gray-500 truncate">{user.name}</p>
          <p className="text-[11px] text-gray-400 truncate mb-2">{user.email}</p>
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full text-xs text-gray-400 hover:text-gray-600 text-left py-1 transition-colors"
            >
              로그아웃
            </button>
          </form>
        </div>
      )}
    </aside>
  );
}
