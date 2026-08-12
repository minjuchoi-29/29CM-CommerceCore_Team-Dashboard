import type {
  JiraFilter,
  JiraFilterKind,
  JiraFilterTargetArea,
} from "@/lib/filter-types";

export const DEFAULT_FILTER_REFRESH_CADENCE_HOURS = 24;

export function inferJiraFilterKind(filter: Pick<JiraFilter, "name" | "label" | "jql" | "kind">): JiraFilterKind {
  if (filter.kind) return filter.kind;
  const text = `${filter.name} ${filter.label ?? ""} ${filter.jql}`.toLowerCase();
  if (/\bproject\s*=\s*etr\b/i.test(filter.jql) || /(^|[^a-z])etr([^a-z]|$)/i.test(text)) return "etr";
  if (/\bissuetype\s*=\s*initiative\b/i.test(filter.jql) || text.includes("okr")) return "initiative";
  if (/\bassignee\s+(?:in\s*\(|=)/i.test(filter.jql) || text.includes("assignee")) return "assignee";
  return "general";
}

export function inferJiraFilterTargetArea(filter: JiraFilter): JiraFilterTargetArea {
  if (filter.targetArea) return filter.targetArea;
  return inferJiraFilterKind(filter) === "etr" ? "etr" : "tickets";
}

export function isJiraFilterEnabled(filter: JiraFilter): boolean {
  return filter.enabled !== false;
}

function splitOrderBy(jql: string): { query: string; orderBy: string } {
  const match = jql.match(/\s+ORDER\s+BY\s+.+$/i);
  if (!match || match.index == null) return { query: jql.trim(), orderBy: "" };
  return {
    query: jql.slice(0, match.index).trim(),
    orderBy: match[0].trim(),
  };
}

/**
 * 담당자 F/U 소스는 생성일이 아니라 현재 책임 여부를 기준으로 수집한다.
 * Jira 저장 Filter 자체는 수정하지 않고 대시보드 호출 JQL만 보완한다.
 */
export function buildEffectiveFilterJql(filter: JiraFilter): string {
  if (filter.syncJql?.trim()) return filter.syncJql.trim();
  if (inferJiraFilterKind(filter) !== "assignee") return `filter = ${filter.jiraFilterId}`;

  const { query } = splitOrderBy(filter.jql);
  const withoutCreatedWindow = query
    .replace(/^\s*created\s*>=\s*-\d+d\s+AND\s+/i, "")
    .replace(/\s+AND\s+created\s*>=\s*-\d+d\s*$/i, "")
    .trim();
  const hasFollowUpWindow = /statusCategory\s*!=\s*Done/i.test(withoutCreatedWindow)
    && /resolved\s*>=\s*-\d+d/i.test(withoutCreatedWindow);
  const followUpQuery = hasFollowUpWindow
    ? withoutCreatedWindow
    : `(${withoutCreatedWindow}) AND (statusCategory != Done OR resolved >= -14d)`;
  return `${followUpQuery} ORDER BY updated DESC`;
}

export function getFilterRefreshCadenceHours(filter: JiraFilter): number {
  const hours = filter.refreshCadenceHours ?? DEFAULT_FILTER_REFRESH_CADENCE_HOURS;
  return Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_FILTER_REFRESH_CADENCE_HOURS;
}
