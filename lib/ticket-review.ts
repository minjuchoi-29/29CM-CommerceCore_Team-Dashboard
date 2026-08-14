import type { FilterTicketsStore, JiraFiltersStore } from "@/lib/filter-types";
import {
  extractTeamParticipantAccountIds,
  inferJiraFilterKind,
} from "@/lib/filter-policy";

export const TICKET_REVIEW_MODES = ["weekly", "monitor", "reference"] as const;
export type TicketReviewMode = (typeof TICKET_REVIEW_MODES)[number];

export const TICKET_PARTICIPATION_ROLES = ["assignee", "reporter", "watcher", "manual"] as const;
export type TicketParticipationRole = (typeof TICKET_PARTICIPATION_ROLES)[number];

export type TicketReviewOverrides = Record<string, TicketReviewMode>;

export const TICKET_REVIEW_MODE_LABELS: Record<TicketReviewMode, string> = {
  weekly: "위클리 체크",
  monitor: "모니터링",
  reference: "필요 시 확인",
};

export const TICKET_PARTICIPATION_ROLE_LABELS: Record<TicketParticipationRole, string> = {
  assignee: "담당",
  reporter: "요청",
  watcher: "참조",
  manual: "직접 추가",
};

type ParticipationCandidate = {
  key: string;
  assigneeAccountId?: string;
  reporterAccountId?: string;
  isManual?: boolean;
};

function buildTeamParticipantAccountIdSet(filtersStore: JiraFiltersStore): Set<string> {
  const accountIds = new Set<string>();
  for (const filter of Object.values(filtersStore)) {
    for (const accountId of extractTeamParticipantAccountIds(filter)) accountIds.add(accountId);
  }
  return accountIds;
}

function buildParticipantFilterMembership(
  filterTickets: FilterTicketsStore,
  filtersStore: JiraFiltersStore,
): Set<string> {
  const keys = new Set<string>();
  for (const [filterId, ticketKeys] of Object.entries(filterTickets)) {
    const filter = filtersStore[filterId];
    if (!filter || inferJiraFilterKind(filter) !== "assignee") continue;
    for (const key of ticketKeys) keys.add(key);
  }
  return keys;
}

/**
 * Jira 팀 참여 데이터 소스와 현재 issue 메타를 결합해 포함 이유를 만든다.
 * watcher 목록은 Jira batch field로 노출되지 않으므로, 팀 참여 필터에 속하면서
 * 담당자·보고자 accountId가 팀원과 일치하지 않는 경우에만 참조로 판별한다.
 */
export function buildTicketParticipationMap(
  tickets: ParticipationCandidate[],
  filterTickets: FilterTicketsStore,
  filtersStore: JiraFiltersStore,
): Record<string, TicketParticipationRole[]> {
  const teamAccountIds = buildTeamParticipantAccountIdSet(filtersStore);
  const participantFilterKeys = buildParticipantFilterMembership(filterTickets, filtersStore);
  const result: Record<string, TicketParticipationRole[]> = {};

  for (const ticket of tickets) {
    const roles: TicketParticipationRole[] = [];
    const isTeamAssignee = !!ticket.assigneeAccountId && teamAccountIds.has(ticket.assigneeAccountId);
    const isTeamReporter = !!ticket.reporterAccountId && teamAccountIds.has(ticket.reporterAccountId);
    if (isTeamAssignee) roles.push("assignee");
    if (isTeamReporter) roles.push("reporter");
    if (
      teamAccountIds.size > 0
      && participantFilterKeys.has(ticket.key)
      && !isTeamAssignee
      && !isTeamReporter
    ) roles.push("watcher");
    if (ticket.isManual) roles.push("manual");
    if (roles.length > 0) result[ticket.key] = roles;
  }

  return result;
}

/** 참여 관계는 기본값일 뿐이며, 사용자가 저장한 확인 방식이 항상 우선한다. */
export function resolveTicketReviewMode(
  participationRoles: TicketParticipationRole[] | undefined,
  override?: TicketReviewMode,
): TicketReviewMode {
  if (override && TICKET_REVIEW_MODES.includes(override)) return override;
  const roles = participationRoles ?? [];
  if (roles.includes("assignee") || roles.includes("manual")) return "weekly";
  if (roles.includes("reporter")) return "monitor";
  if (roles.includes("watcher")) return "reference";
  // OKR/공식 필터 등 참여 관계가 없는 기존 관리 티켓은 누락 방지를 위해 모니터링으로 둔다.
  return "monitor";
}
