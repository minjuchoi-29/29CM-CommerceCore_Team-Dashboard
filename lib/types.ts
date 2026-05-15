// ─── Core Ticket Types ────────────────────────────────────────────────────────

export type Ticket = {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  eta?: string;
  startDate?: string;
  type: string;
  project: string;
  requestDept?: string;
  bodyRequestDept?: string;
  parent?: string;
  storyPoints?: number;
  twoPagerUrl?: string;
  prdUrl?: string;
};

export type TicketKey = string;

export type TicketStatus =
  | "론치완료" | "완료" | "배포완료" | "개발완료"
  | "개발중" | "In Progress" | "QA중"
  | "디자인중" | "디자인완료"
  | "기획중" | "기획완료" | "준비중"
  | "SUGGESTED" | "HOLD" | "Postponed" | "Backlog"
  | "철회/반려/취소";

export type IssueType = string;
export type JiraTypeGroup = "Initiative" | "Epic" | "Task" | "기타";

// ─── Planning & Track Types ───────────────────────────────────────────────────

export type TrackState = "대기중" | "검토중" | "완료" | "대상아님";
export type DevTrackKey = "SP" | "PP" | "CFE" | "기타";

export type PlanningEntry = {
  design?: TrackState;
  dev?: TrackState;
  devTracks?: Partial<Record<DevTrackKey, TrackState>>;
  reviewNeeded?: boolean;
};

// ─── Schedule Types ───────────────────────────────────────────────────────────

export type RoleScheduleStatus = "완료" | "진행중" | "예정" | "미정" | "확인필요";

export type RoleSchedule = {
  role: string;
  person?: string;
  start?: string;
  end?: string;
  status?: RoleScheduleStatus;
  detail?: string;
};

export type ScheduleEntry = RoleSchedule & { ticketKey: string };

export type StatusKind = "진행중" | "예정" | "확인필요" | "미정" | "기한초과" | "완료";

// ─── Health Types ─────────────────────────────────────────────────────────────

export type HealthStatus = "Healthy" | "At Risk" | "Blocked";

// ─── Roadmap Types ────────────────────────────────────────────────────────────

export type { RoadmapInitiative } from "@/app/types/roadmap";

// ─── Constants ────────────────────────────────────────────────────────────────

export const JIRA_BASE = "https://jira.team.musinsa.com/browse/";

export const DONE_STATUSES = new Set<string>([
  "론치완료",
  "완료",
  "배포완료",
  "개발완료",
]);

export const ACTIVE_STATUSES = new Set<string>([
  "개발중",
  "In Progress",
  "QA중",
  "디자인중",
  "디자인완료",
  "기획중",
  "기획완료",
  "준비중",
]);
