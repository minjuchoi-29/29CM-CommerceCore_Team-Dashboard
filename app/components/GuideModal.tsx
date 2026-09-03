"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  onClose: () => void;
};

type GuideCardProps = {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
};

const WIKI_URL =
  "https://wiki.team.musinsa.com/wiki/spaces/29PRODUCT/pages/413730348/29CM+Team+Dashboard";
const TICKET_CACHE_KEY = "cc-tickets-v2";

const LIFECYCLE_ITEMS = [
  {
    label: "플래닝 대기·검토",
    description: "필요한 팀, 플래닝 상태, 예정 스프린트와 논의 메모를 확인합니다.",
  },
  {
    label: "진행 중",
    description: "최근 Weekly 공유사항, 팀별 현재 단계와 실제 작업 일정을 확인합니다.",
  },
  {
    label: "최근 완료",
    description: "완료 뒤 14일 동안 Weekly 보고와 남은 후속조치를 이어서 확인합니다.",
  },
];

const REVIEW_MODE_ITEMS = [
  {
    label: "위클리 체크",
    description: "이번 위클리 미팅에서 업데이트를 함께 확인할 티켓입니다.",
  },
  {
    label: "모니터링",
    description: "담당·요청 관계가 있어 진행 상황을 정기적으로 지켜볼 티켓입니다.",
  },
  {
    label: "필요 시 확인",
    description: "참조 관계 등으로 포함되며, 변화나 이슈가 있을 때 확인합니다.",
  },
];

function getCachedSyncInfo(): { label: string; isStale: boolean } | null {
  try {
    const raw = localStorage.getItem(TICKET_CACHE_KEY);
    if (!raw) return null;

    const { fetchedAt } = JSON.parse(raw) as { fetchedAt?: string };
    if (!fetchedAt) return null;

    const date = new Date(fetchedAt);
    if (Number.isNaN(date.getTime())) return null;

    const diffMs = Math.max(0, Date.now() - date.getTime());
    const diffMinutes = Math.floor(diffMs / 60_000);
    const isStale = diffMs >= 12 * 60 * 60 * 1_000;
    const isToday = date.toDateString() === new Date().toDateString();
    const time = date.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const day = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
    const dateLabel = isToday
      ? `오늘 ${time}`
      : `${date.getMonth() + 1}/${date.getDate()}(${day}) ${time}`;
    const agoLabel =
      diffMinutes < 60
        ? `${diffMinutes}분 전`
        : `${Math.floor(diffMinutes / 60)}시간 전`;

    return { label: `${dateLabel} · ${agoLabel}`, isStale };
  } catch {
    return null;
  }
}

function SectionLabel({ index, children }: { index: string; children: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span
        className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold"
        style={{ background: "#0f766e", color: "white" }}
      >
        {index}
      </span>
      <h3 className="text-[15px] font-bold" style={{ color: "var(--text-primary)" }}>
        {children}
      </h3>
    </div>
  );
}

function GuideCard({ eyebrow, title, description, children }: GuideCardProps) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}
    >
      <p className="mb-1 text-[11px] font-bold" style={{ color: "#0f766e" }}>
        {eyebrow}
      </p>
      <p className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </p>
      <p className="mt-1 text-[12px] leading-5" style={{ color: "var(--text-muted)" }}>
        {description}
      </p>
      {children}
    </div>
  );
}

function Path({ children }: { children: ReactNode }) {
  return (
    <div
      className="mt-3 rounded-lg px-3 py-2 text-[11px] font-semibold leading-5"
      style={{ background: "#ecfdf5", color: "#115e59", border: "1px solid #a7f3d0" }}
    >
      {children}
    </div>
  );
}

export default function GuideModal({ onClose }: Props) {
  const [faqOpen, setFaqOpen] = useState(false);
  const syncInfo = typeof window === "undefined" ? null : getCachedSyncInfo();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof window === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      style={{ background: "rgba(15, 23, 42, 0.56)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-guide-title"
        className="flex max-h-[90vh] w-full max-w-[860px] flex-col overflow-hidden rounded-2xl shadow-2xl"
        style={{ background: "var(--bg-canvas)", border: "1px solid var(--border)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <header
          className="flex shrink-0 items-start justify-between gap-4 px-6 py-5"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2
                id="dashboard-guide-title"
                className="text-[20px] font-bold"
                style={{ color: "var(--text-primary)" }}
              >
                대시보드 사용 가이드
              </h2>
              <span
                className="rounded-full px-2 py-1 text-[10px] font-bold"
                style={{ background: "#ccfbf1", color: "#115e59" }}
              >
                2026.09 업데이트
              </span>
            </div>
            <p className="text-[13px] leading-5" style={{ color: "var(--text-muted)" }}>
              위클리 미팅, 스프린트 프리플래닝, ETR 요청 검토에 필요한 화면과 기능만 빠르게 찾을 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            aria-label="사용 가이드 닫기"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg transition-colors hover:bg-slate-100"
            style={{ color: "var(--text-muted)" }}
          >
            ×
          </button>
        </header>

        <div className="space-y-7 overflow-y-auto px-6 py-6">
          <section>
            <SectionLabel index="1">회의 목적별 빠른 시작</SectionLabel>
            <div className="grid gap-3 md:grid-cols-2">
              <GuideCard
                eyebrow="매주"
                title="위클리 미팅"
                description="진행 중 과제의 최신 공유 내용과 실제 일정을 티켓 순서대로 확인합니다."
              >
                <Path>전체 과제 → 진행 중 → 위클리 체크 → 티켓 선택 → 집중 보기</Path>
              </GuideCard>
              <GuideCard
                eyebrow="격주"
                title="스프린트 프리플래닝"
                description="아직 시작하지 않은 과제의 필요 팀, 검토 상태, 예정 스프린트와 논의 메모를 관리합니다."
              >
                <Path>전체 과제 → 플래닝 대기·검토 → 검토할 티켓 선택</Path>
              </GuideCard>
              <GuideCard
                eyebrow="요청 접수부터 종결까지"
                title="ETR 검토"
                description="요구사항을 이해하고 실제 실행 티켓과 연결한 뒤, 작업 완료 후 ETR 종결까지 이어서 확인합니다."
              >
                <Path>ETR 검토 → 처리 필요 → 요구사항 확인 → 실행 티켓 연결 → 완료 확인</Path>
              </GuideCard>
              <GuideCard
                eyebrow="개인 업무"
                title="내 후속조치 확인"
                description="내가 담당하거나 확인해야 하는 티켓을 모아서 우선순위대로 살펴봅니다."
              >
                <Path>담당자 → 내 티켓 → 필요한 항목 확인</Path>
              </GuideCard>
            </div>
          </section>

          <section>
            <SectionLabel index="2">목록·빠른 미리보기·집중 보기</SectionLabel>
            <div className="grid gap-3 md:grid-cols-3">
              <GuideCard
                eyebrow="넓게 찾기"
                title="목록"
                description="상태와 필터로 대상을 좁히고 핵심 정보만 비교합니다. 선택한 조건은 URL에 저장되어 그대로 공유할 수 있습니다."
              />
              <GuideCard
                eyebrow="맥락 유지"
                title="빠른 미리보기"
                description="목록을 유지한 채 최근 Weekly와 주요 상태를 먼저 확인합니다. ‘목록으로’ 버튼으로 바로 닫을 수 있습니다."
              />
              <GuideCard
                eyebrow="회의 진행"
                title="집중 보기"
                description="필터로 좁힌 티켓 목록을 왼쪽에 유지하고, 다른 티켓으로 연속 이동하며 Weekly와 세부 일정을 확인합니다."
              />
            </div>
          </section>

          <section>
            <SectionLabel index="3">검색·추가·동기화 사용법</SectionLabel>
            <div
              className="overflow-hidden rounded-xl"
              style={{ border: "1px solid var(--border)" }}
            >
              {[
                {
                  title: "검색",
                  description: "대시보드에 등록된 티켓의 번호·제목·담당자를 검색합니다. 검색 결과를 선택하면 해당 목록에서도 선택 상태가 표시됩니다.",
                },
                {
                  title: "+ 티켓 추가",
                  description: "Jira 티켓 번호를 입력하면 프로젝트와 현재 상태를 확인해 전체 과제 또는 ETR 검토에 자동으로 배치합니다. 저장 성공 후 다른 사용자도 새로고침하면 볼 수 있습니다.",
                },
                {
                  title: "Jira Sync",
                  description: "데이터 소스의 포함 대상과 변경된 Jira 메타 정보를 갱신합니다. 변경된 진행 중·최근 완료 티켓의 Weekly 갱신은 백그라운드에서 이어집니다.",
                },
                {
                  title: "Weekly 갱신",
                  description: "상세 화면에서 현재 티켓 하나의 Weekly 공유사항만 빠르게 다시 가져옵니다. 회의 직전 특정 티켓 확인에 적합합니다.",
                },
                {
                  title: "플래닝 티켓 갱신",
                  description: "플래닝 대기·검토 티켓의 Jira 상태와 담당자 등 메타 정보만 갱신합니다. Weekly 공유사항은 조회하지 않습니다.",
                },
              ].map((item, index) => (
                <div
                  key={item.title}
                  className="grid gap-1 px-4 py-3 md:grid-cols-[140px_1fr] md:gap-4"
                  style={{
                    background: index % 2 === 0 ? "var(--bg-overlay)" : "var(--bg-canvas)",
                    borderTop: index === 0 ? undefined : "1px solid var(--border)",
                  }}
                >
                  <p className="text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
                    {item.title}
                  </p>
                  <p className="text-[12px] leading-5" style={{ color: "var(--text-muted)" }}>
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
            {syncInfo && (
              <p
                className="mt-2 text-right text-[11px]"
                style={{ color: syncInfo.isStale ? "#b45309" : "var(--text-subtle)" }}
              >
                이 브라우저의 마지막 Jira 갱신: {syncInfo.label}
                {syncInfo.isStale ? " · 최신 상태 확인 권장" : ""}
              </p>
            )}
          </section>

          <section>
            <SectionLabel index="4">상태와 확인 방식의 의미</SectionLabel>
            <div className="grid gap-3 md:grid-cols-2">
              <div
                className="rounded-xl p-4"
                style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}
              >
                <p className="mb-3 text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
                  과제 진행 단계
                </p>
                <div className="space-y-3">
                  {LIFECYCLE_ITEMS.map((item) => (
                    <div key={item.label}>
                      <p className="text-[12px] font-semibold" style={{ color: "#0f766e" }}>
                        {item.label}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-5" style={{ color: "var(--text-muted)" }}>
                        {item.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div
                className="rounded-xl p-4"
                style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)" }}
              >
                <p className="mb-3 text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
                  확인 방식
                </p>
                <div className="space-y-3">
                  {REVIEW_MODE_ITEMS.map((item) => (
                    <div key={item.label}>
                      <p className="text-[12px] font-semibold" style={{ color: "#0f766e" }}>
                        {item.label}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-5" style={{ color: "var(--text-muted)" }}>
                        {item.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p
              className="mt-3 rounded-lg px-3 py-2 text-[11px] leading-5"
              style={{ background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}
            >
              일정 재확인이나 참고 표시는 담당자 또는 과제 품질에 대한 평가가 아닙니다. Jira와 Weekly에 기록된 날짜·상태 중 회의에서 확인할 사실을 알려주는 보조 정보입니다.
            </p>
          </section>

          <section>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 text-left"
              aria-expanded={faqOpen}
              onClick={() => setFaqOpen((open) => !open)}
            >
              <SectionLabel index="5">자주 묻는 질문</SectionLabel>
              <span
                className="mb-3 rounded-lg px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: "var(--bg-overlay)", color: "#0f766e", border: "1px solid var(--border)" }}
              >
                {faqOpen ? "접기 ↑" : "펼치기 ↓"}
              </span>
            </button>
            {faqOpen && (
              <div
                className="overflow-hidden rounded-xl"
                style={{ border: "1px solid var(--border)" }}
              >
                {[
                  {
                    question: "찾는 티켓이 목록에 없어요.",
                    answer: "한 건만 관리하려면 ‘+ 티켓 추가’를 사용합니다. 팀원 담당·보고·참조 티켓을 자동으로 포함하려면 데이터 소스 조건을 확인합니다.",
                  },
                  {
                    question: "같은 필터 화면을 동료에게 보내고 싶어요.",
                    answer: "필터를 선택한 뒤 현재 URL을 그대로 복사해 공유합니다. 복수 선택, 플래닝 상태, 확인 방식과 정렬 조건도 함께 열립니다.",
                  },
                  {
                    question: "어떤 동기화 버튼을 눌러야 하나요?",
                    answer: "전체 포함 대상과 Jira 상태는 ‘Jira Sync’, 한 티켓의 최신 공유사항은 상세 화면의 ‘Weekly 갱신’, 플래닝 대상 메타만 확인할 때는 ‘플래닝 티켓 갱신’을 사용합니다.",
                  },
                  {
                    question: "내가 입력한 메모나 일정은 언제 공유되나요?",
                    answer: "공용 저장소에 저장되면 다른 사용자도 새로고침 후 확인할 수 있습니다. 자동 Weekly 파싱은 기존 수동 일정과 메모를 덮어쓰지 않습니다.",
                  },
                  {
                    question: "Weekly 공유사항을 어떻게 작성해야 하나요?",
                    answer: "날짜, 팀, 작업 단계가 분명할수록 세부 일정이 정확해집니다. 아래 ‘Weekly 작성 가이드’에서 권장 예시를 확인하세요.",
                  },
                ].map((item, index) => (
                  <div
                    key={item.question}
                    className="px-4 py-3"
                    style={{
                      background: index % 2 === 0 ? "var(--bg-overlay)" : "var(--bg-canvas)",
                      borderTop: index === 0 ? undefined : "1px solid var(--border)",
                    }}
                  >
                    <p className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
                      {item.question}
                    </p>
                    <p className="mt-1 text-[11px] leading-5" style={{ color: "var(--text-muted)" }}>
                      {item.answer}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <footer
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-6 py-4"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>
            ESC 또는 바깥 영역을 누르면 닫힙니다.
          </p>
          <div className="flex items-center gap-2">
            <Link
              href="/weekly-guide"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-[12px] font-semibold"
              style={{ color: "#0f766e", border: "1px solid #99f6e4", background: "#f0fdfa" }}
            >
              Weekly 작성 가이드
            </Link>
            <a
              href={WIKI_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg px-3 py-2 text-[12px] font-semibold"
              style={{ color: "white", background: "#0f766e" }}
            >
              Wiki 상세보기 ↗
            </a>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
