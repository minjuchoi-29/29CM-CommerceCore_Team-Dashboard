/**
 * Weekly 공유사항 Delta Sync — 타입 정의
 * 순수 타입만 포함. 로직 없음.
 */

export type ScheduleStatus = "완료" | "진행중" | "예정" | "미정" | "확인필요" | "지연" | "보류";
export type ScheduleSource = "jira_weekly" | "manual" | "imported" | "confirmed" | "legacy";
export type ActionCategory =
  | "schedule_confirmation"
  | "planning_review"
  | "dependency"
  | "qa"
  | "release"
  | "unknown";
export type NoteSeverity = "high" | "medium" | "low";

/**
 * 기존 RoleSchedule(TicketBoard.tsx)에 optional로 추가되는 source metadata.
 * 기존 코드는 수정하지 않고, 이 interface를 intersection으로 사용.
 */
export interface ScheduleSourceMeta {
  source?: ScheduleSource;
  sourceWeek?: string;
  sourceUpdatedAt?: string;
  confidence?: "high" | "medium" | "low";
  lastSeenAt?: string;
  firstSeenAt?: string;
  manualLocked?: boolean;
  cancelledCandidate?: boolean;
  mergeKey?: string;  // `${ticketKey}::${normalizedRole}`
}

/** 파싱된 일정 항목 */
export interface ParsedScheduleItem {
  role: string;
  normalizedRole: string;
  startDate: string | null;
  endDate: string | null;
  status: ScheduleStatus;
  assignee: string | null;
  rawText: string;
  isCancelled: boolean;
}

export interface ParsedRisk {
  content: string;
  severity: NoteSeverity;
  rawText: string;
}

export interface ParsedNextAction {
  content: string;
  actionCategory: ActionCategory;
  rawText: string;
}

/** parseWeekly()의 반환값 */
export interface ParsedWeekly {
  ticketKey: string;
  sourceWeek: string;
  sourceText: string;
  parsedAt: string;
  progressItems: string[];
  scheduleItems: ParsedScheduleItem[];
  risks: ParsedRisk[];
  nextActions: ParsedNextAction[];
  noIssues: boolean;
}

/**
 * KV key: cc-weekly-notes
 * Structure: Record<ticketKey, WeeklyNote[]>
 */
export interface WeeklyNote {
  id: string;
  ticketKey: string;
  source: "jira_weekly";
  sourceWeek: string;
  type: "progress" | "risk" | "next_action";
  content: string;
  severity?: NoteSeverity;
  actionCategory?: ActionCategory;
  status: "open" | "resolved";
  createdAt: string;
  sourceUpdatedAt: string;
  lastSeenAt: string;
}

/**
 * KV key: cc-update-candidates
 * Structure: UpdateCandidate[]
 */
export interface UpdateCandidate {
  id: string;
  ticketKey: string;
  mergeKey: string;
  sourceWeek: string;
  field: "start" | "end" | "status" | "person";
  oldValue: string;
  newValue: string;
  autoApply: boolean;
  resolved: boolean;
  createdAt: string;
  resolvedAt?: string;
}

/**
 * KV key: cc-weekly-sync-meta
 * Structure: Record<ticketKey, WeeklySyncMeta>
 */
export interface WeeklySyncMeta {
  ticketKey: string;
  lastSyncAt: string;
  lastSourceWeek: string;
}
