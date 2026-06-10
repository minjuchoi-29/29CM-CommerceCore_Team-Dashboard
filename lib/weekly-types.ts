/**
 * Weekly 공유사항 Delta Sync — 타입 정의
 * 순수 타입만 포함. 로직 없음.
 */

export type ScheduleStatus = "완료" | "진행중" | "예정" | "미정" | "확인필요" | "지연" | "보류";

export interface StatusTransition {
  from: ScheduleStatus;
  to: ScheduleStatus;
  sourceWeek: string;
  changedAt: string;
}
export type ScheduleSource = "jira_weekly" | "manual" | "imported" | "confirmed" | "legacy";
export type ActionCategory =
  | "schedule_confirmation"
  | "planning_review"
  | "dependency"
  | "qa"
  | "release"
  | "unknown";
export type NoteSeverity = "high" | "medium" | "low";
export type Confidence = "high" | "medium" | "low";
/** 한 줄의 분류 결과 */
export type LineClassification = "schedule" | "action" | "risk" | "note";

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
  mergeKey?: string;  // `${ticketKey}::${normalizedRole}` — legacy lookup key
  /** Stable deterministic identity: `${ticketKey}::${phase}::${semanticSlug}` */
  stableTaskId?: string;
  /** Status change log — appended on each status transition, never replaced. */
  statusHistory?: StatusTransition[];
  /** Phase taxonomy (Kick-Off/기획/디자인/개발/QA/Release/Launch/기타). UI lane 분리용. */
  phase?: SchedulePhase;
  /** 자유 text resource team (예: "Core AI BE", "BE-PP"). UI sublabel용. */
  resourceTeam?: string | null;
}

/**
 * Phase taxonomy — 운영 단계.
 * normalize 대상: Kick-Off / 기획 / 디자인 / 개발 / QA / Release / Launch.
 * "기타"는 표준 phase 매칭 실패 시 fallback (schedule 자격 없음).
 */
export type SchedulePhase =
  | "Kick-Off" | "기획" | "디자인" | "개발" | "QA" | "Release" | "Launch" | "기타";

/**
 * phase가 어떤 경로로 결정됐는지 추적하는 메타.
 *
 * - roleRaw          : 라인의 콜론 앞 텍스트("기획 : ...")에서 직접 매칭
 * - lineBody         : 라인 본문 전체에서 키워드 매칭 (roleRaw가 비었거나 "기타"일 때)
 * - parentInheritance: AST 부모 item에서 phase 상속 (자체 매칭 실패 시)
 *
 * 운영자가 "왜 이 candidate가 이 phase로 분류됐는가"를 확인할 수 있도록
 * UI/debug에 노출 가능. 정책 변경 영향도 분석에도 사용.
 */
export type PhaseSource = "roleRaw" | "lineBody" | "parentInheritance";

/** 파싱된 일정 항목 */
export interface ParsedScheduleItem {
  role: string;
  /**
   * @deprecated Use `phase` + `resourceTeam`.
   * mergeKey 호환을 위해 유지. 새 코드는 phase / resourceTeam를 사용해 lane/sublabel 분리.
   * 값 규칙: resourceTeam이 있으면 resourceTeam, 없으면 phase.
   */
  normalizedRole: string;
  /** 운영 단계 — 정해진 phase taxonomy 기준 normalize */
  phase?: SchedulePhase;
  /** 자유 text resource team 명칭 (예: "Core AI BE", "BE-PP", "메가존"). null이면 phase만 있는 단일 단계 (예: 기획/QA/Launch) */
  resourceTeam?: string | null;
  startDate: string | null;
  endDate: string | null;
  status: ScheduleStatus;
  assignee: string | null;
  rawText: string;
  isCancelled: boolean;
  /** schedule candidate 신뢰도 — schedule row 후보화 시 사용 */
  confidence?: Confidence;
  /** phase 결정 경로 — explainability/debug 용 (Option D 정책). 기존 schema와 호환 위해 optional. */
  phaseSource?: PhaseSource;
  /** parentInheritance인 경우 어느 부모 텍스트에서 받았는지 (debug) */
  inheritedFromParentText?: string | null;
  /** Deterministic row identity computed by parser: `${ticketKey}::${phase}::${semanticSlug}` */
  stableTaskId?: string;
  /** Which date fields were explicitly present in the source text (vs inferred/defaulted). */
  dateMentioned?: { start: boolean; end: boolean };
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
  /**
   * 자유형식(section header 없는) Weekly 본문에서 분류된 line 분류 결과.
   * - schedule: ParsedScheduleItem으로 추출됨 (scheduleItems와 중복 가능)
   * - action / risk / note: schedule이 아닌 candidate
   * UI에서 type별 정렬 + checkbox 일괄 처리 시 사용.
   */
  classifiedLines?: Array<{
    type: LineClassification;
    confidence: Confidence;
    content: string;
    rawText: string;
    /** type === "schedule"일 때만 채워짐 */
    schedule?: ParsedScheduleItem;
    /** schedule 아닌 이유 */
    declineReason?: string;
  }>;
  /** parse 결과 디버깅 정보 — UI/로그용. merge 로직과 무관. */
  debug?: {
    sectionsFound: string[];      // 매칭된 섹션 이름들
    ignoredLines: string[];       // 어느 섹션에도 안 들어간 줄들 (앞 5개)
    warnings: string[];           // parsing 도중 발생한 경고
  };
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

  // PR #39 — Weekly Sync Visibility:
  //   직전 sync 의 outcome 집계 + 항목 — UI 표시용 (Read-only).
  //   merge 동작 변경 없음 — trace 결과만 추가 저장.
  lastTraceSummary?: WeeklySyncTraceSummary;
  lastTraceItems?: WeeklySyncTraceItem[];
}

/** 직전 sync 의 outcome 별 카운트. */
export interface WeeklySyncTraceSummary {
  appended:   number; // 신규 row 생성
  updated:    number; // autoApply (값 갱신)
  candidates: number; // candidate 만 생성 (확인 필요)
  idempotent: number; // 변경 없음
  manualGuard: number; // manual row 보호
}

/** 직전 sync 의 각 항목 — UI 의 detail expand 용. */
export interface WeeklySyncTraceItem {
  outcome:    "appended" | "updated" | "candidates_only" | "idempotent" | "manual_guard";
  itemText:   string;             // weekly 원문 line
  phase?:     string;              // parsed phase (예: "개발", "QA", "Launch")
  startDate?: string;              // parsed start date (ISO)
  endDate?:   string;              // parsed end date (ISO)
}

/**
 * KV key: cc-weekly-source-text
 * Structure: Record<ticketKey, WeeklySourceText>
 *
 * Weekly 원문 텍스트를 ticket별로 보관. UI에서 "최근 Weekly 요약"을
 * 줄바꿈·bullet·문단 구조 유지해 표시하기 위함.
 * weekly-sync 후 forceRefresh orchestration이 한 번에 합쳐 저장.
 */
export interface WeeklySourceText {
  ticketKey: string;
  /** customfield_10625 / description weekly section / latest comment 중 선택된 원문 */
  text: string;
  /** "customfield" | "description" | "comment" */
  source: string;
  /** "customfield-first" | "description-first" | "comment-fallback" */
  policyReason: string;
  sourceWeek: string;
  sourceUpdatedAt: string;
  savedAt: string;
}
