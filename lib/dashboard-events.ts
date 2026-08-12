export const DASHBOARD_SEARCH_CHANGE_EVENT = "dashboard-search-change";
export const DASHBOARD_LIST_CONTEXT_EVENT = "dashboard-list-context";
export const DASHBOARD_TICKET_INDEX_EVENT = "dashboard-ticket-index";
export const DASHBOARD_TICKETS_ADDED_EVENT = "dashboard-tickets-added";
export const DASHBOARD_JIRA_SYNC_REQUEST_EVENT = "dashboard-jira-sync-request";
export const DASHBOARD_JIRA_SYNC_STATE_EVENT = "dashboard-jira-sync-state";

export type DashboardSearchChangeDetail = {
  query: string;
  applyToCurrentList: boolean;
};

export type DashboardListContextDetail = {
  scope: "tickets" | "etr";
  label: string;
  keys: string[];
};

export type DashboardTicketIndexDetail<T = unknown> = {
  tickets: T[];
};

export type DashboardTicketsAddedDetail<T = unknown> = {
  tickets: T[];
};

export type DashboardJiraSyncStateDetail = {
  running: boolean;
  label?: string;
};
