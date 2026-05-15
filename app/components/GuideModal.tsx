"use client";

import { useEffect, useState } from "react";
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

    return { label: `${dateStr} (${agoStr})`, isStale };
  } catch {
    return null;
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest mb-2.5" style={{ color: "var(--text-subtle)" }}>
      {children}
    </p>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function GuideModal({ onClose }: Props) {
  const syncInfo = typeof window !== "undefined" ? getCachedSyncInfo() : null;
  const [faqOpen, setFaqOpen] = useState(false);

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
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full rounded-xl shadow-2xl overflow-hidden flex flex-col"
        style={{
          background: "var(--bg-canvas)",
          border: "1px solid var(--border)",
          maxWidth: "780px",
          maxHeight: "88vh",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-5 py-3.5 shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2">
            <span className="text-base leading-none">🗺</span>
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Operational Quick Guide
            </span>
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{ background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.25)", color: "#60a5fa" }}
            >
              Product OS
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

        {/* ── Scrollable Body ─────────────────────────────────────── */}
        <div
          className="px-5 py-4 space-y-5 text-xs overflow-y-auto"
          style={{ color: "var(--text-muted)" }}
        >

          {/* ── SECTION 1: 시스템 이해 ────────────────────────────── */}
          <section>
            <SectionLabel>01 · 시스템 이해</SectionLabel>
            <div className="grid grid-cols-3 gap-2.5">
              {/* Card: 담당자 대시보드 */}
              <div
                className="rounded-lg p-3 flex flex-col gap-1.5"
                style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-sm leading-none">👤</span>
                  <p className="text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>담당자 대시보드</p>
                </div>
                <p style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>
                  내 이름이 담당자인 티켓 중 <span style={{ color: "#f87171", fontWeight: 600 }}>Action Required</span>가 있는 항목만 우선순위 순으로 표시됩니다.
                </p>
                <div
                  className="mt-0.5 rounded px-2 py-1 text-[10px] font-medium"
                  style={{ background: "rgba(239,68,68,0.07)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}
                >
                  티켓 클릭 → 자동으로 Focus Mode 진입
                </div>
              </div>

              {/* Card: Focus Workspace */}
              <div
                className="rounded-lg p-3 flex flex-col gap-1.5"
                style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-sm leading-none">🎯</span>
                  <p className="text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>Focus Workspace</p>
                </div>
                <p style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>
                  티켓 1개에 집중하는 2-column 작업 공간.
                  왼쪽은 <strong style={{ color: "var(--text-primary)" }}>컨텍스트</strong>, 오른쪽은 <strong style={{ color: "var(--text-primary)" }}>실행 패널</strong>.
                </p>
                <div
                  className="mt-0.5 rounded px-2 py-1 text-[10px] font-medium"
                  style={{ background: "rgba(96,165,250,0.07)", color: "#60a5fa", border: "1px solid rgba(96,165,250,0.2)" }}
                >
                  ESC → Split View로 복귀
                </div>
              </div>

              {/* Card: 전체 과제 현황 */}
              <div
                className="rounded-lg p-3 flex flex-col gap-1.5"
                style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-sm leading-none">📊</span>
                  <p className="text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>전체 과제 현황</p>
                </div>
                <p style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>
                  팀 전체 <span style={{ color: "#a78bfa" }}>OKR · BAU · KTLO</span> 스프레드시트 뷰. 도메인·담당자·상태별 필터 지원.
                </p>
                <div
                  className="mt-0.5 rounded px-2 py-1 text-[10px] font-medium"
                  style={{ background: "rgba(167,139,250,0.07)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}
                >
                  필수: OKR · BAU · KTLO 모두 등록
                </div>
              </div>
            </div>
          </section>

          {/* ── SECTION 2: 주요 워크플로 ──────────────────────────── */}
          <section>
            <SectionLabel>02 · 주요 워크플로</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  emoji: "📅",
                  label: "일정 입력",
                  steps: ["담당자 대시보드 또는 티켓 클릭 → Focus Mode", "우측 Ops 탭 → Schedule 섹션", "시작일 / 완료 예정일 입력 후 저장"],
                  accentColor: "#34d399",
                  bgColor: "rgba(52,211,153,0.06)",
                  borderColor: "rgba(52,211,153,0.2)",
                },
                {
                  emoji: "⭐",
                  label: "검토 필요 표시",
                  steps: ["티켓 목록에서 ⭐ 아이콘 클릭 (토글)", "스프린트 플래닝 전 논의할 티켓 표시", "팀원 모두에게 즉시 반영"],
                  accentColor: "#fbbf24",
                  bgColor: "rgba(251,191,36,0.06)",
                  borderColor: "rgba(251,191,36,0.2)",
                },
                {
                  emoji: "🚀",
                  label: "Launch 일정 설정",
                  steps: ["Focus Mode → 우측 Ops 탭", "Launch Date 섹션에 목표 런치일 입력", "미입력 시 Action Required(Warning) 발생"],
                  accentColor: "#f97316",
                  bgColor: "rgba(249,115,22,0.06)",
                  borderColor: "rgba(249,115,22,0.2)",
                },
                {
                  emoji: "📋",
                  label: "플래닝 상태 업데이트",
                  steps: ["Focus Mode → 우측 Planning 탭", "기획 / 디자인 / 개발 준비 상태 드롭다운 선택", "Reviewing 상태는 팀 알림 발생"],
                  accentColor: "#818cf8",
                  bgColor: "rgba(129,140,248,0.06)",
                  borderColor: "rgba(129,140,248,0.2)",
                },
              ].map(({ emoji, label, steps, accentColor, bgColor, borderColor }) => (
                <div
                  key={label}
                  className="rounded-lg p-3"
                  style={{ background: bgColor, border: `1px solid ${borderColor}` }}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-sm leading-none">{emoji}</span>
                    <p className="text-[11px] font-semibold" style={{ color: accentColor }}>{label}</p>
                  </div>
                  <ol className="space-y-1">
                    {steps.map((step, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span
                          className="shrink-0 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center mt-0.5"
                          style={{ background: `${accentColor}22`, color: accentColor }}
                        >
                          {i + 1}
                        </span>
                        <span style={{ color: "var(--text-muted)", lineHeight: 1.5 }}>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </section>

          {/* ── SECTION 3: Action Required 컬러 가이드 ────────────── */}
          <section>
            <SectionLabel>03 · Action Required 컬러 가이드</SectionLabel>
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              {[
                {
                  color: "#ef4444",
                  bg: "rgba(239,68,68,0.08)",
                  level: "Critical",
                  dot: "🔴",
                  actions: ["일정 초과 (overdue)", "검토 필요 (review needed)"],
                  hint: "즉시 조치 — 담당자 대시보드 상단에 노출",
                },
                {
                  color: "#f59e0b",
                  bg: "rgba(245,158,11,0.07)",
                  level: "Warning",
                  dot: "🟡",
                  actions: ["일정 미입력", "Launch 일정 미입력", "플래닝 Reviewing 상태"],
                  hint: "이번 주 내 해결 권장",
                },
                {
                  color: "#60a5fa",
                  bg: "rgba(96,165,250,0.07)",
                  level: "Info",
                  dot: "🔵",
                  actions: ["ETR 미연결", "문서 미작성"],
                  hint: "보완 권장 — 즉시 필수 아님",
                },
              ].map(({ color, bg, level, dot, actions, hint }, i) => (
                <div
                  key={level}
                  className="flex items-start gap-3 px-3.5 py-2.5"
                  style={{
                    background: bg,
                    borderTop: i > 0 ? "1px solid var(--border)" : "none",
                  }}
                >
                  <div className="flex items-center gap-1.5 shrink-0 w-20 mt-0.5">
                    <span className="text-xs">{dot}</span>
                    <span className="text-[11px] font-bold" style={{ color }}>{level}</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      {actions.map(a => (
                        <span
                          key={a}
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                    <p className="text-[10px]" style={{ color: "var(--text-subtle)" }}>{hint}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── SECTION 4: FAQ & 상세 (Collapsible) ──────────────── */}
          <section>
            <button
              className="w-full flex items-center justify-between mb-2 group"
              onClick={() => setFaqOpen(v => !v)}
            >
              <SectionLabel>04 · FAQ &amp; 상세 규칙</SectionLabel>
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded transition-colors"
                style={{
                  color: faqOpen ? "#60a5fa" : "var(--text-subtle)",
                  background: faqOpen ? "rgba(96,165,250,0.1)" : "var(--bg-overlay)",
                  border: "1px solid var(--border)",
                  marginTop: "-8px",
                }}
              >
                {faqOpen ? "접기 ↑" : "펼치기 ↓"}
              </span>
            </button>

            {faqOpen && (
              <div className="space-y-3">
                {/* 데이터 동기화 */}
                <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                  <p
                    className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ background: "var(--bg-item)", borderBottom: "1px solid var(--border)", color: "var(--text-subtle)" }}
                  >
                    데이터 동기화
                  </p>
                  {[
                    {
                      badge: "F5",
                      badgeColor: "#34d399",
                      label: "플래닝 · 메모 · 일정 · 코멘트",
                      desc: "변경 즉시 저장 → 페이지 새로고침으로 반영",
                    },
                    {
                      badge: "Jira Sync",
                      badgeColor: "#60a5fa",
                      label: "티켓 상태 · 담당자 · ETA",
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
                        <p style={{ color: (stale ?? false) ? "#f87171" : undefined }}>{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 티켓 제목 규칙 */}
                <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                  <div
                    className="flex items-center gap-2 px-3 py-2"
                    style={{ background: "var(--bg-item)", borderBottom: "1px solid var(--border)" }}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-subtle)" }}>
                      티켓 제목 규칙
                    </p>
                    <span
                      className="text-[9px] font-medium px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.3)", color: "#fbbf24" }}
                    >
                      룰 정의 예정
                    </span>
                  </div>
                  <div className="px-3 py-3 space-y-2.5" style={{ background: "var(--bg-overlay)" }}>
                    <p style={{ color: "var(--text-muted)" }}>도메인·대상 필터와 월별 현황이 제목 형식 기준으로 자동 분류됩니다.</p>
                    <div className="rounded px-2.5 py-2 font-mono text-[11px] leading-relaxed" style={{ background: "var(--bg-item)", color: "var(--text-primary)" }}>
                      [도메인][29CM] 제목<br />
                      [도메인][29Connect] 제목
                    </div>
                    <div className="space-y-1.5 text-[11px]">
                      {[
                        { tag: "[결제], [카탈로그] …", desc: "첫 번째 태그 → 도메인 필터 및 월별 현황에 반영" },
                        { tag: "[29CM]", desc: "두 번째 태그 → 대상 필터 \"29CM\" 으로 분류" },
                        { tag: "[29Connect]", desc: "두 번째 태그 → 대상 필터 \"29Connect\" 로 분류" },
                        { tag: "두 번째 태그 없음", desc: "대상 필터에서 미분류" },
                        { tag: "첫 번째 태그 없음", desc: "도메인 → \"기타\" 로 분류됨" },
                      ].map(({ tag, desc }) => (
                        <div key={tag} className="flex items-start gap-2">
                          <code
                            className="shrink-0 px-1.5 py-0.5 rounded text-[10px]"
                            style={{ background: "var(--bg-item)", color: "#60a5fa", border: "1px solid var(--border-2)" }}
                          >
                            {tag}
                          </code>
                          <span style={{ color: "var(--text-muted)" }}>{desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* FAQ */}
                <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                  <p
                    className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ background: "var(--bg-item)", borderBottom: "1px solid var(--border)", color: "var(--text-subtle)" }}
                  >
                    자주 묻는 질문
                  </p>
                  <div style={{ background: "var(--bg-overlay)" }}>
                    {[
                      {
                        q: "필터의 \"대상\" 은 무엇인가요?",
                        a: "티켓 제목이 [29CM] 또는 [29Connect] 로 시작하는지 기준으로 구분합니다.",
                      },
                      {
                        q: "도메인 필터에서 \"기타\" 로 뜨는 티켓이 있어요",
                        a: "제목에 [도메인][29CM] 형식이 없으면 기타로 분류됩니다. 제목 수정 후 Jira Sync를 누르면 반영됩니다.",
                      },
                      {
                        q: "내가 바꾼 플래닝 상태를 동료가 못 보는 경우",
                        a: "동료가 F5로 새로고침하면 즉시 반영됩니다.",
                      },
                      {
                        q: "완료된 티켓에 일정 정보가 없어요",
                        a: "2026/5/12 기준, 완료 처리된 티켓은 상세 일정을 마이그레이션하지 않았습니다.",
                      },
                      {
                        q: "JIRA에서 상태를 바꿨는데 대시보드에 반영 안 됨",
                        a: "상단 Jira Sync 버튼을 눌러 12시간 캐시를 갱신하세요.",
                      },
                      {
                        q: "티켓을 추가하고 싶어요",
                        a: "상단 검색창에 티켓 번호(예: TM-1234)를 입력 후 Enter — 팀원 모두에게 영구 표시됩니다.",
                      },
                    ].map(({ q, a }, i) => (
                      <div
                        key={q}
                        className="px-3 py-2.5"
                        style={{ borderTop: i > 0 ? "1px solid var(--border)" : "none" }}
                      >
                        <p className="font-medium mb-0.5" style={{ color: "var(--text-primary)" }}>Q. {q}</p>
                        <p style={{ color: "var(--text-muted)" }}>→ {a}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>

        </div>

        {/* ── Footer ──────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0"
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
            Wiki 상세보기
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
