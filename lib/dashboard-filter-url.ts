import type { TransitionKind } from "@/lib/transitions";
import type { PreplanningStatus } from "@/lib/preplanning";
import type { TrackState } from "@/lib/planning-helpers";
import type { TicketParticipationRole, TicketReviewMode } from "@/lib/ticket-review";
import type { EtrReviewFilterKey } from "@/lib/etr-links";

export const TICKET_PLANNING_TABS = ["전체", "진행 중", "플래닝 대기·검토", "완료"] as const;
export type TicketPlanningTab = (typeof TICKET_PLANNING_TABS)[number];

export const TICKET_STATUS_TABS = ["전체", "완료", "진행중", "계획/대기", "기획", "디자인", "준비중", "개발", "QA", "기타"] as const;
export type TicketStatusTab = (typeof TICKET_STATUS_TABS)[number];

export const TICKET_DASHBOARD_SORTS = [
  "default",
  "planningPriority",
  "planningPriorityDesc",
  "executionPriority",
  "executionPriorityDesc",
  "startDate",
  "eta",
  "ticketNo",
] as const;
export type TicketDashboardSort = (typeof TICKET_DASHBOARD_SORTS)[number];

export const ETR_SORT_COLUMNS = ["key", "summary", "status", "assignee", "reporter", "eta", "priority", "source", "linkedWork", "docs"] as const;
export type EtrSortColumn = (typeof ETR_SORT_COLUMNS)[number];

export type TicketTransitionFilter = TransitionKind | "all" | "newly_added";

export type TicketDashboardUrlState = {
  planningTab: TicketPlanningTab;
  statusTab: TicketStatusTab;
  quarters: string[];
  projects: string[];
  statuses: string[];
  levels: string[];
  domains: string[];
  targets: string[];
  assignees: string[];
  participationRoles: TicketParticipationRole[];
  search: string;
  reviewFilter: boolean;
  reviewMode: "all" | TicketReviewMode;
  newFilter: boolean;
  planningTeam: string | null;
  planningTeamState: TrackState | null;
  preplanningStatus: PreplanningStatus | null;
  sortBy: TicketDashboardSort;
  changesMode: boolean;
  transitionFilter: TicketTransitionFilter;
};

export type ParsedTicketDashboardUrlState = {
  /** scope가 있으면 이 버전에서 만든 완전한 필터 URL이다. */
  canonical: boolean;
  state: TicketDashboardUrlState;
};

export type EtrDashboardUrlState = {
  filter: EtrReviewFilterKey;
  statusFilter: string;
  search: string;
  sort: { col: EtrSortColumn; dir: "asc" | "desc" } | null;
  selectedKey: string | null;
};

export type ParsedEtrDashboardUrlState = {
  /** view가 있으면 이 버전에서 만든 완전한 필터 URL이다. */
  canonical: boolean;
  state: EtrDashboardUrlState;
};

const TICKET_FILTER_PARAMS = [
  "scope", "ptab", "stage", "check", "quarter", "project", "jiraStatus",
  "level", "domain", "target", "assignee", "role", "q", "review", "new",
  "team", "teamState", "preplan", "sort", "changed", "changeKind",
] as const;

const ETR_FILTER_PARAMS = ["view", "jiraStatus", "q", "sort", "dir", "key"] as const;

const SCOPE_TO_TAB: Record<string, TicketPlanningTab> = {
  all: "전체",
  active: "진행 중",
  planning: "플래닝 대기·검토",
  completed: "완료",
};
const TAB_TO_SCOPE = Object.fromEntries(
  Object.entries(SCOPE_TO_TAB).map(([scope, tab]) => [tab, scope]),
) as Record<TicketPlanningTab, string>;

const STAGE_TO_TAB: Record<string, TicketStatusTab> = {
  all: "전체",
  done: "완료",
  active: "진행중",
  waiting: "계획/대기",
  plan: "기획",
  design: "디자인",
  ready: "준비중",
  dev: "개발",
  qa: "QA",
  other: "기타",
};
const TAB_TO_STAGE = Object.fromEntries(
  Object.entries(STAGE_TO_TAB).map(([stage, tab]) => [tab, stage]),
) as Record<TicketStatusTab, string>;

const REVIEW_MODES = new Set(["all", "weekly", "monitor", "reference"] as const);
const PARTICIPATION_ROLES = new Set(["assignee", "reporter", "watcher", "manual"] as const);
const PREPLANNING_STATUSES = new Set<PreplanningStatus>([
  "검토 대기", "검토 중", "진행 불가", "다음 스프린트 재검토", "진행 예정", "플래닝 완료",
]);
const TRACK_STATES = new Set<TrackState>(["대기중", "검토중", "완료", "대상아님"]);
const SORTS = new Set<TicketDashboardSort>(TICKET_DASHBOARD_SORTS);
const TRANSITION_FILTERS = new Set<TicketTransitionFilter>([
  "all", "newly_added", "lifecycle:started", "lifecycle:completed", "planning:design-start",
  "planning:dev-start", "planning:qa-start", "attention:review-needed", "attention:overdue",
]);
const ETR_FILTERS = new Set<EtrReviewFilterKey>([
  "needsAction", "all", "statusUpdateNeeded", "noLinkedWork", "hasLinkedWork", "reviewed", "closed",
]);
const ETR_SORTS = new Set<EtrSortColumn>(ETR_SORT_COLUMNS);

function isOneOf<T extends string>(value: string | null, values: ReadonlySet<T>): value is T {
  return value !== null && values.has(value as T);
}

/** 같은 query key의 값은 최초 등장 순서를 유지하며 정확히 한 번만 반환한다. */
export function uniqueQueryValues(params: URLSearchParams, key: string): string[] {
  return [...new Set(params.getAll(key).map(value => value.trim()).filter(Boolean))];
}

function booleanParam(params: URLSearchParams, key: string): boolean {
  return params.get(key) === "1";
}

function appendValues(params: URLSearchParams, key: string, values: Iterable<string>) {
  const unique = [...new Set([...values].map(value => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ko"));
  for (const value of unique) params.append(key, value);
}

function deleteParams(params: URLSearchParams, keys: readonly string[]) {
  for (const key of keys) params.delete(key);
}

export function parseTicketDashboardUrl(params: URLSearchParams): ParsedTicketDashboardUrlState {
  const canonical = params.has("scope");
  const scope = params.get("scope");
  const legacyTab = params.get("ptab");
  const planningTab = SCOPE_TO_TAB[scope ?? ""]
    ?? (TICKET_PLANNING_TABS.includes(legacyTab as TicketPlanningTab) ? legacyTab as TicketPlanningTab : "진행 중");
  const stage = params.get("stage");
  const reviewMode = params.get("check");
  const sortBy = params.get("sort");
  const participationRoles = uniqueQueryValues(params, "role")
    .filter((value): value is TicketParticipationRole => isOneOf(value, PARTICIPATION_ROLES));
  const preplanningStatus = params.get("preplan");
  const planningTeamState = params.get("teamState");
  const transitionFilter = params.get("changeKind");

  return {
    canonical,
    state: {
      planningTab,
      statusTab: STAGE_TO_TAB[stage ?? ""] ?? "전체",
      quarters: uniqueQueryValues(params, "quarter"),
      projects: uniqueQueryValues(params, "project"),
      statuses: uniqueQueryValues(params, "jiraStatus"),
      levels: uniqueQueryValues(params, "level"),
      domains: uniqueQueryValues(params, "domain"),
      targets: uniqueQueryValues(params, "target"),
      assignees: uniqueQueryValues(params, "assignee"),
      participationRoles,
      search: params.get("q") ?? "",
      reviewFilter: booleanParam(params, "review"),
      reviewMode: isOneOf(reviewMode, REVIEW_MODES) ? reviewMode : "all",
      newFilter: booleanParam(params, "new"),
      planningTeam: params.get("team")?.trim() || null,
      planningTeamState: isOneOf(planningTeamState, TRACK_STATES) ? planningTeamState : null,
      preplanningStatus: isOneOf(preplanningStatus, PREPLANNING_STATUSES) ? preplanningStatus : null,
      sortBy: isOneOf(sortBy, SORTS) ? sortBy : "eta",
      changesMode: booleanParam(params, "changed"),
      transitionFilter: isOneOf(transitionFilter, TRANSITION_FILTERS) ? transitionFilter : "all",
    },
  };
}

/** 기존 ticket/focus/tab 등 상세 query는 건드리지 않고 필터 query만 교체한다. */
export function writeTicketDashboardUrl(
  current: URLSearchParams,
  state: TicketDashboardUrlState,
): URLSearchParams {
  const params = new URLSearchParams(current);
  deleteParams(params, TICKET_FILTER_PARAMS);

  params.set("scope", TAB_TO_SCOPE[state.planningTab]);
  params.set("stage", TAB_TO_STAGE[state.statusTab]);
  params.set("check", state.reviewMode);
  params.set("sort", state.sortBy);
  appendValues(params, "quarter", state.quarters);
  appendValues(params, "project", state.projects);
  appendValues(params, "jiraStatus", state.statuses);
  appendValues(params, "level", state.levels);
  appendValues(params, "domain", state.domains);
  appendValues(params, "target", state.targets);
  appendValues(params, "assignee", state.assignees);
  appendValues(params, "role", state.participationRoles);
  if (state.search.trim()) params.set("q", state.search.trim());
  if (state.reviewFilter) params.set("review", "1");
  if (state.newFilter) params.set("new", "1");
  if (state.planningTeam) params.set("team", state.planningTeam);
  if (state.planningTeamState) params.set("teamState", state.planningTeamState);
  if (state.preplanningStatus) params.set("preplan", state.preplanningStatus);
  if (state.changesMode) {
    params.set("changed", "1");
    if (state.transitionFilter !== "all") params.set("changeKind", state.transitionFilter);
  }
  return params;
}

export function parseEtrDashboardUrl(params: URLSearchParams): ParsedEtrDashboardUrlState {
  const canonical = params.has("view");
  const view = params.get("view");
  const sortCol = params.get("sort");
  const sortDir = params.get("dir");
  const key = params.get("key");
  return {
    canonical,
    state: {
      filter: isOneOf(view, ETR_FILTERS) ? view : "needsAction",
      statusFilter: params.get("jiraStatus") ?? "",
      search: params.get("q") ?? "",
      sort: isOneOf(sortCol, ETR_SORTS)
        ? { col: sortCol, dir: sortDir === "desc" ? "desc" : "asc" }
        : null,
      selectedKey: key?.startsWith("ETR-") ? key : null,
    },
  };
}

export function writeEtrDashboardUrl(
  current: URLSearchParams,
  state: EtrDashboardUrlState,
): URLSearchParams {
  const params = new URLSearchParams(current);
  deleteParams(params, ETR_FILTER_PARAMS);
  params.set("view", state.filter);
  if (state.statusFilter) params.set("jiraStatus", state.statusFilter);
  if (state.search.trim()) params.set("q", state.search.trim());
  if (state.sort) {
    params.set("sort", state.sort.col);
    params.set("dir", state.sort.dir);
  }
  if (state.selectedKey) params.set("key", state.selectedKey);
  return params;
}
