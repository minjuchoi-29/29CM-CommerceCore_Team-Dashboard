import type { Ticket } from "./TicketBoard";

/**
 * 관리할 티켓 key 목록 — 티켓 추가/삭제는 여기서만
 * summary, status, assignee, eta 등은 JIRA에서 자동 sync됨
 */
export const TICKET_KEYS: string[] = [
  "TM-1241",
];

/**
 * JIRA에 없는 추가 정보 — roles(간트 일정), 링크 등 필요한 key만 작성
 * summary/status/assignee/eta 는 JIRA 데이터가 우선하므로 여기서 덮어쓰지 말 것
 */
export const TICKET_OVERRIDES: Record<string, Partial<Omit<Ticket, "key">>> = {
  "TM-1241": {
    roles: [
      { role: "기획",   person: "양유주", start: "2026-01-05", end: "2026-03-01", status: "완료" },
      { role: "디자인", person: "미정",   start: "2026-02-15", end: "2026-03-31", status: "완료" },
      { role: "개발BE", person: "미정",   start: "2026-03-20", end: "2026-05-31", status: "진행중" },
      { role: "개발FE", person: "미정",   start: "2026-04-01", end: "2026-06-08", status: "예정" },
      { role: "QA",     person: "미정",   start: "2026-05-20", end: "2026-06-08", status: "예정" },
    ],
  },
  "TM-1845": {
    roles: [
      { role: "기획",   person: "정유민", start: "2026-01-12", end: "2026-02-20", status: "완료" },
      { role: "디자인", person: "미정",   start: "2026-02-01", end: "2026-03-15", status: "완료" },
      { role: "개발BE", person: "미정",   start: "2026-03-01", end: "2026-04-15", status: "완료" },
      { role: "개발FE", person: "미정",   start: "2026-03-10", end: "2026-04-15", status: "진행중" },
      { role: "QA",     person: "미정",   start: "2026-04-01", end: "2026-04-21", status: "진행중" },
    ],
  },
  "TM-1846": {
    roles: [
      { role: "기획",   person: "정유민", start: "2026-01-15", end: "2026-02-25", status: "완료" },
      { role: "디자인", person: "미정",   start: "2026-02-10", end: "2026-03-20", status: "완료" },
      { role: "개발BE", person: "미정",   start: "2026-03-01", end: "2026-04-20", status: "진행중" },
      { role: "개발FE", person: "미정",   start: "2026-03-10", end: "2026-04-20", status: "진행중" },
      { role: "QA",     person: "미정",   start: "2026-04-10", end: "2026-04-27", status: "예정" },
    ],
  },
  "TM-1886": {
    roles: [
      { role: "기획",   person: "백수지", start: "2026-01-20", end: "2026-02-28", status: "완료" },
      { role: "디자인", person: "미정",   start: "2026-02-20", end: "2026-03-31", status: "완료" },
      { role: "개발BE", person: "미정",   start: "2026-03-15", end: "2026-05-10", status: "진행중" },
      { role: "개발FE", person: "미정",   start: "2026-03-20", end: "2026-05-10", status: "진행중" },
      { role: "QA",     person: "미정",   start: "2026-04-20", end: "2026-05-15", status: "예정" },
    ],
  },
};
