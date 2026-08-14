import { NextRequest, NextResponse } from "next/server";
import { TICKET_KEYS, TICKET_OVERRIDES } from "@/app/jira-tickets/tickets-data";
import type { Ticket } from "@/app/jira-tickets/TicketBoard";
import { redis } from "@/lib/redis";
import { mergeTicketKeyLists, buildSourceFiltersMap } from "@/lib/ticket-sources";
import type { FilterTicketsStore, JiraFiltersStore } from "@/lib/filter-types";
import { JIRA_BATCH_FIELDS_STR } from "@/lib/jira-fields";
import {
  discoverEtrLinkedTicketKeys,
  linkedTicketSourceLabel,
  mergeLinkedTicketRegistry,
  type LinkedTicketRegistry,
} from "@/lib/linked-ticket-discovery";
import { withRedisLock } from "@/lib/redis-lock";
import { buildTicketParticipationMap } from "@/lib/ticket-review";
import {
  mergeAndSaveJiraTicketCache,
  readJiraTicketCache,
  selectChangedJiraTicketKeys,
  type JiraTicketVersion,
} from "@/lib/jira-ticket-cache";

export const dynamic = "force-dynamic";

const JIRA_HOST = "https://musinsa-oneteam.atlassian.net";
const LINKED_TICKET_REGISTRY_KEY = "cc-linked-ticket-registry";
const LINKED_TICKET_REGISTRY_LOCK_KEY = "lock:cc-linked-ticket-registry";
const SHARED_CACHE_MAX_AGE_MS = 36 * 60 * 60 * 1_000;

/** Phase 4: Jira issuelinks 배열에서 우리가 필요한 정보만 추출 */
type JiraLinkParsed = {
  key: string;
  linkType: string;       // "Blocks", "Relates", "Causes" 등
  direction: "in" | "out";
  summary?: string;
  status?: string;
  type?: string;
};

type JiraLinkedIssue = {
  key: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
    issuetype?: { name?: string };
  };
};

type JiraIssueLink = {
  type?: { name?: string };
  outwardIssue?: JiraLinkedIssue;
  inwardIssue?: JiraLinkedIssue;
};

type JiraSearchIssue = {
  key: string;
  fields: {
    summary: string;
    status: { name: string; statusCategory?: { key?: string } };
    assignee?: { displayName?: string; accountId?: string } | null;
    reporter?: { displayName?: string; accountId?: string } | null;
    duedate?: string | null;
    updated?: string;
    resolutiondate?: string | null;
    issuetype: { name: string };
    project: { key: string };
    customfield_10015?: string;
    customfield_10036?: number;
    customfield_10070?: unknown;
    customfield_10071?: { value?: string };
    customfield_14402?: { value?: string };
    customfield_10067?: unknown;
    priority?: { name?: string };
    parent?: { key?: string };
    issuelinks?: unknown;
  };
};

type JiraSearchResponse = {
  issues: JiraSearchIssue[];
  isLast?: boolean;
  total?: number;
};

type ManagedTicketContext = {
  filterTickets: FilterTicketsStore;
  filtersStore: JiraFiltersStore;
  additionalKeys: string[];
  manualKeys: string[];
  manualKeySet: Set<string>;
  allKeys: string[];
  sourceFiltersMap: Record<string, string[]>;
  linkedTicketRegistry: LinkedTicketRegistry;
};

function parseIssuelinks(raw: unknown): JiraLinkParsed[] {
  if (!Array.isArray(raw)) return [];
  const result: JiraLinkParsed[] = [];
  for (const link of raw as JiraIssueLink[]) {
    const t = link?.type?.name ?? "Relates";
    if (link?.outwardIssue) {
      const i = link.outwardIssue;
      result.push({
        key: i.key,
        linkType: t,
        direction: "out",
        summary: i.fields?.summary ?? undefined,
        status: i.fields?.status?.name ?? undefined,
        type: i.fields?.issuetype?.name ?? undefined,
      });
    }
    if (link?.inwardIssue) {
      const i = link.inwardIssue;
      result.push({
        key: i.key,
        linkType: t,
        direction: "in",
        summary: i.fields?.summary ?? undefined,
        status: i.fields?.status?.name ?? undefined,
        type: i.fields?.issuetype?.name ?? undefined,
      });
    }
  }
  return result;
}

/** customfield URL 값 추출 — 문자열이면 그대로, 객체면 url/href 키 사용 */
function extractUrl(val: unknown): string | undefined {
  if (!val) return undefined;
  if (typeof val === "string") return val || undefined;
  if (typeof val === "object") {
    const v = val as Record<string, unknown>;
    const url = (v.url ?? v.href ?? v.link) as string | undefined;
    return url || undefined;
  }
  return undefined;
}

/** customfield_10067 (요청부문 multiselect) 값 배열을 문자열로 변환 */
function extractMultiSelect(val: unknown): string | undefined {
  if (!Array.isArray(val) || val.length === 0) return undefined;
  const values = (val as Array<Record<string, unknown>>).map(v => v.value).filter(Boolean);
  return values.length > 0 ? values.join(", ") : undefined;
}
const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 배열을 n개씩 청크로 나눔 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

/** 하나의 JQL chunk로 JIRA에서 티켓 목록 조회 */
async function fetchChunk(
  chunkKeys: string[],
  headers: Record<string, string>,
  FIELDS: string
): Promise<Ticket[]> {
  const jql = `key in (${chunkKeys.join(",")})`;
  const results: Ticket[] = [];
  let startAt = 0;

  while (true) {
    const url =
      `${JIRA_HOST}/rest/api/3/search/jql?` +
      new URLSearchParams({
        jql,
        startAt: String(startAt),
        maxResults: "50",
        fields: FIELDS,
      });

    const res = await fetchWithTimeout(url, { headers, cache: "no-store" });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Jira API ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json() as JiraSearchResponse;

    for (const issue of data.issues) {
      const override = TICKET_OVERRIDES[issue.key] ?? {};
      const f = issue.fields;
      results.push({
        key: issue.key,
        summary: f.summary,
        status: f.status.name,
        statusCategory: f.status.statusCategory?.key,
        assignee: (f.assignee?.displayName ?? "-").split("/")[0].trim() || "-",
        assigneeAccountId: f.assignee?.accountId ?? undefined,
        requestMeta: {
          reporter: (f.reporter?.displayName ?? "").split("/")[0].trim() || undefined,
          reporterAccountId: f.reporter?.accountId ?? undefined,
        },
        eta: f.duedate ?? "-",
        updatedAt: f.updated ?? undefined,
        resolutionDate: f.resolutiondate ?? undefined, // β-1: Done ticket 완료일 (Jira auto)
        type: f.issuetype.name,
        project: f.project.key,
        startDate: f.customfield_10015 ?? undefined,
        storyPoints: f.customfield_10036 ?? undefined,
        twoPagerUrl: extractUrl(f.customfield_10070),
        healthCheck: f.customfield_10071?.value ?? undefined,
        requestDept: f.customfield_14402?.value ?? undefined,
        bodyRequestDept: extractMultiSelect(f.customfield_10067),
        requestPriority: f.priority?.name ?? undefined,
        parent: f.parent?.key ?? undefined,
        jiraLinks: parseIssuelinks(f.issuelinks),
        ...override,
      });
    }

    const fetched = data.issues.length;
    if (data.isLast || fetched === 0 || startAt + fetched >= (data.total ?? 0)) break;
    startAt += fetched;
  }

  return results;
}

async function fetchVersionChunk(
  chunkKeys: string[],
  headers: Record<string, string>,
): Promise<JiraTicketVersion[]> {
  if (chunkKeys.length === 0) return [];
  const url =
    `${JIRA_HOST}/rest/api/3/search/jql?` +
    new URLSearchParams({
      jql: `key in (${chunkKeys.join(",")})`,
      maxResults: "100",
      fields: "updated",
    });
  const res = await fetchWithTimeout(url, { headers, cache: "no-store" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira version API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json() as {
    issues?: Array<{ key: string; fields?: { updated?: string } }>;
  };
  return (data.issues ?? []).map(issue => ({
    key: issue.key,
    updatedAt: issue.fields?.updated,
  }));
}

async function fetchTicketVersions(
  keys: string[],
  headers: Record<string, string>,
): Promise<JiraTicketVersion[]> {
  const chunks = chunkArray(keys, 100);
  const results = await Promise.all(chunks.map(chunk => fetchVersionChunk(chunk, headers)));
  return results.flat();
}

async function loadManagedTicketContext(): Promise<ManagedTicketContext> {
  let filterTickets: FilterTicketsStore = {};
  let filtersStore: JiraFiltersStore = {};
  let customKeysRaw: string[] = [];
  let linkedTicketRegistry: LinkedTicketRegistry = {};

  const [ft, fs, ck, lr] = await Promise.all([
    redis.get<FilterTicketsStore>("cc-filter-tickets"),
    redis.get<JiraFiltersStore>("cc-jira-filters"),
    redis.get<unknown>("cc-custom-keys"),
    redis.get<LinkedTicketRegistry>(LINKED_TICKET_REGISTRY_KEY),
  ]);
  filterTickets = ft ?? {};
  filtersStore = fs ?? {};
  if (Array.isArray(ck)) customKeysRaw = ck as string[];
  else if (typeof ck === "string") {
    try { customKeysRaw = JSON.parse(ck); } catch {}
  }
  linkedTicketRegistry = lr ?? {};

  const manualKeySet = new Set<string>(TICKET_KEYS);
  const additionalKeys = customKeysRaw.filter(key => !manualKeySet.has(key));
  const manualKeys = [...TICKET_KEYS, ...additionalKeys];
  for (const key of additionalKeys) manualKeySet.add(key);

  const managedSeedKeys = [...manualKeys, ...Object.keys(linkedTicketRegistry)];
  const { allKeys } = mergeTicketKeyLists(managedSeedKeys, filterTickets, filtersStore);

  return {
    filterTickets,
    filtersStore,
    additionalKeys,
    manualKeys,
    manualKeySet,
    allKeys,
    sourceFiltersMap: buildSourceFiltersMap(filterTickets, filtersStore),
    linkedTicketRegistry,
  };
}

function decorateTickets(
  tickets: Ticket[],
  context: Pick<ManagedTicketContext,
    "sourceFiltersMap" | "linkedTicketRegistry" | "manualKeySet" | "filterTickets" | "filtersStore"
  >,
): void {
  for (const ticket of tickets) {
    const sourceFilters = context.sourceFiltersMap[ticket.key];
    const linkedLabel = linkedTicketSourceLabel(context.linkedTicketRegistry[ticket.key]);
    const sourceLabels = [...(sourceFilters ?? []), ...(linkedLabel ? [linkedLabel] : [])];
    ticket.sourceFilters = sourceLabels.length > 0 ? [...new Set(sourceLabels)] : undefined;
    ticket.isManual = context.manualKeySet.has(ticket.key) || undefined;
    ticket.participationRoles = undefined;
  }

  const participationMap = buildTicketParticipationMap(
    tickets.map(ticket => ({
      key: ticket.key,
      assigneeAccountId: ticket.assigneeAccountId,
      reporterAccountId: ticket.requestMeta?.reporterAccountId,
      isManual: ticket.isManual,
    })),
    context.filterTickets,
    context.filtersStore,
  );
  for (const ticket of tickets) {
    const roles = participationMap[ticket.key];
    if (roles?.length) ticket.participationRoles = roles;
  }
}

export async function GET(request: NextRequest) {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) {
    return NextResponse.json(
      { error: "JIRA_EMAIL 또는 JIRA_API_TOKEN 환경변수가 없습니다." },
      { status: 500 }
    );
  }

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };

  // β-1: Jira FIELDS 공통 상수 (lib/jira-fields.ts) 사용 — 4 routes 간 drift 방지
  const FIELDS = JIRA_BATCH_FIELDS_STR;

  // ── KV 로드: 활성 데이터 소스 + 수동/연결 티켓 ──
  let context: ManagedTicketContext;
  try {
    context = await loadManagedTicketContext();
  } catch (e) {
    console.error("[jira-tickets GET] KV 로드 실패, TICKET_KEYS만 사용:", e);
    const manualKeySet = new Set(TICKET_KEYS);
    context = {
      filterTickets: {},
      filtersStore: {},
      additionalKeys: [],
      manualKeys: [...TICKET_KEYS],
      manualKeySet,
      allKeys: [...TICKET_KEYS],
      sourceFiltersMap: {},
      linkedTicketRegistry: {},
    };
  }

  // keys 쿼리가 있으면 현재 회의 운영에 필요한 티켓만 부분 갱신한다.
  // 허용 목록 밖의 키는 Jira 조회에 전달하지 않는다.
  const requestedParam = request.nextUrl.searchParams.get("keys");
  const allowedKeys = new Set(context.allKeys);
  const requestedKeys = requestedParam === null
    ? context.allKeys
    : [...new Set(requestedParam.split(",").map(key => key.trim().toUpperCase()).filter(key => allowedKeys.has(key)))];

  // 첫 화면은 공용 자동 캐시를 즉시 사용하고, 누락 키만 Jira에서 조회한다.
  // 명시적인 keys 요청(Jira Sync/개별 갱신)은 항상 Jira 원본을 확인한다.
  const storedSharedCache = requestedParam === null ? await readJiraTicketCache() : null;
  const sharedCacheAgeMs = storedSharedCache?.updatedAt
    ? Date.now() - new Date(storedSharedCache.updatedAt).getTime()
    : Number.POSITIVE_INFINITY;
  const sharedCache = storedSharedCache
    && Number.isFinite(sharedCacheAgeMs)
    && sharedCacheAgeMs >= 0
    && sharedCacheAgeMs <= SHARED_CACHE_MAX_AGE_MS
    ? storedSharedCache
    : null;
  const cachedTickets = sharedCache
    ? requestedKeys.map(key => sharedCache.tickets[key]).filter((ticket): ticket is Ticket => Boolean(ticket))
    : [];
  const cachedKeySet = new Set(cachedTickets.map(ticket => ticket.key));
  const keysToFetch = requestedParam === null
    ? requestedKeys.filter(key => !cachedKeySet.has(key))
    : requestedKeys;

  // JIRA key in (...) 제한 회피를 위해 50개씩 청크로 나눠 병렬 조회
  const CHUNK_SIZE = 50;
  const chunks = chunkArray(keysToFetch, CHUNK_SIZE);

  let tickets: Ticket[] = [...cachedTickets];
  try {
    const chunkResults = await Promise.all(
      chunks.map(chunk => fetchChunk(chunk, headers, FIELDS))
    );
    tickets = [...tickets, ...chunkResults.flat()];
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: `요청 실패: ${message}` }, { status: 504 });
  }

  // Jira 이슈 링크 중 ETR↔실행 티켓 관계만 한 단계 확장한다.
  // 일반 티켓끼리의 관계는 대시보드 관리 범위를 넓히지 않는다.
  const linkedDiscovery = discoverEtrLinkedTicketKeys(tickets, new Set(context.allKeys));
  if (linkedDiscovery.keys.length > 0) {
    try {
      const linkedChunks = chunkArray(linkedDiscovery.keys, CHUNK_SIZE);
      const linkedResults = await Promise.all(
        linkedChunks.map(chunk => fetchChunk(chunk, headers, FIELDS)),
      );
      tickets = [...tickets, ...linkedResults.flat()];
    } catch (error) {
      // 원래 요청 티켓은 계속 반환하고, 다음 sync에서 registry 기반으로 재시도한다.
      console.warn("[jira-tickets GET] ETR 연결 티켓 확장 조회 실패:", error);
    }
  }

  if (Object.keys(linkedDiscovery.linkedFromByKey).length > 0) {
    try {
      context.linkedTicketRegistry = await withRedisLock(redis, LINKED_TICKET_REGISTRY_LOCK_KEY, async () => {
        const current = (await redis.get<LinkedTicketRegistry>(LINKED_TICKET_REGISTRY_KEY)) ?? {};
        const merged = mergeLinkedTicketRegistry(
          current,
          linkedDiscovery.linkedFromByKey,
          new Date().toISOString(),
        );
        await redis.set(LINKED_TICKET_REGISTRY_KEY, merged);
        return merged;
      });
    } catch (error) {
      console.warn("[jira-tickets GET] ETR 연결 registry 저장 실패:", error);
    }
  }

  decorateTickets(tickets, context);

  // ── 정렬: 전체/부분 조회 모두 요청된 관리 순서 유지 ──
  const byKey = Object.fromEntries(tickets.map((t) => [t.key, t]));
  const responseOrderKeys = [...new Set([...requestedKeys, ...linkedDiscovery.keys])];
  const sorted = responseOrderKeys.map((k) => {
    if (byKey[k]) return byKey[k];
    // JIRA에서 못 가져온 키: TICKET_OVERRIDES fallback
    const ov = TICKET_OVERRIDES[k];
    if (context.manualKeySet.has(k) && ov && "summary" in ov && ov.summary) {
      const fallback: Ticket = {
        key: k,
        assignee: "-",
        eta: "-",
        type: "-",
        project: k.split("-")[0],
        summary: "",
        status: "-",
        isManual: true,
        participationRoles: ["manual"],
        ...ov,
      };
      const sf = context.sourceFiltersMap[k];
      if (sf && sf.length > 0) fallback.sourceFilters = sf;
      return fallback;
    }
    return null;
  }).filter((t): t is Ticket => t != null);

  // 중복 방어 (race condition 등)
  const seen = new Set<string>();
  const deduped = sorted.filter(t => {
    if (seen.has(t.key)) return false;
    seen.add(t.key);
    return true;
  });

  const responseAt = new Date().toISOString();
  const managedKeys = [...new Set([...context.allKeys, ...linkedDiscovery.keys])];
  try {
    await mergeAndSaveJiraTicketCache(deduped, managedKeys, responseAt);
  } catch (error) {
    // 공용 캐시 실패가 Jira 원본 응답을 막지 않게 한다.
    console.warn("[jira-tickets GET] 공용 메타 캐시 저장 실패:", error);
  }

  return NextResponse.json({
    tickets: deduped,
    fetchedAt: requestedParam === null && keysToFetch.length === 0 && sharedCache?.updatedAt
      ? sharedCache.updatedAt
      : responseAt,
    customKeys: context.additionalKeys,
    partial: requestedParam !== null,
    managedCount: managedKeys.length,
    refreshedCount: deduped.length,
    cacheHitCount: cachedTickets.length,
    jiraFetchedCount: keysToFetch.length + linkedDiscovery.keys.length,
    linkedDiscoveredCount: linkedDiscovery.keys.length,
  });
}

/**
 * POST /api/jira-tickets
 *
 * Jira Sync 속도 최적화용 2단계 조회:
 * 1) key + updated만 가볍게 확인
 * 2) updated가 달라진 티켓만 기존 GET 경로로 상세 조회
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await request.json() as {
      tickets?: Array<{ key: string; updatedAt?: string }>;
    };
    const candidates = Array.isArray(body.tickets) ? body.tickets : [];
    if (candidates.length === 0) {
      return NextResponse.json({
        tickets: [],
        fetchedAt: new Date().toISOString(),
        partial: true,
        checkedCount: 0,
        changedCount: 0,
        unavailableCount: 0,
        durationMs: Date.now() - startedAt,
      });
    }
    if (candidates.length > 1_000) {
      return NextResponse.json({ error: "한 번에 확인할 수 있는 티켓은 최대 1,000개입니다." }, { status: 400 });
    }

    const email = process.env.JIRA_EMAIL;
    const token = process.env.JIRA_API_TOKEN;
    if (!email || !token) {
      return NextResponse.json(
        { error: "JIRA_EMAIL 또는 JIRA_API_TOKEN 환경변수가 없습니다." },
        { status: 500 },
      );
    }

    const context = await loadManagedTicketContext();
    const allowedKeys = new Set(context.allKeys);
    const normalized = [...new Map(candidates
      .map(ticket => ({ ...ticket, key: ticket.key.trim().toUpperCase() }))
      .filter(ticket => allowedKeys.has(ticket.key))
      .map(ticket => [ticket.key, ticket])).values()];
    const headers = {
      Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
      Accept: "application/json",
    };
    const versions = await fetchTicketVersions(normalized.map(ticket => ticket.key), headers);
    const cachedTickets = Object.fromEntries(normalized.map(ticket => [ticket.key, ticket]));
    const { changedKeys, unavailableKeys } = selectChangedJiraTicketKeys(
      normalized.map(ticket => ticket.key),
      cachedTickets,
      versions,
    );

    if (changedKeys.length === 0) {
      return NextResponse.json({
        tickets: [],
        fetchedAt: new Date().toISOString(),
        partial: true,
        checkedCount: normalized.length,
        changedCount: 0,
        unavailableCount: unavailableKeys.length,
        durationMs: Date.now() - startedAt,
      });
    }

    const detailUrl = new URL(request.url);
    detailUrl.search = new URLSearchParams({ keys: changedKeys.join(",") }).toString();
    const detailResponse = await GET(new NextRequest(detailUrl, {
      method: "GET",
      headers: request.headers,
    }));
    const detailBody = await detailResponse.json() as Record<string, unknown>;
    if (!detailResponse.ok) {
      return NextResponse.json(detailBody, { status: detailResponse.status });
    }

    console.log(
      `[jira-tickets incremental] checked=${normalized.length} changed=${changedKeys.length} ` +
      `unavailable=${unavailableKeys.length} durationMs=${Date.now() - startedAt}`,
    );
    return NextResponse.json({
      ...detailBody,
      checkedCount: normalized.length,
      changedCount: changedKeys.length,
      unavailableCount: unavailableKeys.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[jira-tickets incremental] 실패:", error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
