"use client";
import { useState, useMemo } from "react";

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
};

type Ticket = {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  eta: string;
  type: string;
  project: string;
};

const raw: Ticket[] = [
  // TM
  { key: "TM-814",  summary: "[파트너] [29Connect] 일반 할인 셀프서비스 도입",                           status: "론치완료",       assignee: "양유주",  eta: "2026-03-16", type: "Initiative", project: "TM" },
  { key: "TM-1241", summary: "[쿠폰] [29Connect] 파트너 쿠폰 대시보드 제공",                             status: "개발중",         assignee: "양유주",  eta: "2026-06-08", type: "Initiative", project: "TM" },
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
  { key: "TM-1845", summary: "[결제] [29CM] 무신사페이 도입",                                            status: "QA중",           assignee: "정유민",  eta: "2026-04-21", type: "Initiative", project: "TM" },
  { key: "TM-1846", summary: "[결제] [29CM] 제휴카드 도입",                                              status: "QA중",           assignee: "정유민",  eta: "2026-04-27", type: "Initiative", project: "TM" },
  { key: "TM-1869", summary: "[채널] [29CM] 최저가 노출 개편 - 네이버EP (Q1 연장)",                       status: "QA중",           assignee: "백수지",  eta: "2026-04-13", type: "Initiative", project: "TM" },
  { key: "TM-1871", summary: "[결제] [29CM] 교환 배송비 결제 시스템화",                                   status: "개발중",         assignee: "좌예슬",  eta: "2026-05-11", type: "Initiative", project: "TM" },
  { key: "TM-1872", summary: "[AI] [29CM] PDP 썸네일 영상화 - Iter. 2",                                  status: "론치완료",       assignee: "백수지",  eta: "2026-01-30", type: "Initiative", project: "TM" },
  { key: "TM-1876", summary: "[파트너] [29CM] 스타벅스 연동 - Phase 2. 클레임",                          status: "론치완료",       assignee: "백수지",  eta: "2026-01-26", type: "Initiative", project: "TM" },
  { key: "TM-1885", summary: "[리뷰] [29CM] 도움돼요 피드백 루프 구축",                                   status: "론치완료",       assignee: "백수지",  eta: "2026-02-04", type: "Initiative", project: "TM" },
  { key: "TM-1886", summary: "[리뷰] [29CM] 신고 프로세스 개선 - 사유 인지/정지 해제 (Q1 연장)",          status: "개발중",         assignee: "백수지",  eta: "2026-05-15", type: "Initiative", project: "TM" },
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
  { key: "M29CMCCF-1032", summary: "[Y26Q1] CMFE BAU",                                                    status: "In Progress",    assignee: "이현진",  eta: "2026-03-31", type: "Epic", project: "M29CMCCF" },
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
  { key: "EF-908",   summary: "[보안] [29Connect] API 인증체계 개선 - Static Key V2 전환",                status: "완료",           assignee: "윤정오",  eta: "2026-02-27", type: "Epic", project: "EF" },
];

const ALL_PROJECTS = ["전체", "TM", "CMALL", "M29CMCCF", "EF"];
const ALL_STATUSES = ["전체", "론치완료/완료", "개발중", "QA중", "SUGGESTED", "HOLD/Postponed", "기타"];

function matchStatus(status: string, filter: string): boolean {
  if (filter === "전체") return true;
  if (filter === "론치완료/완료") return ["론치완료", "완료", "배포완료"].includes(status);
  if (filter === "개발중") return ["개발중", "In Progress"].includes(status);
  if (filter === "QA중") return status === "QA중";
  if (filter === "SUGGESTED") return status === "SUGGESTED";
  if (filter === "HOLD/Postponed") return ["HOLD", "Postponed"].includes(status);
  if (filter === "기타") return ["기획중", "기획완료", "디자인완료", "철회/반려/취소"].includes(status);
  return true;
}

export default function JiraTicketsPage() {
  const [projectFilter, setProjectFilter] = useState("전체");
  const [statusFilter, setStatusFilter] = useState("전체");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return raw.filter((t) => {
      if (projectFilter !== "전체" && t.project !== projectFilter) return false;
      if (!matchStatus(t.status, statusFilter)) return false;
      if (search && !t.summary.toLowerCase().includes(search.toLowerCase()) && !t.key.toLowerCase().includes(search.toLowerCase()) && !t.assignee.includes(search)) return false;
      return true;
    });
  }, [projectFilter, statusFilter, search]);

  const done = filtered.filter((t) => ["론치완료", "완료", "배포완료"].includes(t.status)).length;
  const inProgress = filtered.filter((t) => ["개발중", "In Progress", "QA중"].includes(t.status)).length;
  const planned = filtered.filter((t) => ["SUGGESTED", "HOLD", "Postponed", "기획중", "기획완료", "디자인완료"].includes(t.status)).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-7xl mx-auto px-8 py-8">
        <div className="mb-6">
          <h2 className="text-lg font-bold text-gray-900">레이블 티켓 현황</h2>
          <p className="text-sm text-gray-400 mt-0.5">Labels: 29cm_CC · Y26Q1 · 29CM_OKR</p>
        </div>

        {/* 요약 카드 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: "전체", count: filtered.length,   color: "text-gray-900" },
            { label: "완료",  count: done,              color: "text-green-600" },
            { label: "진행중", count: inProgress,       color: "text-blue-600" },
            { label: "계획/대기", count: planned,       color: "text-gray-400" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-5 py-4">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.count}</p>
            </div>
          ))}
        </div>

        {/* 필터 */}
        <div className="flex flex-wrap gap-3 mb-5">
          <input
            type="text"
            placeholder="검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 w-52"
          />
          <div className="flex gap-1.5 flex-wrap">
            {ALL_PROJECTS.map((p) => (
              <button
                key={p}
                onClick={() => setProjectFilter(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  projectFilter === p
                    ? "bg-gray-800 text-white"
                    : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {ALL_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? "bg-blue-600 text-white"
                    : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* 테이블 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-gray-500 text-xs">
                <th className="text-left px-4 py-3 font-medium w-28">티켓</th>
                <th className="text-left px-4 py-3 font-medium">제목</th>
                <th className="text-left px-4 py-3 font-medium w-24">프로젝트</th>
                <th className="text-left px-4 py-3 font-medium w-20">담당자</th>
                <th className="text-left px-4 py-3 font-medium w-28">상태</th>
                <th className="text-left px-4 py-3 font-medium w-28">ETA</th>
                <th className="text-left px-4 py-3 font-medium w-20">유형</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400 text-sm">
                    검색 결과가 없습니다.
                  </td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.key} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <a
                        href={`${JIRA_BASE}${t.key}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline font-mono text-xs whitespace-nowrap"
                      >
                        {t.key}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-gray-800">{t.summary}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-500 font-medium">{t.project}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{t.assignee}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_COLOR[t.status] ?? "bg-gray-100 text-gray-500"}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{t.eta || "-"}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{t.type}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3 text-right">{filtered.length}건 표시 / 전체 {raw.length}건</p>
      </main>
    </div>
  );
}
