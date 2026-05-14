"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

type Props = {
  onClose: () => void;
};

const LINKS = [
  {
    category: "전략",
    items: [
      {
        label: "2026 H1 Commerce Core 전략과제 맵핑",
        url: "https://wiki.team.musinsa.com/wiki/spaces/29PRODUCT/pages/448730075/2026+H1+Commerce+Core",
        icon: "🗺️",
      },
    ],
  },
  {
    category: "OKR",
    items: [
      {
        label: "[29CM] 2026-Q2 OKR Weekly Sheet",
        url: "https://docs.google.com/spreadsheets/d/19pWRaulbtsaOPypAwBYKT8xGB_6aOghUeLeiBVVp4o4/edit?gid=579589053#gid=579589053",
        icon: "📊",
      },
      {
        label: "[29CM] 2026-Q2 OKR List",
        url: "https://docs.google.com/spreadsheets/d/1NB0f0wsr6WHEIKUPMgPxaN7EfdyP1ZfFm2SZc5vaLZ4/edit?gid=1259711292#gid=1259711292",
        icon: "📋",
      },
    ],
  },
];

export default function QuickLinksModal({ onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-xl shadow-2xl overflow-hidden"
        style={{ background: "var(--bg-canvas)", border: "1px solid var(--border)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "#34d399" }}>
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              퀵 링크
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md text-xs transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-item)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            ✕
          </button>
        </div>

        {/* 본문 */}
        <div className="px-5 py-4 space-y-4" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {LINKS.map(({ category, items }) => (
            <section key={category}>
              <p className="text-[11px] font-semibold mb-2 uppercase tracking-wider" style={{ color: "var(--text-subtle)" }}>
                {category}
              </p>
              <div className="space-y-1.5">
                {items.map(({ label, url, icon }) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group"
                    style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = "#34d399";
                      (e.currentTarget as HTMLElement).style.background = "rgba(52,211,153,0.05)";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                      (e.currentTarget as HTMLElement).style.background = "var(--bg-overlay)";
                    }}
                  >
                    <span className="text-base shrink-0">{icon}</span>
                    <span className="flex-1 text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                      {label}
                    </span>
                    <svg className="w-3 h-3 shrink-0 opacity-30 group-hover:opacity-70 transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                      <polyline points="15 3 21 3 21 9"/>
                      <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3" style={{ borderTop: "1px solid var(--border)" }}>
          <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>ESC 또는 바깥 클릭으로 닫기</p>
        </div>
      </div>
    </div>
  );

  if (typeof window === "undefined") return null;
  return createPortal(modal, document.body);
}
