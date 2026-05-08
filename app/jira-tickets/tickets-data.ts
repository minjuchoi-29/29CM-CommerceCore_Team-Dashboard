import type { Ticket } from "./TicketBoard";

/**
 * 관리할 티켓 key 목록 — 티켓 추가/삭제는 여기서만
 * summary, status, assignee, eta 등은 JIRA에서 자동 sync됨
 */
export const TICKET_KEYS: string[] = [
  // ── 진행중 ──────────────────────────────────────────────────
  "TM-1241",        // [쿠폰] 파트너 쿠폰 대시보드 제공 (ETA: 6/8)
  "TM-2727",        // [쿠폰] 이구위크 브랜드 첫구매 쿠폰 (ETA: 5/26)
  "TM-1845",        // [결제] 무신사페이 도입 (ETA: 4/21)
  "TM-1846",        // [결제] 제휴카드 도입 (ETA: 4/27)
  "TM-1871",        // [결제] 교환 배송비 결제 시스템화 (ETA: 5/11)
  "TM-1886",        // [리뷰] 신고 프로세스 개선
  "TM-2853",        // [카탈로그] SCM Hub O-SKU 전환
  "TM-1842",        // [쿠폰] 브랜드 장바구니 쿠폰 도입 & 합구매 넛징 (ETA: 6/22)
  "TM-2155",        // [CS] AI Chat Agent 1:1문의 진입점 A/B 테스트
  // ── 진행완료 ─────────────────────────────────────────────────
  "TM-1246",        // [CS] AI 챗봇 파일럿 구축 - PoC
  "TM-1844",        // [쿠폰] 장바구니 쿠폰가 노출 - PLP/PDP
  "TM-2160",        // [정산] 오프라인 판매분 매입 전환 (ETA: 4/27)
  "M29CMCCF-1481",  // [CS] 인하우스 주문조회 관리카테고리 필터
  "M29CMCCF-1464",  // [정산] 수수료 입력 소수점 입력값 제한
  "TM-1893",        // [카탈로그] 속성 집계 시스템 구축 (ETA: 3/31)
  // ── 진행예정 ─────────────────────────────────────────────────
  "TM-1283",        // [장바구니] 할인 UX 고도화 Phase 2
  "TM-1889",        // [장바구니] 결제할인 추천 넛지
  "TM-1874",        // [AI] Visual Search PDP (ETA: 8월말)
  "TM-1843",        // [정산] 할인/수수료 자동화 시스템 구축
];

/**
 * JIRA에 없는 추가 정보 — roles는 cc-schedules KV가 단일 소스
 * Excel Gantt에서 파싱해 KV에 직접 씀 (/tmp/gantt_to_kv.py)
 * roles를 여기서 직접 수정하지 말 것 — KV가 우선하므로 반영 안 됨
 *
 * TM-1846은 Excel Gantt에 없어 KV에 없음 → 아래 roles 사용
 */
export const TICKET_OVERRIDES: Record<string, Partial<Omit<Ticket, "key">>> = {

  // TM-1846 · [결제][29CM] 제휴카드 도입  ETA: 4/27  (완료)
  // Excel Gantt에 별도 섹션 없음 (TM-1845와 동일 팀/일정으로 진행)
  "TM-1846": {
    roles: [
      { role: "기획",    person: "정유민",           start: "2026-01-15", end: "2026-02-25", status: "완료" },
      { role: "디자인",  person: "손효정",           start: "2026-01-19", end: "2026-04-24", status: "완료" },
      { role: "BE-SP",   person: "정다해 / 정태훈",  start: "2026-02-12", end: "2026-03-31", status: "완료" },
      { role: "BE-PP",   person: "최승원 / MZ",      start: "2026-02-09", end: "2026-04-03", status: "완료" },
      { role: "FE-CFE",  person: "백주은 / 방창배",  start: "2026-02-09", end: "2026-04-03", status: "완료" },
      { role: "Mobile",  person: "곽진규 / 김중원",  start: "2026-03-30", end: "2026-04-10", status: "완료" },
      { role: "DA",      person: "김승주",            start: "2026-04-01", end: "2026-04-01", status: "완료" },
      { role: "QA",      person: "조진현 / 강보민",  start: "2026-03-30", end: "2026-04-24", status: "완료" },
      { role: "배포",    person: "-",                 start: "2026-04-27", end: "2026-04-27", status: "완료" },
    ],
  },
};
