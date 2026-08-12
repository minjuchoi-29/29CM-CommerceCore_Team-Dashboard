"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/app/components/ThemeProvider";
import GuideModal from "@/app/components/GuideModal";
import QuickLinksModal from "@/app/components/QuickLinksModal";

type Props = {
  user?: { name?: string | null; email?: string | null };
  logoutAction: () => Promise<void>;
};

type OpenMenu = "pm" | "tools" | "user" | null;

const ADMIN_EMAILS = (
  process.env.NEXT_PUBLIC_ADMIN_ONLY_EMAILS ??
  process.env.NEXT_PUBLIC_ROADMAP_ALLOWED_EMAILS ??
  ""
)
  .split(",")
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

function isAdmin(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

const NAV_ITEMS = [
  { href: "/", label: "전체 과제" },
  { href: "/etr-review", label: "ETR 검토" },
  { href: "/monthly", label: "월별 현황" },
] as const;

const PM_ITEMS = [
  { href: "/roadmap", label: "로드맵" },
  { href: "/resources", label: "리소스 현황" },
  { href: "/reports", label: "보고서" },
  { href: "/data-sources", label: "데이터 소스" },
] as const;

const PRIORITY_SHEET_URL = "https://docs.google.com/spreadsheets/d/1uCR-MCNpXO9b8iXIFZMgQIG-z54rzbVi4AN_1TtiSMw/edit?gid=0#gid=0";

export default function SidebarNav({ user, logoutAction }: Props) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [quickLinksOpen, setQuickLinksOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const canSeeAdmin = isAdmin(user?.email);

  useEffect(() => {
    if (!openMenu) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    window.addEventListener("pointerdown", closeOnOutside);
    return () => window.removeEventListener("pointerdown", closeOnOutside);
  }, [openMenu]);

  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);
  const isPmActive = PM_ITEMS.some(item => isActive(item.href));

  function handleHomeNavigate() {
    window.dispatchEvent(new CustomEvent("home-navigate"));
  }

  function toggleMenu(menu: Exclude<OpenMenu, null>) {
    setOpenMenu(current => current === menu ? null : menu);
  }

  function navStyle(active: boolean): React.CSSProperties {
    return {
      color: active ? "#173f49" : "var(--text-muted)",
      background: active ? "#e8f1f2" : "transparent",
      border: active ? "1px solid #bfd2d6" : "1px solid transparent",
    };
  }

  const dropdownStyle: React.CSSProperties = {
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-2)",
    boxShadow: "0 16px 40px rgba(31, 49, 65, 0.16)",
  };

  return (
    <>
      <header
        ref={headerRef}
        className="sticky top-0 z-[200] h-14 flex items-center gap-3 px-4"
        style={{ background: "var(--bg-canvas)", borderBottom: "1px solid var(--border)" }}
      >
        <Link
          href="/"
          onClick={handleHomeNavigate}
          aria-label="전체 과제 현황으로 이동"
          className="flex shrink-0 items-center gap-2.5 rounded-lg pr-3"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-bold text-white" style={{ background: "#173f49" }}>29</span>
          <span className="hidden leading-tight sm:block">
            <strong className="block text-[13px]" style={{ color: "var(--text-primary)" }}>Commerce Core</strong>
            <span className="block text-[10px]" style={{ color: "var(--text-subtle)" }}>Team Dashboard</span>
          </span>
        </Link>

        <span className="hidden h-5 w-px shrink-0 sm:block" style={{ background: "var(--border)" }} />

        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="주요 메뉴">
          {NAV_ITEMS.map(item => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => {
                if (item.href === "/") handleHomeNavigate();
                setOpenMenu(null);
              }}
              aria-current={isActive(item.href) ? "page" : undefined}
              className="shrink-0 rounded-md px-3 py-2 text-[12px] font-semibold transition-colors"
              style={navStyle(isActive(item.href))}
            >
              {item.label}
            </Link>
          ))}

          <Link
            href="/owner-dashboard"
            onClick={() => setOpenMenu(null)}
            aria-current={isActive("/owner-dashboard") ? "page" : undefined}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-semibold transition-colors"
            style={navStyle(isActive("/owner-dashboard"))}
          >
            담당자
            <span className="rounded px-1 py-0.5 text-[8px] font-bold" style={{ background: "#f0f3f6", color: "#657589" }}>BETA</span>
          </Link>

          {canSeeAdmin && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => toggleMenu("pm")}
                aria-expanded={openMenu === "pm"}
                className="flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-semibold"
                style={navStyle(isPmActive || openMenu === "pm")}
              >
                PM 운영 <span className="text-[9px]">▾</span>
              </button>
              {openMenu === "pm" && (
                <div className="absolute left-0 top-[calc(100%+8px)] w-48 overflow-hidden rounded-xl p-1.5" style={dropdownStyle}>
                  {PM_ITEMS.map(item => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpenMenu(null)}
                      className="block rounded-lg px-3 py-2.5 text-[12px] font-medium"
                      style={{ color: isActive(item.href) ? "#173f49" : "var(--text-secondary)", background: isActive(item.href) ? "#e8f1f2" : "transparent" }}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => toggleMenu("tools")}
              aria-expanded={openMenu === "tools"}
              className="flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-semibold"
              style={navStyle(openMenu === "tools" || isActive("/weekly-guide"))}
            >
              도구 <span className="text-[9px]">▾</span>
            </button>
            {openMenu === "tools" && (
              <div className="absolute left-0 top-[calc(100%+8px)] w-52 overflow-hidden rounded-xl p-1.5" style={dropdownStyle}>
                <button type="button" onClick={() => { setOpenMenu(null); setGuideOpen(true); }} className="block w-full rounded-lg px-3 py-2.5 text-left text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>사용 가이드</button>
                <Link href="/weekly-guide" onClick={() => setOpenMenu(null)} className="block rounded-lg px-3 py-2.5 text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>위클리 작성 가이드</Link>
                <button type="button" onClick={() => { setOpenMenu(null); setQuickLinksOpen(true); }} className="block w-full rounded-lg px-3 py-2.5 text-left text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>퀵 링크</button>
                <div className="my-1" style={{ borderTop: "1px solid var(--border)" }} />
                <button type="button" onClick={() => { toggle(); setOpenMenu(null); }} className="block w-full rounded-lg px-3 py-2.5 text-left text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
                  {theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
                </button>
                <div className="px-3 py-2 text-[10px]" style={{ color: "var(--text-subtle)" }}>캘린더 · 준비 중</div>
              </div>
            )}
          </div>
        </nav>

        <a
          href={PRIORITY_SHEET_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden shrink-0 rounded-md px-2.5 py-2 text-[11px] font-semibold lg:block"
          style={{ color: "#315b67", border: "1px solid var(--border-2)" }}
        >
          우선순위 시트 ↗
        </a>

        {user && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => toggleMenu("user")}
              aria-expanded={openMenu === "user"}
              aria-label="사용자 메뉴"
              className="flex h-9 items-center gap-2 rounded-lg px-1.5 pr-2"
              style={{ border: "1px solid var(--border-2)", background: "var(--bg-item)" }}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: "#315b67" }}>{user.name?.charAt(0) ?? "?"}</span>
              <span className="hidden max-w-24 truncate text-[11px] font-semibold xl:block" style={{ color: "var(--text-secondary)" }}>{user.name}</span>
              <span className="text-[9px]" style={{ color: "var(--text-subtle)" }}>▾</span>
            </button>
            {openMenu === "user" && (
              <div className="absolute right-0 top-[calc(100%+8px)] w-64 overflow-hidden rounded-xl p-2" style={dropdownStyle}>
                <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--bg-overlay)" }}>
                  <p className="truncate text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>{user.name}</p>
                  <p className="mt-0.5 truncate text-[10px]" style={{ color: "var(--text-subtle)" }}>{user.email}</p>
                </div>
                <a href={PRIORITY_SHEET_URL} target="_blank" rel="noopener noreferrer" className="block rounded-lg px-3 py-2.5 text-[12px] font-medium lg:hidden" style={{ color: "var(--text-secondary)" }}>우선순위 시트 ↗</a>
                <form action={logoutAction}>
                  <button type="submit" className="block w-full rounded-lg px-3 py-2.5 text-left text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>로그아웃</button>
                </form>
              </div>
            )}
          </div>
        )}
      </header>

      {guideOpen && <GuideModal onClose={() => setGuideOpen(false)} />}
      {quickLinksOpen && <QuickLinksModal onClose={() => setQuickLinksOpen(false)} />}
    </>
  );
}
