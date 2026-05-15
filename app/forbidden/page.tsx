"use client";

import Link from "next/link";

/**
 * 403 접근 불가 페이지
 * 관리자 전용 route에 비허용 사용자가 직접 접근했을 때 표시.
 */
export default function ForbiddenPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-5">
      {/* Icon */}
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.2)",
        }}
      >
        <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>

      {/* Text */}
      <div className="text-center max-w-xs">
        <p
          className="text-[11px] font-semibold uppercase tracking-widest mb-2"
          style={{ color: "#f87171" }}
        >
          403 접근 불가
        </p>
        <h1 className="text-base font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          이 페이지에 접근할 수 없습니다
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
          이 기능은 지정된 관리자에게만 허용됩니다.
          접근 권한이 필요하다면 담당 PM에게 문의해주세요.
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="text-xs font-medium px-4 py-2 rounded-lg transition-colors"
          style={{
            background: "var(--bg-item)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border-2)",
          }}
        >
          ← 전체 과제 현황으로
        </Link>
        <Link
          href="/monthly"
          className="text-xs font-medium px-4 py-2 rounded-lg transition-colors"
          style={{
            background: "rgba(99,102,241,0.1)",
            color: "#818cf8",
            border: "1px solid rgba(99,102,241,0.25)",
          }}
        >
          월별 진행 현황
        </Link>
      </div>
    </div>
  );
}
