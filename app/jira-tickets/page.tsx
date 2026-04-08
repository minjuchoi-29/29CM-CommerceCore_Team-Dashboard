"use client";
import { useState, useMemo, useEffect } from "react";

const JIRA_BASE = "https://jira.team.musinsa.com/browse/";

const STATUS_COLOR: Record<string, string> = {
  "론치완료": "bg-green-100 text-green-700",
  "완료": "bg-green-100 text-green-700",
  "배포완료": "bg-green-100 text-green-700",
  "개발중": "bg-blue-100 text-blue-700",
  "In Progress": "bg-blue-100 text-blue-700",
  "QA중": "bg-purple-100 text-purple-700",
  "디자인완료": "bg-purple-50 text-purple-500",
  "기획중": "bg-orange-100 text-orange-700",
  "기획완료": "bg-green-50 text-green-600",
  "SUGGESTED": "bg-gray-100 text-gray-500",
  "HOLD": "bg-yellow-100 text-yellow-700",
  "Postponed": "bg-yellow-100 text-yellow-700",
  "철회/반려/취소": "bg-red-100 text-red-600",
  "준비중": "bg-yellow-50 text-yellow-600",
  "디자인중": "bg-purple-50 text-purple-400",
  "Backlog": "bg-gray-100 text-gray-400",
};

const ROLE_COLOR: Record<string, string> = {
  "기획":    "bg-indigo-400",
  "디자인":  "bg-violet-400",
  "BE-SP":   "bg-blue-600",
  "BE-PP":   "bg-blue-400",
  "BE-CE":   "bg-blue-300",
  "FE-CFE":  "bg-cyan-500",
  "FE-DFE":  "bg-cyan-400",
  "Mobile":  "bg-teal-400",
  "QA":      "bg-emerald-500",
  // legacy keys (backward compat)
  "개발BE":  "bg-blue-500",
  "개발FE":  "bg-cyan-500",
};

type RoleSchedule = {
  role: string;
  person: string;
  start: string;
  end: string;
  status: "완료" | "진행중" | "예정";
};

type Ticket = {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  eta: string;
  type: string;
  project: string;
  roles?: RoleSchedule[];
  description?: string;
};

// Gantt: 2026-01-01 ~ 2026-06-30
const G_START = new Date("2026-01-01").getTime();
const G_SPAN  = new Date("2026-06-30").getTime() - G_START;

function toPct(d: string): number {
  const t = new Date(d).getTime();
  return Math.max(0, Math.min(100, ((t - G_START) / G_SPAN) * 100));
}
function spanPct(s: string, e: string): number {
  return Math.max(0.5, ((new Date(e).getTime() - new Date(s).getTime()) / G_SPAN) * 100);
}

const GANTT_MONTHS = [
  { label: "1월", pct: 0 },
  { label: "2월", pct: 17.1 },
  { label: "3월", pct: 32.6 },
  { label: "4월", pct: 49.7 },
  { label: "5월", pct: 66.3 },
  { label: "6월", pct: 83.4 },
];

const TODAY_PCT = toPct(new Date().toISOString().slice(0, 10));

const raw: Ticket[] = [
  // TM
  { key: "TM-814",  summary: "[파트너] [29Connect] 일반 할인 셀프서비스 도입",                           status: "론치완료",       assignee: "양유주",  eta: "2026-03-16", type: "Initiative", project: "TM" },
  { key: "TM-1241", summary: "[쿠폰] [29Connect] 파트너 쿠폰 대시보드 제공",                             status: "개발중",         assignee: "양유주",  eta: "2026-06-08", type: "Initiative", project: "TM",
    roles: [
      { role: "기획",   person: "양유주",   start: "2026-01-05", end: "2026-03-01", status: "완료" },
      { role: "디자인", person: "미정",     start: "2026-02-15", end: "2026-03-31", status: "완료" },
      { role: "개발BE", person: "미정",     start: "2026-03-20", end: "2026-05-31", status: "진행중" },
      { role: "개발FE", person: "미정",     start: "2026-04-01", end: "2026-06-08", status: "예정" },
      { role: "QA",     person: "미정",     start: "2026-05-20", end: "2026-06-08", status: "예정" },
    ],
  },
  { key: "TM-1244", summary: "[티켓] [29CM] 티켓 양도 기능 도입 - 지정좌석예매, Iter. 2",                status: "론치완료",       assignee: "양유주",  eta: "2026-03-05", type: "Initiative", project: "TM" },
  { key: "TM-1246", summary: "[CS] [29CM] AI 챗봇 파일럿 구축 - PoC",                                   status: "론치완료",       assignee: "좌예슬",  eta: "2026-03-27", type: "Initiative", project: "TM" },
  { key: "TM-1247", summary: "[티켓] [29CM] 선예매 기능 도입 - 지정좌석예매, Iter. 2",                   status: "론치완료",       assignee: "양유주",  eta: "2026-02-05", type: "Initiative", project: "TM" },
  { key: "TM-1283", summary: "[장바구니] [29CM] 할인 UX 고도화 - Phase 2. Urgency 강화",                 status: "HOLD",           assignee: "정유민",  eta: "2026-01-30", type: "Initiative", project: "TM" },
  { key: "TM-1297", summary: "[쿠폰] [29CM] 브랜드홈 쿠폰 노출 강화",                                    status: "론치완료",       assignee: "백수지",  eta: "2026-01-07", type: "Initiative", project: "TM" },
  { key: "TM-1838", summary: "[티켓] [29CM] 0원 상품 예약 기능 도입 - 지정좌석예매",                      status: "론치완료",       assignee: "양유주",  eta: "2026-02-26", type: "Initiative", project: "TM" },
  { key: "TM-1839", summary: "[티켓] [29CM] 결제혜택 정보 관리 및 제공 - 지정좌석예매",                   status: "론치완료",       assignee: "양유주",  eta: "2026-02-05", type: "Initiative", project: "TM" },
  { key: "TM-1840", summary: "[링펜스] [29CM] KC 인증번호 노출 연동 - PDP",                              status: "론치완료",       assignee: "좌예슬",  eta: "2026-01-13", type: "Initiative", project: "TM" },
  { key: "TM-1842", summary: "[쿠폰] [29Connect] 브랜드 장바구니 쿠폰 도입 & 합구매 넛징",               status: "디자인완료",     assignee: "양유주",  eta: "2026-06-30", type: "Initiative", project: "TM" },
  { key: "TM-1844", summary: "[쿠폰] [29CM] 장바구니 쿠폰가 노출 - PLP/PDP",                             status: "론치완료",       assignee: "정유민",  eta: "2026-03-05", type: "Initiative", project: "TM" },
  { key: "TM-1845", summary: "[결제] [29CM] 무신사페이 도입",                                            status: "QA중",           assignee: "정유민",  eta: "2026-04-21", type: "Initiative", project: "TM",
    roles: [
      { role: "기획",   person: "정유민",   start: "2026-01-12", end: "2026-02-20", status: "완료" },
      { role: "디자인", person: "미정",     start: "2026-02-01", end: "2026-03-15", status: "완료" },
      { role: "개발BE", person: "미정",     start: "2026-03-01", end: "2026-04-15", status: "완료" },
      { role: "개발FE", person: "미정",     start: "2026-03-10", end: "2026-04-15", status: "진행중" },
      { role: "QA",     person: "미정",     start: "2026-04-01", end: "2026-04-21", status: "진행중" },
    ],
  },
  { key: "TM-1846", summary: "[결제] [29CM] 제휴카드 도입",                                              status: "QA중",           assignee: "정유민",  eta: "2026-04-27", type: "Initiative", project: "TM",
    roles: [
      { role: "기획",   person: "정유민",   start: "2026-01-15", end: "2026-02-25", status: "완료" },
      { role: "디자인", person: "미정",     start: "2026-02-10", end: "2026-03-20", status: "완료" },
      { role: "개발BE", person: "미정",     start: "2026-03-01", end: "2026-04-20", status: "진행중" },
      { role: "개발FE", person: "미정",     start: "2026-03-10", end: "2026-04-20", status: "진행중" },
      { role: "QA",     person: "미정",     start: "2026-04-10", end: "2026-04-27", status: "예정" },
    ],
  },
  { key: "TM-1869", summary: "[채널] [29CM] 최저가 노출 개편 - 네이버EP (Q1 연장)",                       status: "QA중",           assignee: "백수지",  eta: "2026-04-13", type: "Initiative", project: "TM" },
  { key: "TM-1871", summary: "[결제] [29CM] 교환 배송비 결제 시스템화",                                   status: "개발중",         assignee: "좌예슬",  eta: "2026-05-11", type: "Initiative", project: "TM" },
  { key: "TM-1872", summary: "[AI] [29CM] PDP 썸네일 영상화 - Iter. 2",                                  status: "론치완료",       assignee: "백수지",  eta: "2026-01-30", type: "Initiative", project: "TM" },
  { key: "TM-1876", summary: "[파트너] [29CM] 스타벅스 연동 - Phase 2. 클레임",                          status: "론치완료",       assignee: "백수지",  eta: "2026-01-26", type: "Initiative", project: "TM" },
  { key: "TM-1885", summary: "[리뷰] [29CM] 도움돼요 피드백 루프 구축",                                   status: "론치완료",       assignee: "백수지",  eta: "2026-02-04", type: "Initiative", project: "TM" },
  { key: "TM-1886", summary: "[리뷰] [29CM] 신고 프로세스 개선 - 사유 인지/정지 해제 (Q1 연장)",          status: "개발중",         assignee: "백수지",  eta: "2026-05-15", type: "Initiative", project: "TM",
    roles: [
      { role: "기획",   person: "백수지",   start: "2026-01-20", end: "2026-02-28", status: "완료" },
      { role: "디자인", person: "미정",     start: "2026-02-20", end: "2026-03-31", status: "완료" },
      { role: "개발BE", person: "미정",     start: "2026-03-15", end: "2026-05-10", status: "진행중" },
      { role: "개발FE", person: "미정",     start: "2026-03-20", end: "2026-05-10", status: "진행중" },
      { role: "QA",     person: "미정",     start: "2026-04-20", end: "2026-05-15", status: "예정" },
    ],
  },
  { key: "TM-1889", summary: "[장바구니] [29CM] 결제할인 추천 넛지",                                      status: "Postponed",      assignee: "정유민",  eta: "2026-06-30", type: "Initiative", project: "TM" },
  { key: "TM-1891", summary: "[주문] [29CM] 주문 상태 정보 불일치 개선 - 마이페이지/주문상세",             status: "론치완료",       assignee: "좌예슬",  eta: "2026-03-13", type: "Initiative", project: "TM" },
  { key: "TM-1892", summary: "[카탈로그] [29CM] 표준카테고리 미매칭 상품 매핑",                           status: "론치완료",       assignee: "백수지",  eta: "2026-04-03", type: "Initiative", project: "TM" },
  { key: "TM-1893", summary: "[카탈로그] [OCMPx29CM] 속성 집계 시스템 구축",                              status: "론치완료",       assignee: "정유민",  eta: "2026-03-31", type: "Initiative", project: "TM" },
  { key: "TM-1900", summary: "[리뷰] [29CM] 초기 리뷰 작성 넛징 도입",                                   status: "론치완료",       assignee: "백수지",  eta: "2026-04-06", type: "Initiative", project: "TM" },
  { key: "TM-1901", summary: "[리뷰] [29Connect] 파트너 펀딩 프로그램 설계 - 초기 리뷰 활성화",           status: "HOLD",           assignee: "백수지",  eta: "2026-04-30", type: "Initiative", project: "TM" },
  { key: "TM-1903", summary: "[링펜스] [29CM] 판매중지 상품 검수 우회 차단",                              status: "론치완료",       assignee: "정유민",  eta: "2026-02-05", type: "Initiative", project: "TM" },
  { key: "TM-1973", summary: "[알림] [29CM] 주문/결제/클레임 알림톡 개선",                                status: "론치완료",       assignee: "좌예슬",  eta: "2026-03-20", type: "Initiative", project: "TM" },
  { key: "TM-2048", summary: "[정산] [OCMPx29CM] 통합 매출 수집/검증 시스템 구축",                        status: "개발중",         assignee: "정윤수",  eta: "2026-04-17", type: "Initiative", project: "TM" },
  { key: "TM-2155", summary: "[CS] [OCMPx29CM] AI 상담사 채팅 도입 - Omni-Channel",                      status: "Postponed",      assignee: "좌예슬",  eta: "2026-09-30", type: "Initiative", project: "TM" },
  { key: "TM-2174", summary: "[쿠폰] [29CM] 카테고리 재구매 쿠폰 - 이구홈위크",                           status: "론치완료",       assignee: "양유주",  eta: "2026-02-11", type: "Initiative", project: "TM" },
  { key: "TM-2182", summary: "[채널] [29CM] 단위가격 표시제 적용 - 네이버EP",                             status: "기획중",         assignee: "백수지",  eta: "2026-06-30", type: "Initiative", project: "TM" },
  { key: "TM-2185", summary: "[보안] [29CM] OpenAPI 전환 - V1 to V2",                                    status: "론치완료",       assignee: "백수지",  eta: "2026-03-27", type: "Initiative", project: "TM" },
  { key: "TM-2186", summary: "[정책] [29CM] 국회상생안 대응 - 브랜드 수수료 인하",                        status: "론치완료",       assignee: "정유민",  eta: "2026-03-12", type: "Initiative", project: "TM" },
  { key: "TM-2216", summary: "[카탈로그] [OCMPx29CM] 매입 브랜드 공급업체 식별 체계 개선",                status: "론치완료",       assignee: "좌예슬",  eta: "2026-03-03", type: "Initiative", project: "TM" },
  { key: "TM-2234", summary: "[링펜스] [29CM] 상품 검수 운영 편의성 개선",                                status: "론치완료",       assignee: "정유민",  eta: "2026-02-25", type: "Initiative", project: "TM" },
  { key: "TM-2294", summary: "[리뷰] [29CM] 적립금 차등 지급 정책 개편 - HF",                            status: "론치완료",       assignee: "백수지",  eta: "2026-03-25", type: "Initiative", project: "TM" },
  // TM Q2
  { key: "TM-2513", summary: "[이구위크] 쿠폰 발급 프로세스 개선",                                        status: "개발중",         assignee: "윤정오",  eta: "2026-05-12", type: "Initiative", project: "TM" },
  { key: "TM-2726", summary: "[이구위크] 카테고리 첫구매 쿠폰 로직 고도화",                                status: "SUGGESTED",      assignee: "-",       eta: "-",          type: "Initiative", project: "TM" },
  { key: "TM-2727", summary: "[이구위크] 브랜드 첫구매 쿠폰 기능 및 모듈화",                              status: "준비중",         assignee: "양유주",  eta: "-",          type: "Initiative", project: "TM" },
  { key: "TM-2741", summary: "[티켓 내재화] 좌석 선점/해제 모듈 내재화",                                   status: "개발중",         assignee: "강행남",  eta: "2026-05-14", type: "Initiative", project: "TM" },
  { key: "TM-2742", summary: "[티켓 내재화] 대기열 내재화",                                                status: "준비중",         assignee: "강행남",  eta: "2026-05-29", type: "Initiative", project: "TM" },
  { key: "TM-2745", summary: "[결제] 케이뱅크 할인혜택 넛징",                                             status: "SUGGESTED",      assignee: "정유민",  eta: "2026-07-20", type: "Initiative", project: "TM" },
  { key: "TM-2746", summary: "[파트너] 큐레이터 상품 시딩 캠페인 - 무료주문 생성",                         status: "개발중",          assignee: "정유민",  eta: "2026-05-29", type: "Initiative", project: "TM" },
  { key: "TM-2751", summary: "[CS] AI Chat Agent 1:1문의 진입점 A/B 테스트",                               status: "SUGGESTED",      assignee: "좌예슬",  eta: "-",          type: "Initiative", project: "TM" },
  { key: "TM-2753", summary: "[CS] CS 상담 Agent Workspace 도입",                                         status: "SUGGESTED",      assignee: "좌예슬",  eta: "-",          type: "Initiative", project: "TM" },
  { key: "TM-2756", summary: "[OCMP] 통합 상품등록 어드민 요구사항 수집 설계 - 29CM",                      status: "기획중",          assignee: "정유민",  eta: "2026-07-31", type: "Initiative", project: "TM" },
  { key: "TM-2758", summary: "[카탈로그] 표준카테고리 미매칭 상품 매핑",                                   status: "SUGGESTED",      assignee: "백수지",  eta: "2026-06-30", type: "Initiative", project: "TM" },
  { key: "TM-2762", summary: "[채널] 네이버EP 매핑율 향상 Phase 2",                                        status: "Backlog",        assignee: "백수지",  eta: "-",          type: "Initiative", project: "TM" },
  { key: "TM-2770", summary: "[클레임] N회차 교환 로직 개선",                                              status: "Backlog",        assignee: "-",       eta: "-",          type: "Initiative", project: "TM" },
  { key: "TM-2779", summary: "[CS] CS 상담 CRM 도입 (w/ Salesforce)",                                     status: "SUGGESTED",      assignee: "좌예슬",  eta: "-",          type: "Initiative", project: "TM" },
  { key: "TM-2814", summary: "SRP, PLP 퀵패싯(브랜드,컬러) 고객향 UI/UX 개선",                            status: "디자인완료",      assignee: "이현욱",  eta: "-",          type: "Initiative", project: "TM" },
  { key: "TM-2815", summary: "[티켓 내재화] 좌석 배치도 사용성 개선",                                      status: "개발중",         assignee: "강행남",  eta: "-",          type: "Initiative", project: "TM" },
  { key: "TM-2817", summary: "무신사트레이딩 합병 : 물류/ERP(SAP) 연동 마스터 정리",                       status: "개발중",         assignee: "윤정오",  eta: "-",          type: "Initiative", project: "TM" },
  { key: "TM-2853", summary: "[카탈로그] O-SKU 전환 대응 29CM 상품등록 내부 API 신설",                     status: "개발중",         assignee: "좌예슬",  eta: "-",          type: "Initiative", project: "TM" },
  { key: "TM-2878", summary: "29CM EP 송출 상품 중 카탈로그 자동맵핑 상품 비중 개선",                      status: "SUGGESTED",      assignee: "최민주",  eta: "-",          type: "Initiative", project: "TM" },
  // CMALL
  { key: "CMALL-507",  summary: "인터페이스 일관성 기준 위반을 자동 검수하는 플러그인 제작 PoC",            status: "배포완료",       assignee: "윤민희",  eta: "2025-12-30", type: "Initiative", project: "CMALL" },
  { key: "CMALL-519",  summary: "25'Q4 29CM KTLO",                                                        status: "론치완료",       assignee: "김영진",  eta: "2025-12-31", type: "Initiative", project: "CMALL" },
  { key: "CMALL-520",  summary: "25'Q4 29CM Urgent",                                                      status: "개발중",         assignee: "김효진",  eta: "2025-12-31", type: "Initiative", project: "CMALL" },
  { key: "CMALL-521",  summary: "25'Q4 29CM BAU",                                                         status: "개발중",         assignee: "김효진",  eta: "2025-12-31", type: "Initiative", project: "CMALL" },
  { key: "CMALL-539",  summary: "29cm 고객의 소리 문의 유형 추가 및 수정 요청",                            status: "SUGGESTED",      assignee: "김지수",  eta: "2025-10-24", type: "Initiative", project: "CMALL" },
  { key: "CMALL-546",  summary: "[뷰티팀] 입점 브랜드사 api 연동 Q&A 질의 확인 요청",                     status: "SUGGESTED",      assignee: "김영진",  eta: "2025-10-24", type: "Initiative", project: "CMALL" },
  { key: "CMALL-549",  summary: "[커머스] 아크테릭스(위탁브랜드) 교환불가/반품ONLY 기능 추가",             status: "론치완료",       assignee: "강민우",  eta: "-",          type: "Initiative", project: "CMALL" },
  { key: "CMALL-567",  summary: "[커머스] 라이카(위탁브랜드) 교환불가/반품ONLY 기능 추가",                 status: "SUGGESTED",      assignee: "-",       eta: "-",          type: "Initiative", project: "CMALL" },
  { key: "CMALL-593",  summary: "[Mitosis] 프라이빗 메시 네트워크 환경 비용 효율화/보안 강화",             status: "론치완료",       assignee: "송정훈",  eta: "2026-03-06", type: "Initiative", project: "CMALL" },
  { key: "CMALL-594",  summary: "[Mitosis] Mother(Angular) → React 전환 Phase 1",                         status: "개발중",         assignee: "이한준",  eta: "2026-05-29", type: "Initiative", project: "CMALL" },
  { key: "CMALL-605",  summary: "[29CM] 26'Q1 KTLO",                                                      status: "론치완료",       assignee: "김영진",  eta: "2026-04-03", type: "Initiative", project: "CMALL" },
  { key: "CMALL-609",  summary: "[Mitosis] Shadow Traffic Compare System 개발",                           status: "론치완료",       assignee: "이한준",  eta: "2026-01-30", type: "Initiative", project: "CMALL" },
  { key: "CMALL-610",  summary: "[Mitosis] Near-Zero Downtime DB Switching System 개발",                  status: "QA중",           assignee: "이한준",  eta: "2026-04-09", type: "Initiative", project: "CMALL" },
  { key: "CMALL-615",  summary: "[29CM] 26'Q1 BAU",                                                       status: "개발중",         assignee: "김효진",  eta: "2026-04-03", type: "Initiative", project: "CMALL" },
  { key: "CMALL-616",  summary: "[29CM] 26'Q1 Urgent",                                                    status: "개발중",         assignee: "김효진",  eta: "2026-04-03", type: "Initiative", project: "CMALL" },
  { key: "CMALL-618",  summary: "[Mitosis] Promotion API Migration (Django → Spring)",                    status: "론치완료",       assignee: "이한준",  eta: "2026-03-27", type: "Initiative", project: "CMALL" },
  { key: "CMALL-620",  summary: "[Mitosis] Promotion API Outbound Implement",                             status: "론치완료",       assignee: "이한준",  eta: "2026-03-26", type: "Initiative", project: "CMALL" },
  { key: "CMALL-622",  summary: "[Mitosis] DB Migration Library 적용",                                    status: "철회/반려/취소", assignee: "이양호",  eta: "2026-03-27", type: "Initiative", project: "CMALL" },
  { key: "CMALL-693",  summary: "1:1문의 첨부 파일 확대 (2개 → 6개)",                                    status: "론치완료",       assignee: "좌예슬",  eta: "2026-02-06", type: "Initiative", project: "CMALL" },
  { key: "CMALL-735",  summary: "[Mitosis] Mother(Angular) → React 전환 Phase 2",                        status: "SUGGESTED",      assignee: "이한준",  eta: "2026-06-19", type: "Initiative", project: "CMALL" },
  { key: "CMALL-746",  summary: "[Mitosis] 29Connect FE 레거시 전환 Phase 2",                             status: "SUGGESTED",      assignee: "이한준",  eta: "-",          type: "Initiative", project: "CMALL" },
  { key: "CMALL-747",  summary: "[Mitosis] Review 서비스 분리",                                           status: "개발중",         assignee: "이한준",  eta: "2026-05-06", type: "Initiative", project: "CMALL" },
  { key: "CMALL-748",  summary: "[Mitosis] Like 서비스 분리",                                             status: "개발중",         assignee: "이한준",  eta: "2026-05-18", type: "Initiative", project: "CMALL" },
  { key: "CMALL-749",  summary: "[Mitosis] Moment Trigger 서비스 분리",                                   status: "개발중",         assignee: "이한준",  eta: "2026-04-23", type: "Initiative", project: "CMALL" },
  { key: "CMALL-770",  summary: "모노하 3월 추가 수수료 보정 요청 건",                                    status: "SUGGESTED",      assignee: "강세종",  eta: "2026-03-31", type: "Initiative", project: "CMALL" },
  // M29CMCCF
  { key: "M29CMCCF-730",  summary: "[Dropped][Y25Q4] 통합계정 구간 2 - CMFE",                             status: "완료",           assignee: "-",       eta: "2025-10-31", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-731",  summary: "Dropped - [NC][Y25Q4] 통합계정 구간 3 - CMFE",                        status: "완료",           assignee: "-",       eta: "2025-11-28", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-732",  summary: "[Y25Q4] OCMP 회원 - 본인인증 초기화 고객 대상 인증 유도 Phase1",      status: "완료",           assignee: "유영재",  eta: "2025-12-03", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-733",  summary: "[Y25Q4] 알림 기능 강화 & 알림 피드 페이지 개선 - CMFE",               status: "완료",           assignee: "백주은",  eta: "2025-11-28", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-734",  summary: "[NC][Y25Q4] 적립금 한도 유연화 - CMFE",                               status: "SUGGESTED",      assignee: "조창훈",  eta: "-",          type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-735",  summary: "[NC][Y25Q4] 기획전 쿠폰 참여 셀프 서브 시스템 구축 - CMFE",           status: "SUGGESTED",      assignee: "조창훈",  eta: "-",          type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-736",  summary: "[Y25Q4] 장바구니 할인 UX 고도화 phase1 - CMFE",                       status: "완료",           assignee: "백주은",  eta: "2025-11-04", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-751",  summary: "[Y25Q4][Engineering OKR] 어드민 자동화 개발",                         status: "완료",           assignee: "전은미",  eta: "2025-12-17", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-772",  summary: "(hold) [KTLO] 유저향 고객의소리 REACT 포팅",                          status: "완료",           assignee: "백주은",  eta: "2025-12-31", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-780",  summary: "[Y25Q4] 장바구니 할인 UX 고도화 phase2 - CMFE",                       status: "완료",           assignee: "방창배",  eta: "2025-12-31", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-803",  summary: "29CM 적립금 전체 사용 가능하게 처리 (7% 제한 제거)",                   status: "완료",           assignee: "유영재",  eta: "2025-10-29", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-827",  summary: "[장바구니] 할인 UX 고도화 phase1: 할인/배송 UX 개선 - QA",            status: "완료",           assignee: "백주은",  eta: "2025-11-07", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-838",  summary: "[Y25Q4] 29CM AI 챗봇 구축 - CMFE",                                    status: "완료",           assignee: "전은미",  eta: "2025-11-14", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-842",  summary: "[Y25Q4] 파트너 통합 인증/인가 ph1-1 - CMFE",                          status: "완료",           assignee: "방창배",  eta: "2025-12-03", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-884",  summary: "[장고 전환] Q&A 어드민 이관",                                         status: "완료",           assignee: "방창배",  eta: "2025-12-19", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-885",  summary: "새로고침 시 민감키워드 URL 내 쿼리 파람 제거 요청",                    status: "완료",           assignee: "유영재",  eta: "2025-11-20", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-889",  summary: "[FE] 29CM 통합회원 식별자(onemember_hash_id) 수집 클라이언트 구현",   status: "완료",           assignee: "조창훈",  eta: "2025-12-05", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-924",  summary: "[장바구니] 할인 UX 고도화 phase1: 할인/배송 UX 개선",                 status: "완료",           assignee: "백주은",  eta: "2025-10-31", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-936",  summary: "[장바구니] 할인 UX 고도화 phase1 - iteration 2 - CMFE",               status: "완료",           assignee: "백주은",  eta: "2025-12-05", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-942",  summary: "[Y25Q4] OCMP 회원 - 본인인증 초기화 고객 대상 인증 유도 Phase2",      status: "완료",           assignee: "조창훈",  eta: "2025-12-22", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-967",  summary: "[장바구니] 할인 UX 고도화 phase2: 구매 Urgency 강화 CMFE",            status: "완료",           assignee: "백주은",  eta: "2025-12-17", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-985",  summary: "[Y26Q1] 29커넥트 메뉴 권한 제어 - CMFE",                              status: "완료",           assignee: "방창배",  eta: "2026-01-27", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1031", summary: "[Y26Q1] CMFE KTLO",                                                   status: "완료",           assignee: "이현진",  eta: "2026-03-31", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1032", summary: "[Y26Q1] CMFE BAU",                                                    status: "완료",           assignee: "이현진",  eta: "2026-03-31", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1033", summary: "[Y26Q1] CMFE Urgent",                                                 status: "완료",           assignee: "이현진",  eta: "2026-03-31", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1038", summary: "[Y26Q1] (링펜스) PDP 내 어드민 입력 KC 인증번호 연동 - CMFE",         status: "완료",           assignee: "조창훈",  eta: "2026-01-14", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1044", summary: "[장고 좋아요 API 제거] LikeApiService.ts",                            status: "완료",           assignee: "방창배",  eta: "2026-01-13", type: "Dev",  project: "M29CMCCF" },
  { key: "M29CMCCF-1057", summary: "[주문서] 상품/가격 UI UX 개선",                                       status: "완료",           assignee: "백주은",  eta: "2026-01-26", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1087", summary: "[Y26Q1] (링펜스) 판매 중지 처리 상품 검수 우회 케이스 차단 - CMFE",   status: "완료",           assignee: "조창훈",  eta: "2026-02-06", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1098", summary: "[Y26Q1] 29커넥트 일반 할인 파트너 셀프서비스 도입 - CMFE",            status: "완료",           assignee: "유영재",  eta: "2026-03-16", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1149", summary: "[주문서] 상품/가격 UI UX 개선 QA",                                    status: "완료",           assignee: "백주은",  eta: "2026-01-27", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1166", summary: "[Y26Q1] 29커넥트 메뉴 권한 제어 (인증 갱신) - CMFE",                  status: "완료",           assignee: "방창배",  eta: "2026-01-30", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1174", summary: "[Y26Q1][FE] 상품광고 구좌 추가 (1P → 3P(광고) 전환 포함)",           status: "완료",           assignee: "백주은",  eta: "2026-02-05", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1217", summary: "[보안정책_29CM] 커넥트 어드민 계정 동시세션 차단 (FE)",               status: "완료",           assignee: "방창배",  eta: "2026-02-24", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1225", summary: "[Y26Q1] 국회 발표 상생안 대응",                                       status: "완료",           assignee: "유영재",  eta: "2026-03-12", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1245", summary: "[Y26Q1] 무신사페이 도입",                                             status: "In Progress",    assignee: "백주은",  eta: "2026-04-27", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1253", summary: "[CMFE] 셀링툴 연동정보 제공 FE 개발",                                 status: "완료",           assignee: "이현진",  eta: "2026-02-25", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1267", summary: "[Y26Q1] [링펜스] 상품검수 편의 개선 - CMFE",                          status: "완료",           assignee: "조창훈",  eta: "-",          type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1289", summary: "CMFE - PLP/PDP 장바구니쿠폰가 노출",                                  status: "완료",           assignee: "이하영",  eta: "2026-03-05", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1290", summary: "취소 - [PC/MO] 주문배송조회 0원상품 취소 시 -0원 표기 오류",          status: "완료",           assignee: "-",       eta: "-",          type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1320", summary: "[Y26Q1] 팀무신사 PLCC 도입",                                          status: "In Progress",    assignee: "방창배",  eta: "2026-04-24", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1321", summary: "[Y26Q1-링펜스] 어드민 내 입점 요청 관리(contact-us) 메뉴 개발",       status: "In Progress",    assignee: "조창훈",  eta: "-",          type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1427", summary: "[Y26Q1] 팀무신사 PLCC 도입 - Order (주문서/주문완료/주문상세)",        status: "In Progress",    assignee: "백주은",  eta: "2026-04-24", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1450", summary: "[Y26Q1] 교환 배송비 결제 시스템",                                     status: "In Progress",    assignee: "조창훈",  eta: "2026-05-04", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1526", summary: "[CMFE] 29CM 선물하기 고도화",                                         status: "SUGGESTED",      assignee: "박상진",  eta: "-",          type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1533", summary: "띠배너 관리 어드민 기능 확장",                                        status: "완료",           assignee: "박상진",  eta: "2026-04-06", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1563", summary: "[Y26Q2] CMFE KTLO",                                                   status: "In Progress",    assignee: "이현진",  eta: "2026-06-30", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1564", summary: "[Y26Q2] CMFE BAU",                                                    status: "In Progress",    assignee: "이현진",  eta: "2026-06-30", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1565", summary: "[Y26Q1] CMFE Urgent",                                                 status: "In Progress",    assignee: "이현진",  eta: "2026-06-30", type: "Epic", project: "M29CMCCF" },
  { key: "M29CMCCF-1570", summary: "선물하기 수신자 셀프서비스",                                           status: "In Progress",    assignee: "박상진",  eta: "-",          type: "Epic", project: "M29CMCCF" },
  // EF
  { key: "EF-908", summary: "[보안] [29Connect] API 인증체계 개선 - Static Key V2 전환", status: "완료", assignee: "윤정오", eta: "2026-02-27", type: "Epic", project: "EF" },
];

const Q1Q2_KEYS = new Set([
  "TM-1241", "TM-1846", "TM-1869", "TM-1871", "TM-1886",
  "TM-2048", "TM-2155", "TM-2174", "TM-2182", "TM-2185",
  "TM-2186", "TM-2216", "TM-2234", "TM-2294",
]);

const Q2_KEYS = new Set([
  ...Q1Q2_KEYS,
  "TM-2513", "TM-2726", "TM-2727", "TM-2741", "TM-2742",
  "TM-2745", "TM-2746", "TM-2751", "TM-2753", "TM-2756",
  "TM-2758", "TM-2762", "TM-2770", "TM-2779", "TM-2814",
  "TM-2815", "TM-2817", "TM-2853", "TM-2878",
]);

const ALL_QUARTERS = ["Y26Q1", "Q1+Q2", "Y26Q2"];
const ALL_PROJECTS = ["TM", "CMALL", "M29CMCCF", "EF"];
const ALL_STATUSES = ["론치완료/완료", "개발중", "QA중", "SUGGESTED", "HOLD/Postponed", "기타"];

function extractDomain(summary: string): string {
  const m = summary.match(/^\[([^\]]+)\]/);
  return m ? m[1] : "기타";
}

function matchStatus(status: string, filter: string): boolean {
  if (filter === "전체") return true;
  if (filter === "론치완료/완료") return ["론치완료", "완료", "배포완료"].includes(status);
  if (filter === "개발중") return ["개발중", "In Progress"].includes(status);
  if (filter === "QA중") return status === "QA중";
  if (filter === "SUGGESTED") return ["SUGGESTED", "Backlog"].includes(status);
  if (filter === "HOLD/Postponed") return ["HOLD", "Postponed"].includes(status);
  if (filter === "기타") return ["기획중", "기획완료", "디자인완료", "디자인중", "준비중", "철회/반려/취소"].includes(status);
  return true;
}

function toggle(prev: Set<string>, value: string): Set<string> {
  const next = new Set(prev);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}

function GanttChart({ roles }: { roles?: RoleSchedule[] }) {
  return (
    <div className="mt-3">
      {/* Month header */}
      <div className="flex mb-1">
        <div className="w-36 shrink-0" />
        <div className="flex-1 relative h-4">
          {GANTT_MONTHS.map((m) => (
            <span
              key={m.label}
              className="absolute text-[10px] text-gray-400 -translate-x-1/2"
              style={{ left: `${m.pct}%` }}
            >
              {m.label}
            </span>
          ))}
        </div>
      </div>
      {/* Today line + role rows */}
      <div className="relative">
        {roles && roles.length > 0 ? roles.map((r) => (
          <div key={`${r.role}-${r.person}`} className="flex items-center mb-1.5">
            <div className="w-36 shrink-0 flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-gray-600 w-14 shrink-0">{r.role}</span>
              <span className="text-[11px] text-gray-400 truncate">{r.person}</span>
            </div>
            <div className="flex-1 relative h-5 bg-gray-100 rounded-sm">
              {/* Today marker */}
              <div
                className="absolute top-0 bottom-0 w-px bg-red-400 z-10"
                style={{ left: `${TODAY_PCT}%` }}
              />
              <div
                className={`absolute top-0.5 bottom-0.5 rounded-sm ${ROLE_COLOR[r.role] ?? "bg-gray-400"} ${r.status === "완료" ? "opacity-40" : r.status === "예정" ? "opacity-60" : ""}`}
                style={{ left: `${toPct(r.start)}%`, width: `${spanPct(r.start, r.end)}%` }}
              />
            </div>
            <span className={`ml-2 text-[10px] w-10 shrink-0 ${r.status === "완료" ? "text-green-500" : r.status === "진행중" ? "text-blue-500" : "text-gray-400"}`}>
              {r.status}
            </span>
          </div>
        )) : (
          <div className="flex items-center">
            <div className="w-36 shrink-0" />
            <p className="text-xs text-gray-400 py-2">일정 데이터 없음 — 작업별 일정 입력 시 표시됩니다</p>
          </div>
        )}
      </div>
    </div>
  );
}

const PRESET_ROLES = ["기획", "디자인", "BE-SP", "BE-PP", "BE-CE", "FE-CFE", "FE-DFE", "Mobile", "QA"];

function isCustomRole(role: string) {
  return role !== "" && !PRESET_ROLES.includes(role);
}
const STATUS_OPTIONS: RoleSchedule["status"][] = ["예정", "진행중", "완료"];

function newRow(): RoleSchedule {
  return { role: "기획", person: "", start: "", end: "", status: "예정" };
}

export default function JiraTicketsPage() {
  const [selected, setSelected]     = useState<Ticket | null>(null);
  const [quarters, setQuarters]     = useState<Set<string>>(new Set());
  const [projects, setProjects]     = useState<Set<string>>(new Set());
  const [statuses, setStatuses]     = useState<Set<string>>(new Set());
  const [domainFilter, setDomainFilter] = useState<Set<string>>(new Set());
  const [search, setSearch]         = useState("");

  // localStorage 기반 일정 데이터
  const [schedules, setSchedules]   = useState<Record<string, RoleSchedule[]>>({});
  const [editMode, setEditMode]     = useState(false);
  const [editRows, setEditRows]     = useState<RoleSchedule[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("cc-schedules");
      if (saved) setSchedules(JSON.parse(saved));
    } catch {}
  }, []);

  function getRoles(t: Ticket): RoleSchedule[] {
    return schedules[t.key] ?? t.roles ?? [];
  }

  function saveSchedule(key: string, rows: RoleSchedule[]) {
    const updated = { ...schedules, [key]: rows };
    setSchedules(updated);
    localStorage.setItem("cc-schedules", JSON.stringify(updated));
  }

  function startEdit() {
    if (!selected) return;
    setEditRows(getRoles(selected).length > 0
      ? getRoles(selected).map(r => ({ ...r }))
      : [newRow()]
    );
    setEditMode(true);
  }

  function saveEdit() {
    if (!selected) return;
    saveSchedule(selected.key, editRows.filter(r => r.role && r.start && r.end));
    setEditMode(false);
  }

  function updateRow(i: number, field: keyof RoleSchedule, value: string) {
    setEditRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  }

  const allDomains = useMemo(() => {
    const set = new Set(raw.map((t) => extractDomain(t.summary)));
    return [...set].sort((a, b) => a === "기타" ? 1 : b === "기타" ? -1 : a.localeCompare(b, "ko"));
  }, []);

  const filtered = useMemo(() => {
    return raw.filter((t) => {
      if (quarters.size > 0) {
        const isQ2   = Q2_KEYS.has(t.key);
        const isQ1Q2 = Q1Q2_KEYS.has(t.key);
        const wantQ1   = quarters.has("Y26Q1");
        const wantQ2   = quarters.has("Y26Q2");
        const wantQ1Q2 = quarters.has("Q1+Q2");
        const matches =
          (wantQ1   && (!isQ2 || isQ1Q2)) ||
          (wantQ2   && (isQ2 && !isQ1Q2)) ||
          (wantQ1Q2 && isQ1Q2);
        if (!matches) return false;
      }
      if (domainFilter.size > 0 && !domainFilter.has(extractDomain(t.summary))) return false;
      if (projects.size > 0 && !projects.has(t.project)) return false;
      if (statuses.size > 0 && !Array.from(statuses).some((s) => matchStatus(t.status, s))) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!t.summary.toLowerCase().includes(q) && !t.key.toLowerCase().includes(q) && !t.assignee.includes(search)) return false;
      }
      return true;
    });
  }, [quarters, projects, statuses, domainFilter, search]);

  const done       = filtered.filter((t) => ["론치완료", "완료", "배포완료"].includes(t.status)).length;
  const inProgress = filtered.filter((t) => ["개발중", "In Progress", "QA중"].includes(t.status)).length;
  const planned    = filtered.filter((t) => ["SUGGESTED", "Backlog", "HOLD", "Postponed", "기획중", "기획완료", "디자인완료", "준비중", "디자인중"].includes(t.status)).length;

  function handleSelect(t: Ticket) {
    setSelected((prev) => prev?.key === t.key ? null : t);
    setEditMode(false);
  }

  return (
    <div className="flex bg-gray-50 min-h-screen">
      {/* ── 리스트 패널 ── */}
      <div className="flex-1 min-w-0 px-6 py-8">
        <div className="mb-5">
          <h2 className="text-lg font-bold text-gray-900">전체 과제 현황</h2>
          <p className="text-sm text-gray-400 mt-0.5">Labels: 29cm_CC · Y26Q1/Q2 · 29CM_OKR</p>
        </div>

        {/* 요약 카드 */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[
            { label: "전체",    count: filtered.length, color: "text-gray-900" },
            { label: "완료",    count: done,             color: "text-green-600" },
            { label: "진행중",  count: inProgress,       color: "text-blue-600" },
            { label: "계획/대기", count: planned,        color: "text-gray-400" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.count}</p>
            </div>
          ))}
        </div>

        {/* 필터 */}
        <div className="flex flex-col gap-2 mb-4">
          {[
            { label: "분기",    items: ALL_QUARTERS, state: quarters,     setState: setQuarters,     activeColor: "bg-indigo-600 text-white" },
            { label: "프로젝트", items: ALL_PROJECTS, state: projects,    setState: setProjects,     activeColor: "bg-gray-800 text-white" },
            { label: "상태",    items: ALL_STATUSES, state: statuses,     setState: setStatuses,     activeColor: "bg-blue-600 text-white" },
            { label: "도메인",  items: allDomains,   state: domainFilter, setState: setDomainFilter, activeColor: "bg-teal-600 text-white" },
          ].map(({ label, items, state, setState, activeColor }) => (
            <div key={label} className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-400 w-14 shrink-0">{label}</span>
              <button
                onClick={() => setState(new Set())}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${state.size === 0 ? activeColor : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"}`}
              >전체</button>
              {items.map((v) => (
                <button key={v} onClick={() => setState((p) => toggle(p, v))}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${state.has(v) ? activeColor : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}
                >{v}</button>
              ))}
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400 w-14 shrink-0">검색</span>
            <input
              type="text"
              placeholder="티켓 번호 · 제목 · 담당자"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 w-64"
            />
          </div>
        </div>

        {/* 티켓 목록 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* 헤더 */}
          <div className="flex items-center px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium">
            <span className="w-32 shrink-0">티켓</span>
            <span className="flex-1 min-w-0">제목</span>
            <span className="w-16 shrink-0 text-center">프로젝트</span>
            <span className="w-16 shrink-0 text-center">담당자</span>
            <span className="w-24 shrink-0 text-center">상태</span>
            <span className="w-24 shrink-0 text-center">ETA</span>
          </div>

          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">검색 결과가 없습니다.</div>
          ) : (
            filtered.map((t) => {
              const isSelected = selected?.key === t.key;
              return (
                <div
                  key={t.key}
                  className={`border-b border-gray-50 last:border-0 transition-colors ${isSelected ? "bg-indigo-50" : "hover:bg-gray-50"}`}
                >
                  {/* 메인 행 */}
                  <div
                    className="flex items-center px-4 py-3 cursor-pointer"
                    onClick={() => handleSelect(t)}
                  >
                    <a
                      href={`${JIRA_BASE}${t.key}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="w-32 shrink-0 font-mono text-xs text-blue-500 hover:underline"
                    >
                      {t.key}
                    </a>
                    <span className="flex-1 min-w-0 text-sm text-gray-800 truncate pr-3">{t.summary}</span>
                    <span className="w-16 shrink-0 text-xs text-gray-400 text-center">{t.project}</span>
                    <span className="w-16 shrink-0 text-xs text-gray-500 text-center truncate">{t.assignee}</span>
                    <span className="w-24 shrink-0 flex justify-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[t.status] ?? "bg-gray-100 text-gray-500"}`}>
                        {t.status}
                      </span>
                    </span>
                    <span className="w-24 shrink-0 text-xs text-gray-400 text-center">{t.eta}</span>
                  </div>

                  {/* 펼침: Gantt */}
                  {isSelected && (
                    <div className="px-4 pb-4 border-t border-indigo-100">
                      <GanttChart roles={getRoles(t)} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── 우측 상세 패널 ── */}
      {selected && (
        <div className="w-[380px] shrink-0 sticky top-0 h-screen overflow-y-auto border-l border-gray-200 bg-white">
          <div className="p-5">
            {/* 헤더 */}
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-sm font-bold text-gray-900 leading-snug pr-2 flex-1">{selected.summary}</h3>
              <button
                onClick={() => { setSelected(null); setEditMode(false); }}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none shrink-0"
              >×</button>
            </div>

            {/* 메타 정보 */}
            <div className="space-y-2 mb-5">
              <div className="flex items-center gap-2">
                <a href={`${JIRA_BASE}${selected.key}`} target="_blank" rel="noopener noreferrer"
                  className="font-mono text-xs text-blue-500 hover:underline">{selected.key}</a>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[selected.status] ?? "bg-gray-100 text-gray-500"}`}>
                  {selected.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-y-1.5 text-xs">
                {[
                  { label: "담당자", value: selected.assignee },
                  { label: "ETA",    value: selected.eta },
                  { label: "프로젝트", value: selected.project },
                  { label: "유형",   value: selected.type },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <span className="text-gray-400">{label} </span>
                    <span className="text-gray-700 font-medium">{value || "-"}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              {/* 작업별 일정 헤더 */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">작업별 일정 (2026 H1)</p>
                {!editMode ? (
                  <button
                    onClick={startEdit}
                    className="text-xs text-indigo-500 hover:text-indigo-700 font-medium"
                  >편집</button>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={saveEdit}
                      className="text-xs bg-indigo-600 text-white px-2.5 py-1 rounded-lg hover:bg-indigo-700 font-medium">저장</button>
                    <button onClick={() => setEditMode(false)}
                      className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">취소</button>
                  </div>
                )}
              </div>

              {/* 편집 모드 */}
              {editMode ? (
                <div className="space-y-2">
                  {editRows.map((row, i) => {
                    const custom = isCustomRole(row.role);
                    return (
                      <div key={i} className="bg-gray-50 rounded-lg p-2.5 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          {/* 작업 프리셋 선택 */}
                          <select
                            value={custom ? "직접입력" : row.role}
                            onChange={(e) => {
                              if (e.target.value === "직접입력") updateRow(i, "role", "");
                              else updateRow(i, "role", e.target.value);
                            }}
                            className="text-xs text-gray-900 border border-gray-300 rounded px-1.5 py-1 bg-white shrink-0 w-24"
                          >
                            {PRESET_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            <option value="직접입력">직접입력</option>
                          </select>
                          {/* 직접입력 시 작업명 텍스트 */}
                          {custom && (
                            <input
                              value={row.role}
                              onChange={(e) => updateRow(i, "role", e.target.value)}
                              placeholder="작업명 입력"
                              className="text-xs text-gray-900 border border-gray-300 rounded px-1.5 py-1 w-24 shrink-0"
                            />
                          )}
                          {/* 담당자 */}
                          <input
                            value={row.person}
                            onChange={(e) => updateRow(i, "person", e.target.value)}
                            placeholder="담당자명"
                            className="text-xs text-gray-900 border border-gray-300 rounded px-1.5 py-1 flex-1 min-w-0"
                          />
                          {/* 상태 */}
                          <select
                            value={row.status}
                            onChange={(e) => updateRow(i, "status", e.target.value as RoleSchedule["status"])}
                            className="text-xs text-gray-900 border border-gray-300 rounded px-1.5 py-1 bg-white w-16 shrink-0"
                          >
                            {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                          </select>
                          {/* 삭제 */}
                          <button onClick={() => setEditRows(prev => prev.filter((_, idx) => idx !== i))}
                            className="text-gray-300 hover:text-red-400 text-base leading-none shrink-0">×</button>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-gray-500 w-6 shrink-0">시작</span>
                          <input
                            type="date"
                            value={row.start}
                            onChange={(e) => updateRow(i, "start", e.target.value)}
                            className="text-xs text-gray-900 border border-gray-300 rounded px-1.5 py-1 flex-1"
                          />
                          <span className="text-[10px] text-gray-400 shrink-0">~</span>
                          <input
                            type="date"
                            value={row.end}
                            onChange={(e) => updateRow(i, "end", e.target.value)}
                            className="text-xs text-gray-900 border border-gray-300 rounded px-1.5 py-1 flex-1"
                          />
                        </div>
                      </div>
                    );
                  })}
                  <button
                    onClick={() => setEditRows(prev => [...prev, newRow()])}
                    className="w-full text-xs text-gray-400 hover:text-gray-600 border border-dashed border-gray-200 rounded-lg py-1.5 hover:border-gray-300 transition-colors"
                  >+ 직무 추가</button>
                </div>
              ) : (
                /* 뷰 모드: Gantt */
                <>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {Object.entries(ROLE_COLOR).map(([role, color]) => (
                      <span key={role} className="flex items-center gap-1 text-[10px] text-gray-500">
                        <span className={`inline-block w-2.5 h-2.5 rounded-sm ${color}`} />
                        {role}
                      </span>
                    ))}
                    <span className="flex items-center gap-1 text-[10px] text-gray-400">
                      <span className="inline-block w-px h-3 bg-red-400" />오늘
                    </span>
                  </div>
                  <GanttChart roles={getRoles(selected)} />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
