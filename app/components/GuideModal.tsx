"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

type Props = {
  onClose: () => void;
};

const WIKI_URL =
  "https://wiki.team.musinsa.com/wiki/spaces/29PRODUCT/pages/413730348/29CM+Team+Dashboard";

const TICKET_CACHE_KEY = "cc-tickets-v2";

function getCachedSyncInfo(): { label: string; isStale: boolean } | null {
  try {
    const raw = localStorage.getItem(TICKET_CACHE_KEY);
    if (!raw) return null;
    const { fetchedAt } = JSON.parse(raw) as { fetchedAt: string };
    if (!fetchedAt) return null;

    const date = new Date(fetchedAt);
    const diffMs = Date.now() - date.getTime();
    const diffH = diffMs / (1000 * 60 * 60);
    const isStale = diffH >= 12;

    const isToday = date.toDateString() === new Date().toDateString();
    const time = date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    const dow = ["일","월","화","수","목","금","토"][date.getDay()];
    const dateStr = isToday ? `오늘 ${time}` : `${date.getMonth()+1}/${date.getDate()}(${dow}) ${time}`;

    const agoMin = Math.floor(diffMs / 60000);
    const agoStr = agoMin < 60
      ? `${agoMin}분 전`
      : `${Math.floor(agoMin / 60)}시간 ${agoMin % 60 > 0 ? `${agoMin % 60}분 ` : ""}전`;

    return { label: `${dateStr} 동기화 (${agoStr})`, isStale };
  } catch {
    return null;
  }
}

export default function GuideModal({ onClose }: Props) {
  const syncInfo = typeof window !== "undefined" ? getCachedSyncInfo() : null;

  // ESC 키로 닫기
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
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "#60a5fa" }}>
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              사용 가이드
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
        <div className="px-5 py-4 space-y-4 text-xs" style={{ color: "var(--text-muted)", maxHeight: "70vh", overflowY: "auto" }}>

          {/* 주요 기능 */}
          <section>
            <p className="text-[11px] font-semibold mb-2 uppercase tracking-wider" style={{ color: "var(--text-subtle)" }}>주요 기능</p>
            <div className="space-y-2">
              {[
                { icon: "📋", label: "플래닝 상태", desc: "각 티켓에 기획/디자인/개발 준비 상태 기록" },
                { icon: "⭐", label: "검토 필요 표시", desc: "스프린트 플래닝 전 팀원들과 논의할 티켓 표시" },
                { icon: "📝", label: "메모", desc: "티켓별 공유 메모 — 팀원 모두가 열람 가능" },
                { icon: "📅", label: "일정 관리", desc: "시작일·완료 예정일을 대시보드에서 직접 설정" },
              ].map(({ icon, label, desc }) => (
                <div
                  key={label}
                  className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
                  style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}
                >
                  <span className="text-base leading-none mt-0.5">{icon}</span>
                  <div>
                    <p className="font-medium mb-0.5" style={{ color: "var(--text-primary)" }}>{label}</p>
                    <p>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 동기화 */}
          <section>
            <p className="text-[11px] font-semibold mb-2 uppercase tracking-wider" style={{ color: "var(--text-subtle)" }}>데이터 동기화</p>
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              {[
                {
                  badge: "F5",
                  badgeColor: "#34d399",
                  label: "플래닝·메모·일정·코멘트",
                  desc: "변경 즉시 저장 → 페이지 새로고침으로 반영",
                },
                {
                  badge: "Jira Sync",
                  badgeColor: "#60a5fa",
                  label: "티켓 상태·담당자·ETA",
                  desc: syncInfo
                    ? syncInfo.isStale
                      ? `마지막 동기화: ${syncInfo.label} — 갱신이 필요합니다`
                      : `마지막 동기화: ${syncInfo.label}`
                    : "12시간 캐시 → 최신 정보는 Jira Sync 버튼 클릭",
                  stale: syncInfo?.isStale ?? false,
                },
              ].map(({ badge, badgeColor, label, desc, stale }, i) => (
                <div
                  key={badge}
                  className="flex items-start gap-3 px-3 py-2.5"
                  style={{
                    borderTop: i > 0 ? "1px solid var(--border)" : "none",
                    background: "var(--bg-overlay)",
                  }}
                >
                  <span
                    className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5"
                    style={{ background: `${badgeColor}22`, color: badgeColor, border: `1px solid ${badgeColor}44` }}
                  >
                    {badge}
                  </span>
                  <div>
                    <p className="font-medium mb-0.5" style={{ color: "var(--text-primary)" }}>{label}</p>
                    <p style={{ color: stale ? "#f87171" : undefined }}>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* FAQ */}
          <section>
            <p className="text-[11px] font-semibold mb-2 uppercase tracking-wider" style={{ color: "var(--text-subtle)" }}>자주 묻는 질문</p>
            <div className="space-y-2">
              {[
                {
                  q: "내가 바꾼 플래닝 상태를 동료가 못 보는 경우",
                  a: "동료가 F5로 새로고침하면 즉시 반영됩니다.",
                },
                {
                  q: "완료된 티켓에 일정 정보가 없어요",
                  a: "2026/5/12 기준, 완료 처리된 티켓은 상세 일정(시작일·완료 예정일)을 마이그레이션하지 않았습니다.",
                },
                {
                  q: "JIRA에서 상태를 바꿨는데 대시보드에 반영 안 됨",
                  a: "상단 Jira Sync 버튼을 눌러 12시간 캐시를 갱신하세요.",
                },
                {
                  q: "티켓을 추가하고 싶어요",
                  a: "상단 검색창에 티켓 번호(예: TM-1234)를 입력 후 Enter — 자동으로 코드에 반영되어 팀원 모두에게 영구 표시됩니다.",
                },
              ].map(({ q, a }) => (
                <div
                  key={q}
                  className="rounded-lg px-3 py-2.5"
                  style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}
                >
                  <p className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>Q. {q}</p>
                  <p>→ {a}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* 푸터 */}
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>ESC 또는 바깥 클릭으로 닫기</p>
          <a
            href={WIKI_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ background: "#1d4ed833", border: "1px solid #3b82f644", color: "#60a5fa" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#1d4ed855"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#1d4ed833"; }}
          >
            상세보기
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  );

  if (typeof window === "undefined") return null;
  return createPortal(modal, document.body);
}
