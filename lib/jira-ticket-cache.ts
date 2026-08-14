import type { Ticket } from "@/app/jira-tickets/TicketBoard";
import { redis } from "@/lib/redis";
import { withRedisLock } from "@/lib/redis-lock";

export const JIRA_TICKET_CACHE_KEY = "cc-jira-ticket-cache-v1";

const JIRA_TICKET_CACHE_LOCK_KEY = "lock:cc-jira-ticket-cache-v1";

export type JiraTicketVersion = {
  key: string;
  updatedAt?: string;
};

export type JiraTicketCache = {
  version: 1;
  updatedAt: string;
  tickets: Record<string, Ticket>;
};

export function emptyJiraTicketCache(): JiraTicketCache {
  return {
    version: 1,
    updatedAt: "",
    tickets: {},
  };
}

export function selectChangedJiraTicketKeys(
  requestedKeys: string[],
  cachedTickets: Record<string, Pick<Ticket, "key" | "updatedAt">>,
  versions: JiraTicketVersion[],
): { changedKeys: string[]; unavailableKeys: string[] } {
  const versionByKey = new Map(versions.map(version => [version.key, version]));
  const changedKeys: string[] = [];
  const unavailableKeys: string[] = [];

  for (const key of requestedKeys) {
    const version = versionByKey.get(key);
    if (!version) {
      unavailableKeys.push(key);
      continue;
    }

    const cached = cachedTickets[key];
    if (!cached || !cached.updatedAt || !version.updatedAt || cached.updatedAt !== version.updatedAt) {
      changedKeys.push(key);
    }
  }

  return { changedKeys, unavailableKeys };
}

/** 브라우저가 가진 값보다 공용 캐시의 Jira 수정시각이 실제로 최신인지 확인한다. */
export function isCachedTicketNewer(
  cachedUpdatedAt: string | undefined,
  browserUpdatedAt: string | undefined,
): boolean {
  if (!cachedUpdatedAt) return false;
  if (!browserUpdatedAt) return true;
  const cachedMs = new Date(cachedUpdatedAt).getTime();
  const browserMs = new Date(browserUpdatedAt).getTime();
  if (!Number.isFinite(cachedMs) || !Number.isFinite(browserMs)) return false;
  return cachedMs > browserMs;
}

export function mergeJiraTicketCache(
  current: JiraTicketCache,
  refreshedTickets: Ticket[],
  managedKeys: string[],
  updatedAt = new Date().toISOString(),
): JiraTicketCache {
  const managedKeySet = new Set(managedKeys);
  const tickets: Record<string, Ticket> = {};

  for (const [key, ticket] of Object.entries(current.tickets)) {
    if (managedKeySet.has(key)) tickets[key] = ticket;
  }
  for (const ticket of refreshedTickets) {
    if (managedKeySet.has(ticket.key)) tickets[ticket.key] = ticket;
  }

  return {
    version: 1,
    updatedAt,
    tickets,
  };
}

export async function readJiraTicketCache(): Promise<JiraTicketCache> {
  const stored = await redis.get<JiraTicketCache>(JIRA_TICKET_CACHE_KEY);
  if (!stored || stored.version !== 1 || !stored.tickets || typeof stored.tickets !== "object") {
    return emptyJiraTicketCache();
  }
  return stored;
}

export async function mergeAndSaveJiraTicketCache(
  refreshedTickets: Ticket[],
  managedKeys: string[],
  updatedAt = new Date().toISOString(),
): Promise<JiraTicketCache> {
  return withRedisLock(redis, JIRA_TICKET_CACHE_LOCK_KEY, async () => {
    const current = await readJiraTicketCache();
    const next = mergeJiraTicketCache(current, refreshedTickets, managedKeys, updatedAt);
    await redis.set(JIRA_TICKET_CACHE_KEY, next);
    return next;
  }, {
    ttlMs: 10_000,
    waitTimeoutMs: 10_000,
    retryMs: 75,
  });
}
