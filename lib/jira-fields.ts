/**
 * Jira REST API v3 — FIELDS 공통 상수.
 *
 * 4 routes (jira-tickets / jira-tickets-single / cron-daily-refresh / kv-recover) 가
 * 각자 FIELDS 배열을 inline 유지하던 drift 를 방지.
 *
 * 변경 시 4 routes 모두 영향 받음 — 단일 진실 소스.
 */

export const JIRA_BATCH_FIELDS = [
  "summary",
  "status",
  "assignee",
  "reporter",
  "issuetype",
  "project",
  "duedate",
  "resolutiondate", // β-1: Done ticket 의 완료일 (ISO 또는 null) — Ticket.resolutionDate 로 매핑
  "priority",
  "parent",
  "issuelinks",
  "customfield_10015", // Start date
  "customfield_10036", // Story Points
  "customfield_10067", // 요청부문 (multiselect)
  "customfield_10070", // 2-Pager/PRD Link
  "customfield_10071", // Health Check
  "customfield_14402", // Main Subject
] as const;

/** Jira API 호출용 FIELDS 문자열 (comma-joined). */
export const JIRA_BATCH_FIELDS_STR = JIRA_BATCH_FIELDS.join(",");
