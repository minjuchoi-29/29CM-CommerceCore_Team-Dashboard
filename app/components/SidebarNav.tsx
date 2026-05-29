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

/**
 * 관리자 전용 메뉴 표시 여부 판단 — 클라이언트 번들용 (NEXT_PUBLIC_)
 * 서버 측 접근 제한은 layout.tsx / API route 에서 별도로 적용됨.
 */
const ADMIN_EMAILS = (
  process.env.NEXT_PUBLIC_ADMIN_ONLY_EMAILS ??
  process.env.NEXT_PUBLIC_ROADMAP_ALLOWED_EMAILS ??  // 하위 호환 fallback
  ""
)
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

// ── 공통 nav item 스타일 helper ──────────────────────────────────────────────
function navItemStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "var(--bg-item)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    borderLeft: active ? "2px solid #6366f1" : "2px solid transparent",
  };
}

function navItemHover(el: HTMLElement, active: boolean) {
  if (!active) {
    el.style.background = "var(--bg-item)";
    el.style.color = "var(--text-primary)";
  }
}

function navItemLeave(el: HTMLElement, active: boolean) {
  if (!active) {
    el.style.background = "transparent";
    el.style.color = "var(--text-muted)";
  }
}

// ── 관리자 전용 뱃지 ─────────────────────────────────────────────────────────
function AdminBadge() {
  return (
    <span
      className="text-[9px] font-semibold px-1 py-0.5 rounded shrink-0 leading-none"
      style={{
        background: "rgba(99,102,241,0.12)",
        color: "#818cf8",
        border: "1px solid rgba(99,102,241,0.2)",
      }}
    >
      PM
    </span>
  );
}

// ── Beta 뱃지 ─────────────────────────────────────────────────────────────────
function BetaBadge() {
  return (
    <span
      className="text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 leading-none"
      style={{
        background: "rgba(139,92,246,0.10)",
        color: "#a78bfa",
        border: "1px solid rgba(139,92,246,0.22)",
        letterSpacing: "0.02em",
      }}
    >
      Beta
    </span>
  );
}

// ── 잠금 아이콘 ──────────────────────────────────────────────────────────────
function LockIcon() {
  return (
    <svg className="w-3 h-3 shrink-0 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
}

export default function SidebarNav({ user, logoutAction }: Props) {
  const [visible, setVisible] = useState(true);
  const [guideOpen, setGuideOpen] = useState(false);
  const [quickLinksOpen, setQuickLinksOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const pathname = usePathname();

  const canSeeAdmin = isAdmin(user?.email);

  useEffect(() => {
    function handler(e: Event) {
      const { open } = (e as CustomEvent<{ open: boolean }>).detail;
      setVisible(!open);
    }
    window.addEventListener("detail-panel", handler);
    return () => window.removeEventListener("detail-panel", handler);
  }, []);

  // pathname 변경(페이지 이동) 시 사이드바 항상 복원
  // 이유: TicketBoard의 언마운트 cleanup이 race condition으로 누락될 경우 대비 (이중 방어)
  useEffect(() => {
    setVisible(true);
  }, [pathname]);

  const isHome = pathname === "/";

  // ── 홈 이동 시 ticket workspace state 완전 reset ─────────────────────────
  // SidebarNav는 별도 컴포넌트라 TicketBoard state에 직접 접근 불가.
  // CustomEvent로 의도를 전달 → TicketBoard listener가 selected / focus mode /
  // candidate·cleanup panel / navigationContext 모두 reset.
  // URL query 정리는 <Link href="/">가 자체적으로 처리 (Next.js navigation).
  function handleHomeNavigate() {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("home-navigate"));
    }
  }

  // ── 접힌 상태 ──────────────────────────────────────────────────────────────
  if (!visible) {
    return (
      <aside
        className="w-10 h-screen sticky top-0 flex flex-col items-center shrink-0"
        style={{ background: "var(--bg-sidebar)", borderRight: "1px solid var(--border)" }}
      >
        {/* 홈 버튼 (29 로고) — collapsed 상태에서도 홈 진입 보장 */}
        <Link
          href="/"
          onClick={handleHomeNavigate}
          title="홈으로 이동"
          aria-label="홈으로 이동"
          aria-current={isHome ? "page" : undefined}
          className="mt-3 w-7 h-7 flex items-center justify-center rounded-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          style={{
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            boxShadow: isHome ? "0 0 0 2px rgba(165,180,252,0.55)" : undefined,
          }}
        >
          <span className="text-[10px] font-bold text-white">29</span>
        </Link>
        <button
          onClick={() => setVisible(true)}
          title="메뉴 펼치기"
          className="mt-2 w-7 h-7 flex items-center justify-center rounded-lg transition-colors text-xs"
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

  // ── 공통 Link 렌더 helper ──────────────────────────────────────────────────
  function NavLink({
    href,
    icon,
    label,
    admin,
    beta,
  }: {
    href: string;
    icon: React.ReactNode;
    label: string;
    admin?: boolean;
    beta?: boolean;
  }) {
    const active = isActive(href);
    return (
      <Link
        href={href}
        className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-all"
        style={navItemStyle(active)}
        onMouseEnter={e => navItemHover(e.currentTarget as HTMLElement, active)}
        onMouseLeave={e => navItemLeave(e.currentTarget as HTMLElement, active)}
      >
        {icon}
        <span className="flex-1 leading-tight">{label}</span>
        {beta  && <BetaBadge />}
        {admin && <AdminBadge />}
        {admin && !active && <LockIcon />}
      </Link>
    );
  }

  return (
    <aside
      className="w-52 h-screen sticky top-0 flex flex-col shrink-0"
      style={{ background: "var(--bg-sidebar)", borderRight: "1px solid var(--border)" }}
    >
      {/* ── 헤더 (29 로고 + 브랜드 → 홈 링크) ── */}
      <div
        className="px-4 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <Link
          href="/"
          onClick={handleHomeNavigate}
          title="홈으로 이동"
          aria-label="홈으로 이동"
          aria-current={isHome ? "page" : undefined}
          className="flex items-center gap-2.5 rounded-md px-1.5 py-1 -mx-1.5 -my-1 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          style={{ background: isHome ? "rgba(99,102,241,0.10)" : "transparent" }}
          onMouseEnter={e => {
            if (!isHome) (e.currentTarget as HTMLElement).style.background = "var(--bg-item)";
          }}
          onMouseLeave={e => {
            if (!isHome) (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
          >
            <span className="text-[10px] font-bold text-white">29</span>
          </div>
          <div>
            <h1 className="text-xs font-bold leading-tight" style={{ color: "var(--text-primary)" }}>29CM</h1>
            <p className="text-[10px] leading-tight" style={{ color: "var(--text-subtle)" }}>Commerce Core</p>
          </div>
        </Link>
        <button
          onClick={() => setVisible(false)}
          title="메뉴 접기"
          className="w-6 h-6 flex items-center justify-center rounded-md transition-all text-xs shrink-0"
          style={{ color: "var(--text-subtle)" }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
            (e.currentTarget as HTMLElement).style.background = "var(--bg-item)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-subtle)";
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          «
        </button>
      </div>

      {/* ── 공개 메뉴 ── */}
      <div className="px-3 pt-3 pb-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-1.5"
          style={{ color: "var(--text-subtle)" }}>Overview</p>
        <nav className="flex flex-col gap-0.5">
          <NavLink
            href="/"
            label="전체 과제 현황"
            icon={
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
              </svg>
            }
          />
          <NavLink
            href="/monthly"
            label="월별 진행 현황"
            icon={
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            }
          />
        </nav>
      </div>

      {/* ── Beta 섹션 — 전체 사용자 공개 ── */}
      <div className="mx-3 mt-2" style={{ borderTop: "1px solid var(--border)" }} />
      <div className="px-3 pt-2.5 pb-1">
        <div className="flex items-center gap-1.5 px-2 mb-1.5">
          {/* 플라스크 아이콘 — 실험적 느낌 */}
          <svg className="w-2.5 h-2.5 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M9 3h6M9 3v8l-4.5 9.5A1 1 0 005.4 22h13.2a1 1 0 00.9-1.5L15 11V3"/>
          </svg>
          <p
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-subtle)" }}
          >
            Beta
          </p>
        </div>
        <nav className="flex flex-col gap-0.5">
          {/* 담당자 대시보드 — Beta 공개 기능 */}
          <NavLink
            href="/owner-dashboard"
            label="담당자 대시보드"
            beta
            icon={
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="8" r="4"/>
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                <circle cx="19" cy="6" r="2.5"/>
                <path d="M19 3v1.5M19 8.5V10M16.8 4.2l1 1M21.2 7.8l1 1M15.5 6h1.5M21 6h1.5M16.8 7.8l1-1M21.2 4.2l1-1"/>
              </svg>
            }
          />
        </nav>
      </div>

      {/* ── 관리자 전용 섹션 (canSeeAdmin일 때만 표시) ── */}
      {canSeeAdmin && (
        <>
          <div className="mx-3 mt-2" style={{ borderTop: "1px solid var(--border)" }} />
          <div className="px-3 pt-2.5 pb-1">
            {/* 섹션 레이블 */}
            <div className="flex items-center gap-1.5 px-2 mb-1.5">
              <svg className="w-2.5 h-2.5 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <p
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-subtle)" }}
              >
                PM 운영
              </p>
            </div>
            <nav className="flex flex-col gap-0.5">
              <NavLink
                href="/roadmap"
                label="로드맵"
                admin
                icon={
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M3 12h12M3 18h7"/>
                  </svg>
                }
              />
              <NavLink
                href="/resources"
                label="리소스 현황"
                admin
                icon={
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                }
              />
              <NavLink
                href="/reports"
                label="보고서"
                admin
                icon={
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                  </svg>
                }
              />
              <NavLink
                href="/data-sources"
                label="데이터 소스"
                admin
                icon={
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                  </svg>
                }
              />
            </nav>
          </div>
        </>
      )}

      {/* ── 준비 중 항목 ── */}
      <div className="px-3 pt-1 pb-1">
        <nav className="flex flex-col gap-0.5">
          <DisabledNavItem
            label="캘린더"
            icon={
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>
              </svg>
            }
          />
        </nav>
      </div>

      {/* ── 구분선 ── */}
      <div className="mx-3" style={{ borderTop: "1px solid var(--border)" }} />

      {/* ── 도구 ── */}
      <div className="px-3 pt-3 pb-2">
        <p
          className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-1.5"
          style={{ color: "var(--text-subtle)" }}
        >
          도구
        </p>
        <div className="flex flex-col gap-0.5">
          {/* 사용 가이드 */}
          <button
            onClick={() => setGuideOpen(true)}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-all w-full text-left"
            style={{ color: "var(--text-muted)", borderLeft: "2px solid transparent" }}
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
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
            <span className="flex-1">사용 가이드</span>
          </button>

          {/* 퀵 링크 */}
          <button
            onClick={() => setQuickLinksOpen(true)}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-all w-full text-left"
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
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            <span className="flex-1">퀵 링크</span>
          </button>
        </div>
      </div>

      {guideOpen && <GuideModal onClose={() => setGuideOpen(false)} />}
      {quickLinksOpen && <QuickLinksModal onClose={() => setQuickLinksOpen(false)} />}

      {/* TODO [THEME]: theme stabilization 이후 구분선 + 테마 토글 재노출 예정 */}
      {false && (
        <>
          {/* ── 구분선 ── */}
          <div className="mx-3" style={{ borderTop: "1px solid var(--border)" }} />

          {/* ── 테마 토글 ── */}
          <div className="px-3 pt-3 pb-2">
            <button
              onClick={toggle}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-all w-full text-left"
              style={{ color: "var(--text-muted)", borderLeft: "2px solid transparent" }}
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
                    <circle cx="12" cy="12" r="4"/>
                    <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
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
        </>
      )}

      {/* ── 유저 프로필 ── */}
      {user && (
        <div className="mt-auto px-3 py-3" style={{ borderTop: "1px solid var(--border)" }}>
          <div
            className="flex items-center gap-2 px-2 py-2 rounded-md mb-1"
            style={{ background: "var(--bg-item)" }}
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold text-white"
              style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
            >
              {user.name?.charAt(0) ?? "?"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate leading-tight" style={{ color: "var(--text-primary)" }}>
                {user.name}
              </p>
              <p className="text-[10px] truncate leading-tight" style={{ color: "var(--text-subtle)" }}>
                {user.email}
              </p>
            </div>
            {/* 관리자임을 본인에게 subtle하게 표시 */}
            {canSeeAdmin && (
              <span
                className="text-[8px] font-bold px-1 py-0.5 rounded shrink-0 leading-none"
                style={{
                  background: "rgba(99,102,241,0.15)",
                  color: "#818cf8",
                  border: "1px solid rgba(99,102,241,0.2)",
                }}
              >
                PM
              </span>
            )}
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
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
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

// ── 비활성화된 메뉴 아이템 (준비 중) ──────────────────────────────────────────
function DisabledNavItem({
  label,
  icon,
}: {
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium cursor-not-allowed select-none"
      style={{ color: "var(--text-subtle)", borderLeft: "2px solid transparent" }}
    >
      {icon}
      <span className="flex-1">{label}</span>
      <span
        className="text-[9px] px-1 py-0.5 rounded"
        style={{ background: "var(--bg-item)", color: "var(--text-subtle)" }}
      >
        준비 중
      </span>
    </div>
  );
}
