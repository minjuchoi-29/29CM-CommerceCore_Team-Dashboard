import {
  selectWeeklySyncTargets,
  type WeeklyTargetTicket,
} from "./weekly-targets";

export type TicketRefreshPlan = {
  keys: string[];
  activeOrRecentCount: number;
  missingCustomCount: number;
};

/**
 * Jira Sync에서 오래된 완료 티켓 전체를 다시 읽지 않도록 조회 대상을 줄인다.
 * 미완료/최근 완료 티켓은 기존 Weekly 추적 정책과 동일하게 선택하고,
 * 다른 브라우저에서 새로 등록된 공용 티켓은 현재 목록에 없어도 포함한다.
 */
export function buildTicketRefreshPlan<T extends WeeklyTargetTicket>(
  tickets: T[],
  sharedCustomKeys: string[],
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

  let missingCustomCount = 0;
  for (const key of sharedCustomKeys) {
    if (hiddenKeys.has(key) || knownKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    missingCustomCount++;
  }

  return {
    keys,
    activeOrRecentCount: activeOrRecent.length,
    missingCustomCount,
  };
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

export function findMissingSharedTicketKeys<T extends { key: string }>(
  tickets: T[],
  sharedCustomKeys: string[],
  hiddenKeys: Set<string>,
): string[] {
  const knownKeys = new Set(tickets.map(ticket => ticket.key));
  return sharedCustomKeys.filter(key => !knownKeys.has(key) && !hiddenKeys.has(key));
}
