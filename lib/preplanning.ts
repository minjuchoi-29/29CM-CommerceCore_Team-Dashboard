export const PREPLANNING_STATUSES = [
  "검토 대기",
  "검토 중",
  "진행 불가",
  "다음 스프린트 재검토",
  "진행 예정",
  "플래닝 완료",
] as const;

export type PreplanningStatus = (typeof PREPLANNING_STATUSES)[number];

export type PreplanningView = {
  status: PreplanningStatus;
  targetSprint: string;
  /** Jira lifecycle 때문에 저장값과 무관하게 완료로 간주된 경우 */
  isDerivedComplete: boolean;
};

const EXECUTION_OR_DONE_STATUSES = new Set([
  "기획중",
  "기획완료",
  "디자인중",
  "디자인완료",
  "개발중",
  "개발 진행중",
  "진행중",
  "In Progress",
  "In Review",
  "QA",
  "QA중",
  "검수중",
  "개발완료",
  "배포완료",
  "론치완료",
  "완료",
]);

const BLOCKED_STATUSES = new Set(["HOLD", "Postponed", "Blocked"]);

function isPreplanningStatus(value: unknown): value is PreplanningStatus {
  return typeof value === "string" && PREPLANNING_STATUSES.includes(value as PreplanningStatus);
}

function normalizedDevState(entry: Record<string, unknown>): string {
  const devTracks = entry.devTracks && typeof entry.devTracks === "object"
    ? Object.values(entry.devTracks as Record<string, unknown>).filter(v => typeof v === "string") as string[]
    : [];
  if (devTracks.length === 0) return typeof entry.dev === "string" ? entry.dev : "대기중";
  if (devTracks.every(v => v === "대상아님")) return "대상아님";
  const active = devTracks.filter(v => v !== "대상아님");
  if (active.some(v => v === "대기중")) return "대기중";
  if (active.some(v => v === "검토중")) return "검토중";
  return "완료";
}

/**
 * 기존 Design/Dev 데이터는 읽기만 하며 신규 프리플래닝 상태를 파생한다.
 * 이 함수는 KV 쓰기를 수행하지 않아 기존 수동 데이터와 메모를 변경하지 않는다.
 */
export function derivePreplanningStatus(
  ticketStatus: string,
  planningEntry: unknown,
): PreplanningStatus {
  if (EXECUTION_OR_DONE_STATUSES.has(ticketStatus)) return "플래닝 완료";

  const entry = planningEntry && typeof planningEntry === "object"
    ? planningEntry as Record<string, unknown>
    : {};

  if (isPreplanningStatus(entry.preplanningStatus)) return entry.preplanningStatus;
  if (BLOCKED_STATUSES.has(ticketStatus)) return "진행 불가";
  if (entry.reviewNeeded === true) return "검토 중";

  const design = typeof entry.design === "string" ? entry.design : "대기중";
  const dev = normalizedDevState(entry);
  const planningDone =
    (design === "완료" || design === "대상아님") &&
    (dev === "완료" || dev === "대상아님");
  if (planningDone) return "플래닝 완료";
  if (design === "검토중" || dev === "검토중") return "검토 중";
  return "검토 대기";
}

export function getPreplanningView(ticketStatus: string, planningEntry: unknown): PreplanningView {
  const entry = planningEntry && typeof planningEntry === "object"
    ? planningEntry as Record<string, unknown>
    : {};
  const isDerivedComplete = EXECUTION_OR_DONE_STATUSES.has(ticketStatus);
  return {
    status: derivePreplanningStatus(ticketStatus, planningEntry),
    targetSprint: typeof entry.targetSprint === "string" ? entry.targetSprint : "",
    isDerivedComplete,
  };
}
