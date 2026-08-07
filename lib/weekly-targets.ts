export const COMPLETED_WEEKLY_TRACKING_DAYS = 14;

const DONE_FOR_WEEKLY = new Set([
  "론치완료",
  "완료",
  "배포완료",
  "개발완료",
]);

export type WeeklyTargetTicket = {
  key: string;
  status: string;
  resolutionDate?: string;
  updatedAt?: string;
};

export type WeeklyTargetSelection<T extends WeeklyTargetTicket> = {
  targets: T[];
  recentlyCompletedCount: number;
  skippedHidden: number;
  excludedCompletedKeys: string[];
};

function completedWithinTrackingWindow(
  ticket: WeeklyTargetTicket,
  now: Date,
  trackingDays: number,
): boolean {
  const trackingStartedAt = ticket.resolutionDate ?? ticket.updatedAt;
  if (!trackingStartedAt) return false;
  const completedAt = new Date(trackingStartedAt).getTime();
  if (!Number.isFinite(completedAt)) return false;
  const ageMs = now.getTime() - completedAt;
  return ageMs >= 0 && ageMs <= trackingDays * 24 * 60 * 60 * 1000;
}

/**
 * 모든 미완료 과제와 최근 완료 과제를 Weekly Sync 대상으로 선정한다.
 * resolutionDate가 없는 완료 상태는 Jira updated를 보수적 fallback으로 사용한다.
 * 두 시각 모두 없거나 추적기간을 지난 완료 과제는 재동기화하지 않는다.
 */
export function selectWeeklySyncTargets<T extends WeeklyTargetTicket>(
  tickets: T[],
  hiddenKeys: Set<string>,
  now: Date = new Date(),
  trackingDays = COMPLETED_WEEKLY_TRACKING_DAYS,
): WeeklyTargetSelection<T> {
  const targets: T[] = [];
  const excludedCompletedKeys: string[] = [];
  let recentlyCompletedCount = 0;
  let skippedHidden = 0;

  for (const ticket of tickets) {
    const isDone = DONE_FOR_WEEKLY.has(ticket.status);
    const isRecentlyCompleted = isDone && completedWithinTrackingWindow(ticket, now, trackingDays);
    const eligible = !isDone || isRecentlyCompleted;

    if (!eligible) {
      excludedCompletedKeys.push(ticket.key);
      continue;
    }
    if (hiddenKeys.has(ticket.key)) {
      skippedHidden++;
      continue;
    }
    targets.push(ticket);
    if (isRecentlyCompleted) recentlyCompletedCount++;
  }

  return { targets, recentlyCompletedCount, skippedHidden, excludedCompletedKeys };
}
