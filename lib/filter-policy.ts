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

type AssigneePredicate = {
  start: number;
  end: number;
  operand: string;
  members: string[];
};

function findClosingParen(text: string, openIndex: number): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let index = openIndex; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === quote && text[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") depth++;
    if (char === ")") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitJqlMembers(raw: string): string[] {
  return raw
    .split(",")
    .map(value => value.trim().replace(/^["']|["']$/g, ""))
    .filter(value => value.length > 0 && !/^currentUser\(\)$/i.test(value));
}

function findAssigneePredicate(jql: string): AssigneePredicate | null {
  const inMatch = /\bassignee\s+in\s*\(/i.exec(jql);
  if (inMatch?.index != null) {
    const openIndex = jql.indexOf("(", inMatch.index);
    const closeIndex = findClosingParen(jql, openIndex);
    if (openIndex >= 0 && closeIndex > openIndex) {
      const memberText = jql.slice(openIndex + 1, closeIndex);
      return {
        start: inMatch.index,
        end: closeIndex + 1,
        operand: `IN (${memberText})`,
        members: splitJqlMembers(memberText),
      };
    }
  }

  const equalsMatch = /\bassignee\s*=\s*(currentUser\(\)|"[^"]+"|'[^']+'|[^\s)]+)/i.exec(jql);
  if (equalsMatch?.index == null) return null;
  const rawValue = equalsMatch[1];
  return {
    start: equalsMatch.index,
    end: equalsMatch.index + equalsMatch[0].length,
    operand: `= ${rawValue}`,
    members: splitJqlMembers(rawValue),
  };
}

/** 담당자 소스 JQL에 명시된 팀 Jira accountId 목록을 안전하게 추출한다. */
export function extractTeamParticipantAccountIds(filter: JiraFilter): string[] {
  if (inferJiraFilterKind(filter) !== "assignee") return [];
  const predicate = findAssigneePredicate(filter.syncJql?.trim() || filter.jql);
  return predicate?.members ?? [];
}

/** 기존 담당자 조건을 담당·보고·참조 중 하나인 조건으로 확장한다. */
function broadenAssigneePredicate(jql: string): string {
  const predicate = findAssigneePredicate(jql);
  if (!predicate) return jql;
  const participantPredicate = `(${jql.slice(predicate.start, predicate.end)} OR reporter ${predicate.operand} OR watcher ${predicate.operand})`;
  return `${jql.slice(0, predicate.start)}${participantPredicate}${jql.slice(predicate.end)}`;
}

/**
 * 팀 참여 F/U 소스는 생성일이 아니라 담당·보고·참조 관계를 기준으로 수집한다.
 * Jira 저장 Filter 자체는 수정하지 않고 대시보드 호출 JQL만 보완한다.
 */
export function buildEffectiveFilterJql(filter: JiraFilter): string {
  if (filter.syncJql?.trim()) return filter.syncJql.trim();
  if (inferJiraFilterKind(filter) !== "assignee") return `filter = ${filter.jiraFilterId}`;

  const { query } = splitOrderBy(filter.jql);
  const withoutCreatedWindow = broadenAssigneePredicate(query)
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
