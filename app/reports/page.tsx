"use client";

/**
 * 보고서 페이지 — 준비 중
 * layout.tsx 에서 접근 권한 검사 후 진입.
 */
export default function ReportsPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center"
        style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}
      >
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
      </div>
      <div className="text-center">
        <h1 className="text-base font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
          보고서
        </h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          준비 중입니다. 조만간 공개될 예정입니다.
        </p>
      </div>
      <span
        className="text-[11px] font-medium px-2.5 py-1 rounded-full"
        style={{ background: "rgba(99,102,241,0.1)", color: "#818cf8" }}
      >
        Coming Soon
      </span>
    </div>
  );
}
