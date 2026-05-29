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

const JIRA_BASE = "https://musinsa-oneteam.atlassian.net";
const PAGE_SIZE = 100;
/** 한 필터당 페이지네이션 상한 (100 × 200 = 20,000 이슈) */
const MAX_PAGES = 200;

function jiraAuthHeader(): string {
  const email = process.env.JIRA_EMAIL ?? "";
  const token = process.env.JIRA_API_TOKEN ?? "";
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

/**
 * Jira Filter ID로 전체 이슈 키를 페이지네이션 조회.
 * 개별 필터용 — single-filter manual sync에서도 이 함수를 사용한다.
 */
export async function fetchFilterIssueKeys(jiraFilterId: string): Promise<string[]> {
  const keys: string[] = [];
  let startAt = 0;
  let total = Infinity;
  let page = 0;

  while (startAt < total && page < MAX_PAGES) {
    const url =
      `${JIRA_BASE}/rest/api/3/search/jql` +
      `?jql=${encodeURIComponent(`filter = ${jiraFilterId}`)}` +
      `&fields=key` +
      `&maxResults=${PAGE_SIZE}` +
      `&startAt=${startAt}`;

    const res = await fetch(url, {
      headers: { Authorization: jiraAuthHeader(), Accept: "application/json" },
    });

    if (!res.ok) {
      throw new Error(`Jira search 오류 (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as {
      issues: { key: string }[];
      total: number;
    };

    total = data.total;
    for (const issue of data.issues) keys.push(issue.key);
    startAt += data.issues.length;
    page++;

    if (data.issues.length === 0) break; // 빈 페이지 — 무한루프 방지
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
  /** TICKET_KEYS와 중복되는 티켓 수 (참고용) */
  overlapCount: number;
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
  const filterIds = Object.keys(filtersStore);

  if (filterIds.length === 0) {
    return {
      results: [],
      syncedFilters: 0,
      failedFilters: 0,
      skippedFilters: 1,
      totalNewTickets: 0,
    };
  }

  // KV 1회 read
  const filterTickets =
    (await redis.get<FilterTicketsStore>("cc-filter-tickets")) ?? {};
  const ticketSources =
    (await redis.get<TicketSourcesStore>("cc-ticket-sources")) ?? {};

  const now = new Date().toISOString();
  const results: SingleFilterSyncResult[] = [];
  let totalNewTickets = 0;

  for (const filterId of filterIds) {
    const filter: JiraFilter = filtersStore[filterId];
    const filterName = filter.label ?? filter.name;

    try {
      const ticketKeys = await fetchFilterIssueKeys(filter.jiraFilterId);

      // cc-filter-tickets: 해당 filterId 교체 (제거된 티켓 자동삭제 금지 — 키 목록만 최신화)
      filterTickets[filterId] = ticketKeys;

      // cc-ticket-sources: append-only, filterId 기준 중복 dedupe
      for (const key of ticketKeys) {
        const existing = ticketSources[key] ?? [];
        const alreadyLinked = existing.some((e) => e.filterId === filterId);
        if (!alreadyLinked) {
          const entry: TicketSourceEntry = {
            filterId,
            filterLabel: filterName,
            addedAt: now,
          };
          ticketSources[key] = [...existing, entry];
          totalNewTickets++;
        }
      }

      const overlapCount = ticketKeys.filter((k) => manualKeySet.has(k)).length;

      // 필터 레코드: prevSyncCount 보존 → 새 값 기록
      filtersStore[filterId] = {
        ...filter,
        prevSyncCount: filter.lastSyncCount,
        lastSyncAt: now,
        lastSyncCount: ticketKeys.length,
        lastSyncError: null,
      };

      results.push({
        filterId,
        filterName,
        ok: true,
        ticketCount: ticketKeys.length,
        overlapCount,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[filter-sync] filterId=${filterId} (${filterName}) 실패:`, errMsg);

      // 실패한 필터: 에러 기록, 기존 cc-filter-tickets 데이터 보존 (덮어쓰기 금지)
      filtersStore[filterId] = {
        ...filter,
        lastSyncAt: now,
        lastSyncError: errMsg,
      };

      results.push({
        filterId,
        filterName,
        ok: false,
        ticketCount: 0,
        overlapCount: 0,
        error: errMsg,
      });
    }
  }

  // KV 3개 일괄 write
  await Promise.all([
    redis.set("cc-filter-tickets", filterTickets),
    redis.set("cc-ticket-sources", ticketSources),
    redis.set("cc-jira-filters", filtersStore),
  ]);

  return {
    results,
    syncedFilters: results.filter((r) => r.ok).length,
    failedFilters: results.filter((r) => !r.ok).length,
    skippedFilters: 0,
    totalNewTickets,
  };
}
