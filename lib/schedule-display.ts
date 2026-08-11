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
  invalidCount: number;
  noiseCount: number;
};

const MILESTONE_PHASES = new Set(["Kick-Off", "Release", "Launch"]);

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
  if (!hasScheduleDateRange(row) || hasInvalidDate(row)) return false;
  const primaryText = row.detail?.trim() || row.role.trim();
  const isParserFragment = !primaryText || /^[\s•·\-–—,./:;()[\]{}]+$/.test(primaryText);
  return isParserFragment || !isCoordinationNoise(row);
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

    const date = rowDate(row);
    const isPastCompleted = row.status === "완료" && date !== null && date < nowMs;
    if (isPastCompleted) {
      history.push(row);
      completedCount += 1;
      return;
    }

    current.push(row);
  });

  return { current, history, supersededCount, completedCount, invalidCount, noiseCount };
}
