import {
  getTicketViewLifecycle,
  type WeeklyTargetTicket,
} from "@/lib/weekly-targets";

export const JIRA_STAGE_KEYS = ["준비중", "기획", "디자인", "개발", "QA", "완료", "기타"] as const;
export type JiraStageKey = (typeof JIRA_STAGE_KEYS)[number];

const STAGE_BY_STATUS: Record<string, Exclude<JiraStageKey, "완료" | "기타">> = {
  "준비중": "준비중",
  "기획중": "기획",
  "기획완료": "기획",
  "디자인중": "디자인",
  "디자인완료": "디자인",
  "개발중": "개발",
  "개발 진행중": "개발",
  "진행중": "개발",
  "in progress": "개발",
  "in review": "개발",
  "개발완료": "개발",
  "배포완료": "개발",
  "qa": "QA",
  "qa중": "QA",
  "검수중": "QA",
};

/** Jira의 여러 workflow 상태명을 회의 화면의 공통 단계로 정규화한다. */
export function getTicketJiraStage(
  ticket: WeeklyTargetTicket,
  now: Date = new Date(),
): JiraStageKey {
  const lifecycle = getTicketViewLifecycle(ticket, now);
  if (["recently_completed", "completed", "terminal"].includes(lifecycle)) return "완료";

  const normalizedStatus = ticket.status.trim().toLocaleLowerCase("en-US");
  return STAGE_BY_STATUS[normalizedStatus] ?? "기타";
}

export function countTicketsByJiraStage(
  tickets: WeeklyTargetTicket[],
  now: Date = new Date(),
): Record<JiraStageKey, number> {
  const counts = Object.fromEntries(JIRA_STAGE_KEYS.map(stage => [stage, 0])) as Record<JiraStageKey, number>;
  for (const ticket of tickets) counts[getTicketJiraStage(ticket, now)]++;
  return counts;
}
