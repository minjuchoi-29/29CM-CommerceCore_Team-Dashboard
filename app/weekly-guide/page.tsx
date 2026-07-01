/**
 * Weekly 작성 가이드 — 1분 안에 읽고 바로 작성 가능한 Quick Guide.
 *
 * 정적 콘텐츠 페이지. API 호출 / KV 조회 없음.
 * Dashboard 의 Weekly Sync 정책 (description 우선, comment fallback) 에
 * 맞춰 운영자가 어디에 어떻게 작성해야 하는지 안내.
 *
 * 디자인: GuideModal (기존 사용 가이드) 의 typography / card 스타일 재사용
 *   - SectionLabel (uppercase tracking-widest)
 *   - var(--bg-overlay) 카드 + var(--border) 테두리
 *   - grid layout (모바일에서 세로 스택)
 */
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Weekly 작성 가이드 — 29CM Commerce Core Dashboard",
  description:
    "Dashboard 일정은 Weekly 공유사항의 📅 일정 영역을 기준으로 자동 반영됩니다. 어디에 어떻게 작성해야 하는지 확인하세요.",
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[10px] font-bold uppercase tracking-widest mb-2.5"
      style={{ color: "var(--text-subtle)" }}
    >
      {children}
    </p>
  );
}

function Card({
  children,
  accentColor,
  bgColor,
  borderColor,
}: {
  children: React.ReactNode;
  accentColor?: string;
  bgColor?: string;
  borderColor?: string;
}) {
  return (
    <div
      className="rounded-lg p-4 flex flex-col gap-2"
      style={{
        background: bgColor ?? "var(--bg-overlay)",
        border: `1px solid ${borderColor ?? "var(--border)"}`,
        color: accentColor,
      }}
    >
      {children}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function WeeklyGuidePage() {
  return (
    <main
      className="min-h-screen w-full"
      style={{ background: "var(--bg-canvas)", color: "var(--text-primary)" }}
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-10">
        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl leading-none">📝</span>
            <h1
              className="text-2xl sm:text-3xl font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              Weekly 작성 가이드
            </h1>
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{
                background: "rgba(96,165,250,0.12)",
                border: "1px solid rgba(96,165,250,0.25)",
                color: "#60a5fa",
              }}
            >
              Quick Guide
            </span>
          </div>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            Dashboard 일정은{" "}
            <strong style={{ color: "var(--text-primary)" }}>
              Weekly 공유사항
            </strong>
            의{" "}
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium"
              style={{
                background: "rgba(52,211,153,0.10)",
                border: "1px solid rgba(52,211,153,0.30)",
                color: "#34d399",
              }}
            >
              📅 일정
            </span>{" "}
            영역을 기준으로 자동 반영됩니다.
          </p>
        </header>

        {/* ── ① 어디에 작성하나요? ─────────────────────────────── */}
        <section className="mb-8">
          <SectionLabel>① 어디에 작성하나요?</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card
              bgColor="rgba(96,165,250,0.06)"
              borderColor="rgba(96,165,250,0.25)"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-base leading-none">🎯</span>
                <p
                  className="text-[13px] font-semibold"
                  style={{ color: "#60a5fa" }}
                >
                  TM(Initiative)
                </p>
              </div>
              <p
                className="text-xs leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                티켓의{" "}
                <strong style={{ color: "var(--text-primary)" }}>
                  Description
                </strong>{" "}
                에 <code>Weekly 공유사항</code> 섹션을 만들어 작성하세요.
              </p>
              <div
                className="mt-1 rounded px-2 py-1 text-[11px] font-medium"
                style={{
                  background: "rgba(96,165,250,0.10)",
                  color: "#60a5fa",
                  border: "1px solid rgba(96,165,250,0.25)",
                }}
              >
                한 곳에서 최신 상태 유지 (LIVE truth)
              </div>
            </Card>

            <Card
              bgColor="rgba(167,139,250,0.06)"
              borderColor="rgba(167,139,250,0.25)"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-base leading-none">🔧</span>
                <p
                  className="text-[13px] font-semibold"
                  style={{ color: "#a78bfa" }}
                >
                  유지보수 / 운영 티켓
                </p>
              </div>
              <p
                className="text-xs leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                티켓의{" "}
                <strong style={{ color: "var(--text-primary)" }}>
                  Comment
                </strong>
                에 주차별로 누적 작성하세요.
              </p>
              <div
                className="mt-1 rounded px-2 py-1 text-[11px] font-medium"
                style={{
                  background: "rgba(167,139,250,0.10)",
                  color: "#a78bfa",
                  border: "1px solid rgba(167,139,250,0.25)",
                }}
              >
                &lt;NN&gt;주차 Weekly 공유사항 형식
              </div>
            </Card>
          </div>
        </section>

        {/* ── ② 권장 작성 형식 ────────────────────────────────── */}
        <section className="mb-8">
          <SectionLabel>② 권장 작성 형식</SectionLabel>
          <Card>
            <p
              className="text-[11px] font-semibold mb-2"
              style={{ color: "var(--text-primary)" }}
            >
              예시
            </p>
            <pre
              className="text-xs leading-relaxed rounded-md p-3 overflow-x-auto"
              style={{
                background: "var(--bg-canvas)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-geist-mono), monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >{`Weekly 공유사항

📅 일정
- 6/15~6/28 QA
- 6/29 대고객 런칭
- 7/5 회고

📝 진행 상황
- QA 시나리오 작성 완료
- 스테이징 배포 준비 중

⚠ 이슈 / 리스크
- 결제 API 응답 지연 이슈 확인 중`}</pre>
            <p
              className="text-[11px] mt-2"
              style={{ color: "var(--text-muted)", lineHeight: 1.6 }}
            >
              <strong style={{ color: "var(--text-primary)" }}>📅 일정</strong>{" "}
              아래 항목만 Dashboard 의 일정에 자동 반영됩니다.
              나머지 섹션은 참고 노트로만 남습니다.
            </p>
          </Card>
        </section>

        {/* ── ③ 이것만 지켜주세요 ─────────────────────────────── */}
        <section className="mb-8">
          <SectionLabel>③ 이것만 지켜주세요</SectionLabel>
          <div className="grid grid-cols-1 gap-2">
            {[
              {
                emoji: "📅",
                title: "일정은 📅 일정 아래에 작성",
                body: "다른 섹션에 쓴 날짜는 Dashboard 에 반영되지 않습니다.",
                accent: "#34d399",
                bg: "rgba(52,211,153,0.06)",
                border: "rgba(52,211,153,0.25)",
              },
              {
                emoji: "🗓",
                title: "날짜를 함께 작성",
                body: "예: 6/15~6/28 QA / 6/29 대고객 런칭 — 시작·종료일이 있어야 Gantt 에 표시됩니다.",
                accent: "#60a5fa",
                bg: "rgba(96,165,250,0.06)",
                border: "rgba(96,165,250,0.25)",
              },
              {
                emoji: "🧭",
                title: "일정과 메모를 구분",
                body: "일정 = 시작/종료 날짜가 있는 실행 항목. 진행 노트 / 리스크는 별도 섹션으로.",
                accent: "#818cf8",
                bg: "rgba(129,140,248,0.06)",
                border: "rgba(129,140,248,0.25)",
              },
              {
                emoji: "❌",
                title: '"다음주" 대신 날짜를 명시',
                body: '"다음주 배포" 처럼 상대 표현은 파싱 실패. "7/5 배포" 같이 절대 날짜로 작성하세요.',
                accent: "#fb923c",
                bg: "rgba(251,146,60,0.06)",
                border: "rgba(251,146,60,0.25)",
              },
            ].map(({ emoji, title, body, accent, bg, border }) => (
              <div
                key={title}
                className="rounded-lg p-3 flex items-start gap-2.5"
                style={{ background: bg, border: `1px solid ${border}` }}
              >
                <span className="text-base leading-none mt-0.5">{emoji}</span>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-[12.5px] font-semibold mb-0.5"
                    style={{ color: accent }}
                  >
                    {title}
                  </p>
                  <p
                    className="text-[11.5px] leading-relaxed"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── ④ 왜 필요한가요? ────────────────────────────────── */}
        <section>
          <SectionLabel>④ 왜 필요한가요?</SectionLabel>
          <Card>
            <div className="flex items-center gap-1.5">
              <span className="text-base leading-none">⚡</span>
              <p
                className="text-[13px] font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                Dashboard 일정 자동 생성
              </p>
            </div>
            <p
              className="text-xs leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              매주 <strong style={{ color: "var(--text-primary)" }}>Jira Sync</strong>{" "}
              버튼 클릭 시 Weekly 공유사항의 📅 일정을 파서가 읽어 Gantt / 스케줄 표에{" "}
              <strong style={{ color: "var(--text-primary)" }}>자동 반영</strong>
              합니다.
            </p>
            <p
              className="text-xs leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              별도의 스케줄 입력 없이 Jira 티켓 하나만 잘 써두면 팀 전체가
              최신 일정을 공유할 수 있습니다.
            </p>
            <div
              className="mt-1 rounded px-2 py-1.5 text-[11px] font-medium"
              style={{
                background: "rgba(52,211,153,0.10)",
                color: "#34d399",
                border: "1px solid rgba(52,211,153,0.30)",
              }}
            >
              한 번 잘 써두면 매주 별도 입력 불필요
            </div>
          </Card>
        </section>

        {/* ── Footer note ────────────────────────────────────── */}
        <p
          className="mt-8 text-[11px] text-center"
          style={{ color: "var(--text-subtle)" }}
        >
          문의 · 피드백은 팀 채널에 남겨주세요.
        </p>
      </div>
    </main>
  );
}
