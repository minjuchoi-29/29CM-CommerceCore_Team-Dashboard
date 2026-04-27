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

  if (!visible) return null;

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
