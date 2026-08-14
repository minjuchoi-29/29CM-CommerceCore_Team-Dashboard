import {
  isPlanningRefreshTicket,
  selectWeeklySyncTargets,
  type WeeklyTargetTicket,
} from "./weekly-targets";

export type TicketRefreshPlan = {
  keys: string[];
  activeOrRecentCount: number;
  missingManagedCount: number;
};

export type WeeklyRefreshSelection<T> = {
  targets: T[];
  skippedUnchanged: number;
};

export function buildCurrentWeeklyAttemptedKeys(
  metaByKey: Record<string, {
    ticketKey: string;
    lastSkipReason?: "no_marker" | "src_error" | "sync_error";
    appliedSourceIds?: string[];
  }>,
  parserVersion: string,
): Set<string> {
  const prefix = `${parserVersion}:`;
  return new Set(Object.values(metaByKey)
    .filter(meta => meta.lastSkipReason === "no_marker"
      || meta.appliedSourceIds?.some(sourceId => sourceId.startsWith(prefix)))
    .map(meta => meta.ticketKey));
}

/**
 * Jira metadata refresh 결과에서 실제로 변경된 Weekly 대상만 고른다.
 * updatedAt을 비교할 수 없거나 이전 sync 기록이 없는 티켓은 안전하게 포함한다.
 */
export function selectChangedWeeklyTargets<
  T extends { key: string; updatedAt?: string },
>(
  targets: T[],
  previousTickets: Array<{ key: string; updatedAt?: string }>,
  refreshedTickets: Array<{ key: string; updatedAt?: string }>,
  previouslyAttemptedKeys: Set<string>,
): WeeklyRefreshSelection<T> {
  const previousByKey = new Map(previousTickets.map(ticket => [ticket.key, ticket]));
  const refreshedByKey = new Map(refreshedTickets.map(ticket => [ticket.key, ticket]));
  const changed: T[] = [];
  let skippedUnchanged = 0;

  for (const target of targets) {
    const previous = previousByKey.get(target.key);
    const refreshed = refreshedByKey.get(target.key);
    const neverAttempted = !previouslyAttemptedKeys.has(target.key);
    const cannotCompare = !previous?.updatedAt || !refreshed?.updatedAt;
    const updated = previous?.updatedAt !== refreshed?.updatedAt;

    if (neverAttempted || !previous || cannotCompare || updated) {
      changed.push(target);
    } else {
      skippedUnchanged++;
    }
  }

  return { targets: changed, skippedUnchanged };
}

/**
 * Jira Sync에서 오래된 완료 티켓 전체를 다시 읽지 않도록 조회 대상을 줄인다.
 * 실행 단계/최근 완료 티켓은 기존 Weekly 추적 정책과 동일하게 선택하고,
 * 다른 브라우저에서 새로 등록된 공용 티켓은 현재 목록에 없어도 포함한다.
 */
export function buildTicketRefreshPlan<T extends WeeklyTargetTicket>(
  tickets: T[],
  managedKeys: string[],
  hiddenKeys: Set<string>,
  now: Date = new Date(),
): TicketRefreshPlan {
  const activeOrRecent = selectWeeklySyncTargets(tickets, hiddenKeys, now).targets;
  const knownKeys = new Set(tickets.map(ticket => ticket.key));
  const keys: string[] = [];
  const seen = new Set<string>();

  for (const ticket of activeOrRecent) {
    if (seen.has(ticket.key)) continue;
    seen.add(ticket.key);
    keys.push(ticket.key);
  }

  let missingManagedCount = 0;
  for (const key of managedKeys) {
    if (hiddenKeys.has(key) || knownKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    missingManagedCount++;
  }

  return {
    keys,
    activeOrRecentCount: activeOrRecent.length,
    missingManagedCount,
  };
}

/** 플래닝 화면에서만 별도로 갱신할 Jira 티켓을 선정한다. */
export function buildPlanningRefreshKeys<T extends WeeklyTargetTicket>(
  tickets: T[],
  hiddenKeys: Set<string>,
): string[] {
  return tickets
    .filter(ticket => !hiddenKeys.has(ticket.key) && isPlanningRefreshTicket(ticket))
    .map(ticket => ticket.key);
}

/** 현재 목록 순서를 유지하면서 조회된 티켓만 교체하고 신규 티켓은 뒤에 붙인다. */
export function mergeRefreshedTickets<T extends { key: string }>(
  current: T[],
  refreshed: T[],
): T[] {
  const refreshedByKey = new Map(refreshed.map(ticket => [ticket.key, ticket]));
  const currentKeys = new Set(current.map(ticket => ticket.key));
  const merged = current.map(ticket => refreshedByKey.get(ticket.key) ?? ticket);

  for (const ticket of refreshed) {
    if (currentKeys.has(ticket.key)) continue;
    currentKeys.add(ticket.key);
    merged.push(ticket);
  }
  return merged;
}

/**
 * 브라우저 캐시에 남은 티켓 중 현재 서버 관리 범위에 없는 항목을 제거한다.
 * 일정·메모 등의 공용 저장 데이터는 건드리지 않고 화면용 Jira 메타 캐시만 정리한다.
 */
export function retainManagedTickets<T extends { key: string }>(
  tickets: T[],
  managedKeys: string[],
): T[] {
  const managedKeySet = new Set(managedKeys);
  return tickets.filter(ticket => managedKeySet.has(ticket.key));
}

export function findMissingManagedTicketKeys<T extends { key: string }>(
  tickets: T[],
  managedKeys: string[],
  hiddenKeys: Set<string>,
): string[] {
  const knownKeys = new Set(tickets.map(ticket => ticket.key));
  return managedKeys.filter(key => !knownKeys.has(key) && !hiddenKeys.has(key));
}
