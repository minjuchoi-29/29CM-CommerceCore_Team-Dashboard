/**
 * lib/filter-sync.ts
 *
 * Jira Filter 동기화 공통 로직 — manual sync endpoint + daily cron 양쪽에서 사용.
 *
 * 정책:
 *   - 필터에서 빠진 티켓 자동 삭제 금지 (cc-filter-tickets 키 교체만)
 *   - cc-ticket-sources는 append-only (한 번 추가된 소속 기록은 유지)
 *   - manual (TICKET_KEYS) 티켓 보호 — 이 함수는 KV만 갱신하며 TICKET_KEYS를 변경하지 않음
 *   - hidden ticket 상태 무변경 — cc-hidden-keys를 읽거나 쓰지 않음
 *   - 개별 필터 실패 → error 기록 + 나머지 계속
 */

import { redis } from "@/lib/redis";
import type {
  JiraFilter,
  JiraFiltersStore,
  FilterTicketsStore,
  TicketSourceEntry,
  TicketSourcesStore,
} from "@/lib/filter-types";
import {
  buildEffectiveFilterJql,
  inferJiraFilterKind,
  inferJiraFilterTargetArea,
  isJiraFilterEnabled,
} from "@/lib/filter-policy";
import { withRedisLock } from "@/lib/redis-lock";

const JIRA_BASE = "https://musinsa-oneteam.atlassian.net";
const PAGE_SIZE = 100;
/** 한 필터당 페이지네이션 상한 (100 × 200 = 20,000 이슈) */
const MAX_PAGES = 200;
const FILTER_SYNC_LOCK_KEY = "lock:cc-jira-filter-sync";
const FILTER_FETCH_CONCURRENCY = 4;
const FILTER_FETCH_TIMEOUT_MS = 15_000;

function jiraAuthHeader(): string {
  const email = process.env.JIRA_EMAIL ?? "";
  const token = process.env.JIRA_API_TOKEN ?? "";
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

/**
 * Jira Filter ID로 전체 이슈 키를 페이지네이션 조회.
 * 개별 필터용 — single-filter manual sync에서도 이 함수를 사용한다.
 */
export async function fetchFilterIssueKeys(
  jiraFilterId: string,
  jql = `filter = ${jiraFilterId}`,
): Promise<string[]> {
  const keys: string[] = [];
  let nextPageToken: string | undefined;
  let page = 0;

  while (page < MAX_PAGES) {
    const params = new URLSearchParams({
      jql,
      fields: "key",
      maxResults: String(PAGE_SIZE),
    });
    if (nextPageToken) params.set("nextPageToken", nextPageToken);
    const url = `${JIRA_BASE}/rest/api/3/search/jql?${params}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FILTER_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: jiraAuthHeader(), Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      throw new Error(`Jira search 오류 (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as {
      issues: { key: string }[];
      nextPageToken?: string;
      isLast?: boolean;
    };

    for (const issue of data.issues) keys.push(issue.key);
    page++;

    if (data.isLast || data.issues.length === 0 || !data.nextPageToken) break;
    if (data.nextPageToken === nextPageToken) {
      throw new Error("Jira search pagination token이 반복되어 동기화를 중단했습니다.");
    }
    nextPageToken = data.nextPageToken;
  }

  return keys;
}

// ── 단일 필터 sync 결과 ────────────────────────────────────────────────────────

export interface SingleFilterSyncResult {
  filterId: string;
  filterName: string;
  ok: boolean;
  /** sync된 총 티켓 수 (실패 시 0) */
  ticketCount: number;
  ticketKeys: string[];
  /** TICKET_KEYS와 중복되는 티켓 수 (참고용) */
  overlapCount: number;
  durationMs: number;
  error?: string;
}

// ── 전체 필터 batch sync ──────────────────────────────────────────────────────

export interface SyncAllResult {
  results: SingleFilterSyncResult[];
  syncedFilters: number;
  failedFilters: number;
  skippedFilters: number; // 등록된 필터 없음 등
  totalNewTickets: number; // 신규 source entry 추가 수
}

type FilterFetchOutcome = {
  filter: JiraFilter;
  attemptedAt: string;
  durationMs: number;
  ticketKeys?: string[];
  error?: string;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function fetchFilterOutcome(filter: JiraFilter): Promise<FilterFetchOutcome> {
  const startedAt = Date.now();
  const attemptedAt = new Date().toISOString();
  try {
    const ticketKeys = await fetchFilterIssueKeys(
      filter.jiraFilterId,
      buildEffectiveFilterJql(filter),
    );
    return { filter, attemptedAt, durationMs: Date.now() - startedAt, ticketKeys };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[filter-sync] filterId=${filter.id} (${filter.label ?? filter.name}) 실패:`, message);
    return { filter, attemptedAt, durationMs: Date.now() - startedAt, error: message };
  }
}

async function persistFilterOutcomes(
  outcomes: FilterFetchOutcome[],
  manualKeySet: Set<string>,
): Promise<{ results: SingleFilterSyncResult[]; totalNewTickets: number }> {
  return withRedisLock(redis, FILTER_SYNC_LOCK_KEY, async () => {
    const [filtersStore, filterTickets, ticketSources] = await Promise.all([
      redis.get<JiraFiltersStore>("cc-jira-filters"),
      redis.get<FilterTicketsStore>("cc-filter-tickets"),
      redis.get<TicketSourcesStore>("cc-ticket-sources"),
    ]);
    const liveFilters = filtersStore ?? {};
    const liveFilterTickets = filterTickets ?? {};
    const liveTicketSources = ticketSources ?? {};
    const results: SingleFilterSyncResult[] = [];
    let totalNewTickets = 0;

    for (const outcome of outcomes) {
      const filter = liveFilters[outcome.filter.id];
      if (!filter) continue; // 조회 중 삭제된 소스는 되살리지 않는다.
      const filterName = filter.label ?? filter.name;
      if (!outcome.ticketKeys) {
        liveFilters[filter.id] = {
          ...filter,
          lastAttemptAt: outcome.attemptedAt,
          lastSyncDurationMs: outcome.durationMs,
          lastSyncError: outcome.error ?? "알 수 없는 오류",
        };
        results.push({
          filterId: filter.id,
          filterName,
          ok: false,
          ticketCount: 0,
          ticketKeys: [],
          overlapCount: 0,
          durationMs: outcome.durationMs,
          error: outcome.error ?? "알 수 없는 오류",
        });
        continue;
      }

      liveFilterTickets[filter.id] = outcome.ticketKeys;
      for (const key of outcome.ticketKeys) {
        const existing = liveTicketSources[key] ?? [];
        if (existing.some(entry => entry.filterId === filter.id)) continue;
        const entry: TicketSourceEntry = {
          filterId: filter.id,
          filterLabel: filterName,
          addedAt: outcome.attemptedAt,
        };
        liveTicketSources[key] = [...existing, entry];
        totalNewTickets++;
      }

      const overlapCount = outcome.ticketKeys.filter(key => manualKeySet.has(key)).length;
      liveFilters[filter.id] = {
        ...filter,
        kind: inferJiraFilterKind(filter),
        targetArea: inferJiraFilterTargetArea(filter),
        enabled: filter.enabled !== false,
        prevSyncCount: filter.lastSyncCount,
        lastSyncAt: outcome.attemptedAt,
        lastSuccessAt: outcome.attemptedAt,
        lastAttemptAt: outcome.attemptedAt,
        lastSyncDurationMs: outcome.durationMs,
        lastSyncCount: outcome.ticketKeys.length,
        lastSyncError: null,
      };
      results.push({
        filterId: filter.id,
        filterName,
        ok: true,
        ticketCount: outcome.ticketKeys.length,
        ticketKeys: outcome.ticketKeys,
        overlapCount,
        durationMs: outcome.durationMs,
      });
    }

    await Promise.all([
      redis.set("cc-filter-tickets", liveFilterTickets),
      redis.set("cc-ticket-sources", liveTicketSources),
      redis.set("cc-jira-filters", liveFilters),
    ]);
    return { results, totalNewTickets };
  }, { ttlMs: 15_000, waitTimeoutMs: 15_000, retryMs: 75 });
}

export async function syncJiraFilter(
  filterId: string,
  manualKeySet: Set<string>,
): Promise<SingleFilterSyncResult | null> {
  const filtersStore = (await redis.get<JiraFiltersStore>("cc-jira-filters")) ?? {};
  const filter = filtersStore[filterId];
  if (!filter) return null;
  const persisted = await persistFilterOutcomes([await fetchFilterOutcome(filter)], manualKeySet);
  return persisted.results[0] ?? null;
}

/**
 * cc-jira-filters에 등록된 모든 Jira Filter를 순회하며 batch sync.
 *
 * - cc-filter-tickets, cc-ticket-sources, cc-jira-filters를 각 1회 read/write.
 * - 개별 필터 실패는 error 기록 후 계속 진행 (전체 cron 중단 없음).
 * - manualKeySet: TICKET_KEYS의 Set — overlapCount 계산에만 사용하며 수정하지 않음.
 */
export async function syncAllJiraFilters(
  manualKeySet: Set<string>
): Promise<SyncAllResult> {
  // 등록된 필터 없으면 즉시 반환
  const filtersStore =
    (await redis.get<JiraFiltersStore>("cc-jira-filters")) ?? {};
  const allFilters = Object.values(filtersStore);
  const filters = allFilters.filter(isJiraFilterEnabled);

  if (allFilters.length === 0) {
    return {
      results: [],
      syncedFilters: 0,
      failedFilters: 0,
      skippedFilters: 1,
      totalNewTickets: 0,
    };
  }

  if (filters.length === 0) {
    return {
      results: [],
      syncedFilters: 0,
      failedFilters: 0,
      skippedFilters: allFilters.length,
      totalNewTickets: 0,
    };
  }

  // Jira 조회는 서로 독립이므로 제한된 병렬 처리 후, KV는 lock 안에서 한 번만 저장한다.
  const outcomes = await mapWithConcurrency(filters, FILTER_FETCH_CONCURRENCY, fetchFilterOutcome);
  const { results, totalNewTickets } = await persistFilterOutcomes(outcomes, manualKeySet);

  return {
    results,
    syncedFilters: results.filter((r) => r.ok).length,
    failedFilters: results.filter((r) => !r.ok).length,
    skippedFilters: allFilters.length - filters.length,
    totalNewTickets,
  };
}
