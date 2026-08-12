export type ScheduleDisplayRow = {
  role: string;
  person?: string;
  start?: string;
  end?: string;
  status?: string;
  detail?: string;
  source?: string;
  sourceWeek?: string;
  lastSeenAt?: string;
  phase?: string;
  resourceTeam?: string | null;
  archivedAt?: string;
  archiveReason?: string;
};

export type CompactScheduleResult<T> = {
  current: T[];
  history: T[];
  supersededCount: number;
  completedCount: number;
  staleCount: number;
  redundantPlaceholderCount: number;
  redundantMilestoneCount: number;
  invalidCount: number;
  noiseCount: number;
};

const MILESTONE_PHASES = new Set(["Kick-Off", "Release", "Launch"]);
const STALE_ACTIVE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function normalize(value?: string | null): string {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, " ");
}

function normalizeTaskIdentity(value?: string | null): string {
  return normalize(value)
    .replace(/\([^)]*(?:\d+(?:\.\d+)?\s*md|예정|진행\s*중|완료)[^)]*\)/gi, " ")
    .replace(/(?:^|\s)(?:예정|진행\s*중|완료)(?=$|\s)/gi, " ")
    .replace(/^[\s•·\-–—]+/, "")
    .replace(/[\s,./:;()[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyTaskResource(resource: string, taskIdentity: string): boolean {
  if (!resource || !taskIdentity) return false;
  const normalizedResource = normalizeTaskIdentity(resource);
  return normalizedResource === taskIdentity
    || normalizedResource.includes(taskIdentity)
    || taskIdentity.includes(normalizedResource);
}

function weekNumber(sourceWeek?: string): number {
  const match = sourceWeek?.match(/\d+/);
  return match ? Number(match[0]) : -1;
}

function rowTimestamp(row: ScheduleDisplayRow): number {
  const lastSeen = row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : Number.NaN;
  if (!Number.isNaN(lastSeen)) return lastSeen;

  const date = row.end || row.start;
  const dated = date ? new Date(`${date}T23:59:59`).getTime() : Number.NaN;
  if (!Number.isNaN(dated)) return dated;

  return weekNumber(row.sourceWeek);
}

function isNewer(a: ScheduleDisplayRow, b: ScheduleDisplayRow): boolean {
  const aTimestamp = rowTimestamp(a);
  const bTimestamp = rowTimestamp(b);
  if (aTimestamp !== bTimestamp) return aTimestamp > bTimestamp;

  const aWeek = weekNumber(a.sourceWeek);
  const bWeek = weekNumber(b.sourceWeek);
  return aWeek > bWeek;
}

function weeklyIdentity(row: ScheduleDisplayRow): string {
  const phase = normalize(row.phase);
  if (MILESTONE_PHASES.has(row.phase ?? "")) return `milestone:${phase}`;

  const detail = normalizeTaskIdentity(row.detail);
  const role = normalizeTaskIdentity(row.role);
  const person = normalize(row.person);
  const rawResource = normalize(row.resourceTeam);
  const taskIdentity = detail || role;
  const resource = isLikelyTaskResource(rawResource, taskIdentity) ? "" : rawResource;
  return `work:${phase}|${detail || role}|${person}|${resource}`;
}

function milestonePhase(row: ScheduleDisplayRow): string | null {
  if (MILESTONE_PHASES.has(row.phase ?? "")) return row.phase ?? null;
  if (MILESTONE_PHASES.has(row.role)) return row.role;
  return null;
}

function isReleaseOrLaunch(row: ScheduleDisplayRow): boolean {
  const phase = milestonePhase(row);
  return phase === "Release" || phase === "Launch";
}

function isGenericMilestoneContent(row: ScheduleDisplayRow): boolean {
  const phase = milestonePhase(row);
  if (phase !== "Release" && phase !== "Launch") return false;
  if (row.person?.trim() && row.person.trim() !== "-") return false;

  const resource = normalizeTaskIdentity(row.resourceTeam);
  const normalizedPhase = normalizeTaskIdentity(phase);
  const normalizedRole = normalizeTaskIdentity(row.role);
  if (resource && resource !== normalizedPhase && resource !== normalizedRole) return false;

  const detail = normalizeTaskIdentity(row.detail);
  if (!detail) return true;
  const genericLabels = phase === "Release"
    ? new Set([normalizedPhase, normalizedRole, "배포일", "배포 일정", "release 일정"])
    : new Set([normalizedPhase, normalizedRole, "오픈일", "런칭", "런칭 일정", "launch 일정"]);
  return genericLabels.has(detail);
}

/**
 * 날짜가 같은 Weekly Launch/Release가 있을 때 과거 UI가 만든 설명 없는 반대편
 * 수동 마일스톤만 화면에서 감춘다. 저장 원본과 의미 있는 수동 일정은 유지한다.
 */
function removeRedundantLegacyMilestones<T extends ScheduleDisplayRow>(rows: T[], evidenceRows: T[] = rows): {
  rows: T[];
  count: number;
} {
  const weeklyByDate = new Map<string, T[]>();
  for (const row of evidenceRows) {
    if (row.source !== "jira_weekly" || !isReleaseOrLaunch(row)) continue;
    if (row.archivedAt || hasInvalidDate(row)) continue;
    const date = row.end || row.start;
    if (!date) continue;
    weeklyByDate.set(date, [...(weeklyByDate.get(date) ?? []), row]);
  }

  let count = 0;
  const visible = rows.filter(row => {
    if (row.source === "jira_weekly" || !isGenericMilestoneContent(row)) return true;
    const date = row.end || row.start;
    const phase = milestonePhase(row);
    if (!date || !phase) return true;
    const hasWeeklyCounterpart = (weeklyByDate.get(date) ?? [])
      .some(peer => milestonePhase(peer) !== phase);
    if (!hasWeeklyCounterpart) return true;
    count += 1;
    return false;
  });

  return { rows: visible, count };
}

/**
 * 편집 화면에서도 중복 마일스톤은 감추되, 저장 시 원본을 다시 합칠 수 있도록
 * 감춘 행을 별도로 돌려준다. 이 함수는 행을 수정하거나 삭제하지 않는다.
 */
export function partitionRedundantLegacyMilestones<T extends ScheduleDisplayRow>(rows: T[]): {
  visible: T[];
  preserved: T[];
} {
  const { rows: visible } = removeRedundantLegacyMilestones(rows);
  const visibleRows = new Set(visible);
  return {
    visible,
    preserved: rows.filter(row => !visibleRows.has(row)),
  };
}

/** 세부 일정 헤더에서 사용자가 실제로 확인해야 하는 행만 판별한다. */
export function isActionableScheduleConfirmation(row: ScheduleDisplayRow): boolean {
  if (isReleaseOrLaunch(row)) return false;
  if (row.status === "완료" || row.status === "미정") return false;
  if (row.status === "확인필요") return true;
  return !row.start && !row.end && (row.status === "진행중" || row.status === "예정");
}

/**
 * 날짜가 확정된 같은 마일스톤이 있을 때만 감출 수 있는 빈 수동 틀인지 판별한다.
 * 담당자나 별도 설명이 있으면 사용자가 남긴 정보로 보고 계속 노출한다.
 */
function isEmptyMilestonePlaceholder(row: ScheduleDisplayRow): boolean {
  const phase = milestonePhase(row);
  if (!phase || row.start || row.end) return false;
  if (row.source === "jira_weekly") return false;
  if (row.status && row.status !== "미정" && row.status !== "확인필요") return false;
  if (row.person?.trim() && row.person.trim() !== "-") return false;

  const detail = normalizeTaskIdentity(row.detail);
  const role = normalizeTaskIdentity(row.role);
  const normalizedPhase = normalizeTaskIdentity(phase);
  if (detail && detail !== role && detail !== normalizedPhase && detail !== `${normalizedPhase} 일정`) {
    return false;
  }

  const resource = normalizeTaskIdentity(row.resourceTeam);
  return !resource || resource === role || resource === normalizedPhase;
}

function rowDate(row: ScheduleDisplayRow): number | null {
  const value = row.end || row.start;
  if (!value) return null;
  const timestamp = new Date(`${value}T23:59:59`).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function hasInvalidDate(row: ScheduleDisplayRow): boolean {
  const values = [row.start, row.end].filter((value): value is string => !!value);
  for (const value of values) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return true;
    const year = Number(match[1]);
    const parsed = new Date(`${value}T00:00:00`);
    if (year < 2000 || year > new Date().getFullYear() + 5 || Number.isNaN(parsed.getTime())) {
      return true;
    }
  }
  return !!row.start && !!row.end && row.end < row.start;
}

function isCoordinationNoise(row: ScheduleDisplayRow): boolean {
  if (row.source !== "jira_weekly") return false;
  const primaryText = row.detail?.trim() || row.role.trim();
  if (!primaryText || /^[\s•·\-–—,./:;()[\]{}]+$/.test(primaryText)) return true;
  const text = primaryText;
  return /(논의|회의|미팅|sync|리뷰)/i.test(text)
    || (row.phase === "QA" && /통합검수/.test(text) && /(정책|기획|요구사항)/.test(text));
}

/**
 * 이력 펼침에서 사람이 읽을 수 없는 파서 조각만 숨긴다.
 * 저장값은 유지하고, 수동 일정은 문구와 관계없이 항상 보호한다.
 */
export function isMeaningfulScheduleHistoryRow(row: ScheduleDisplayRow): boolean {
  if (row.source !== "jira_weekly") return true;
  const primaryText = row.detail?.trim() || row.role.trim();
  if (primaryText && !/^[\s•·\-–—,./:;()[\]{}]+$/.test(primaryText)) return true;
  // 구 파서가 detail을 문장부호 조각으로 남겼더라도, 시작과 종료가 다른 기간은
  // 일정 자체가 의미 있으므로 숨기지 않는다. 단일 ETA 조각은 계속 제외한다.
  return !!row.start && !!row.end && row.start !== row.end;
}

export function hasScheduleDateRange(row: ScheduleDisplayRow): boolean {
  return !!row.start && !!row.end && row.start !== row.end;
}

export function isPrimaryScheduleRange(row: ScheduleDisplayRow): boolean {
  // 기본 화면으로 다시 올리는 과거 기간은 실제 완료가 확인된 경우로 제한한다.
  // 과거의 예정/진행중 기간은 상태를 추정하지 않고 접힌 이력에 둔다.
  if (row.status !== "완료" || !hasScheduleDateRange(row) || hasInvalidDate(row)) return false;
  const primaryText = row.detail?.trim() || row.role.trim();
  const isParserFragment = !primaryText || /^[\s•·\-–—,./:;()[\]{}]+$/.test(primaryText);
  return isParserFragment || !isCoordinationNoise(row);
}

/**
 * 날짜가 지났지만 후속 Weekly에서 상태가 확정되지 않은 자동 일정을 식별한다.
 * 완료로 추정하거나 저장값을 바꾸지 않고, 화면에서만 이력으로 분리한다.
 */
export function isStaleAutomaticSchedule(
  row: ScheduleDisplayRow,
  nowMs = Date.now(),
): boolean {
  if (row.source !== "jira_weekly") return false;
  const date = rowDate(row);
  if (date === null || date >= nowMs) return false;
  if (row.status === "예정") return true;
  if (row.status !== "진행중" || !row.lastSeenAt) return false;

  const lastSeen = new Date(row.lastSeenAt).getTime();
  if (Number.isNaN(lastSeen)) return false;
  return nowMs - lastSeen > STALE_ACTIVE_DAYS * DAY_MS;
}

/**
 * 화면 표시만 정리한다. 저장 데이터는 변경하지 않는다.
 *
 * - 수동 일정은 항상 현재 일정으로 유지한다.
 * - Weekly 마일스톤은 phase별 최신 항목만 현재 일정으로 노출한다.
 * - 같은 작업의 Weekly 중복은 최신 sourceWeek/lastSeenAt만 남긴다.
 * - 완료된 과거 일정은 접힌 이력으로 이동한다.
 */
export function compactSchedulesForDisplay<T extends ScheduleDisplayRow>(
  rows: T[],
  nowMs = Date.now(),
): CompactScheduleResult<T> {
  const latestWeeklyIndex = new Map<string, number>();

  rows.forEach((row, index) => {
    if (row.source === "jira_weekly" && row.archivedAt) return;
    if (row.source !== "jira_weekly") return;
    // 노이즈 행이 더 최신으로 판단돼 의미 있는 실제 작업을 밀어내지 않도록
    // dedupe index에서도 처음부터 제외한다.
    if (isCoordinationNoise(row)) return;
    const identity = weeklyIdentity(row);
    const previousIndex = latestWeeklyIndex.get(identity);
    if (previousIndex === undefined || isNewer(row, rows[previousIndex])) {
      latestWeeklyIndex.set(identity, index);
    }
  });

  const current: T[] = [];
  const history: T[] = [];
  let supersededCount = 0;
  let completedCount = 0;
  let staleCount = 0;
  let redundantPlaceholderCount = 0;
  let redundantMilestoneCount = 0;
  let invalidCount = 0;
  let noiseCount = 0;

  rows.forEach((row, index) => {
    if (row.source === "jira_weekly" && row.archivedAt) {
      history.push(row);
      supersededCount += 1;
      return;
    }
    if (row.source === "jira_weekly" && hasInvalidDate(row)) {
      history.push(row);
      invalidCount += 1;
      return;
    }
    if (isCoordinationNoise(row)) {
      history.push(row);
      noiseCount += 1;
      return;
    }
    if (row.source === "jira_weekly") {
      const latestIndex = latestWeeklyIndex.get(weeklyIdentity(row));
      if (latestIndex !== index) {
        history.push(row);
        supersededCount += 1;
        return;
      }
    }

    if (isStaleAutomaticSchedule(row, nowMs)) {
      history.push(row);
      staleCount += 1;
      return;
    }

    const date = rowDate(row);
    const isPastCompleted = row.status === "완료" && date !== null && date < nowMs;
    if (isPastCompleted) {
      history.push(row);
      completedCount += 1;
      return;
    }

    current.push(row);
  });

  const datedCurrentMilestones = new Set(
    current
      .filter(row => !!(row.start || row.end))
      .map(milestonePhase)
      .filter((phase): phase is string => !!phase),
  );
  const visibleCurrent = current.filter(row => {
    const phase = milestonePhase(row);
    const isRedundant = !!phase
      && datedCurrentMilestones.has(phase)
      && isEmptyMilestonePlaceholder(row);
    if (isRedundant) redundantPlaceholderCount += 1;
    return !isRedundant;
  });

  const milestoneCompaction = removeRedundantLegacyMilestones(visibleCurrent, rows);
  redundantMilestoneCount = milestoneCompaction.count;

  return {
    current: milestoneCompaction.rows,
    history,
    supersededCount,
    completedCount,
    staleCount,
    redundantPlaceholderCount,
    redundantMilestoneCount,
    invalidCount,
    noiseCount,
  };
}
