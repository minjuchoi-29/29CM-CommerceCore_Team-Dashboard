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

export const dynamic = "force-dynamic";

const JIRA_HOST = "https://musinsa-oneteam.atlassian.net";
const LINKED_TICKET_REGISTRY_KEY = "cc-linked-ticket-registry";
const LINKED_TICKET_REGISTRY_LOCK_KEY = "lock:cc-linked-ticket-registry";

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

  // ── KV 로드: cc-filter-tickets + cc-jira-filters + cc-custom-keys ──
  let filterTickets: FilterTicketsStore = {};
  let filtersStore: JiraFiltersStore = {};
  let customKeysRaw: string[] = [];
  let linkedTicketRegistry: LinkedTicketRegistry = {};
  try {
    const [ft, fs, ck, lr] = await Promise.all([
      redis.get<FilterTicketsStore>("cc-filter-tickets"),
      redis.get<JiraFiltersStore>("cc-jira-filters"),
      redis.get<unknown>("cc-custom-keys"),
      redis.get<LinkedTicketRegistry>(LINKED_TICKET_REGISTRY_KEY),
    ]);
    filterTickets = ft ?? {};
    filtersStore = fs ?? {};
    // cc-custom-keys는 배열 또는 JSON 문자열로 저장될 수 있음
    if (Array.isArray(ck)) customKeysRaw = ck as string[];
    else if (typeof ck === "string") { try { customKeysRaw = JSON.parse(ck); } catch {} }
    linkedTicketRegistry = lr ?? {};
  } catch (e) {
    console.error("[jira-tickets GET] KV 로드 실패, TICKET_KEYS만 사용:", e);
  }

  // manualKeys = TICKET_KEYS(seed) + cc-custom-keys(KV 수동 추가), key 기준 dedupe
  // 정렬: TICKET_KEYS 순서 우선 → cc-custom-keys 추가분 후미
  const manualKeySet = new Set<string>(TICKET_KEYS);
  const additionalKeys = customKeysRaw.filter(k => !manualKeySet.has(k));
  const manualKeys = [...TICKET_KEYS, ...additionalKeys];
  // manualKeySet 업데이트 (cc-custom-keys 포함)
  for (const k of additionalKeys) manualKeySet.add(k);

  // 수동 + 필터 + ETR 연결로 자동 발견한 키 병합. 연결 키는 수동 티켓으로 표시하지 않는다.
  const managedSeedKeys = [...manualKeys, ...Object.keys(linkedTicketRegistry)];
  const { allKeys } = mergeTicketKeyLists(managedSeedKeys, filterTickets);
  // 어떤 티켓이 어떤 필터에 속하는지 맵 빌드
  const sourceFiltersMap = buildSourceFiltersMap(filterTickets, filtersStore);

  // keys 쿼리가 있으면 현재 회의 운영에 필요한 티켓만 부분 갱신한다.
  // 허용 목록 밖의 키는 Jira 조회에 전달하지 않는다.
  const requestedParam = request.nextUrl.searchParams.get("keys");
  const allowedKeys = new Set(allKeys);
  const requestedKeys = requestedParam === null
    ? allKeys
    : [...new Set(requestedParam.split(",").map(key => key.trim().toUpperCase()).filter(key => allowedKeys.has(key)))];

  // JIRA key in (...) 제한 회피를 위해 50개씩 청크로 나눠 병렬 조회
  const CHUNK_SIZE = 50;
  const chunks = chunkArray(requestedKeys, CHUNK_SIZE);

  let tickets: Ticket[] = [];
  try {
    const chunkResults = await Promise.all(
      chunks.map(chunk => fetchChunk(chunk, headers, FIELDS))
    );
    tickets = chunkResults.flat();
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: `요청 실패: ${message}` }, { status: 504 });
  }

  // Jira 이슈 링크 중 ETR↔실행 티켓 관계만 한 단계 확장한다.
  // 일반 티켓끼리의 관계는 대시보드 관리 범위를 넓히지 않는다.
  const linkedDiscovery = discoverEtrLinkedTicketKeys(tickets, new Set(allKeys));
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
      linkedTicketRegistry = await withRedisLock(redis, LINKED_TICKET_REGISTRY_LOCK_KEY, async () => {
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

  // sourceFilters 부착 (필터에 속한 티켓만 — 수동 전용은 undefined 유지)
  for (const t of tickets) {
    const sf = sourceFiltersMap[t.key];
    const linkedLabel = linkedTicketSourceLabel(linkedTicketRegistry[t.key]);
    const sourceLabels = [...(sf ?? []), ...(linkedLabel ? [linkedLabel] : [])];
    if (sourceLabels.length > 0) (t as Ticket).sourceFilters = [...new Set(sourceLabels)];
    if (manualKeySet.has(t.key)) (t as Ticket).isManual = true;
  }

  const participationMap = buildTicketParticipationMap(
    tickets.map(ticket => ({
      key: ticket.key,
      assigneeAccountId: ticket.assigneeAccountId,
      reporterAccountId: ticket.requestMeta?.reporterAccountId,
      isManual: ticket.isManual,
    })),
    filterTickets,
    filtersStore,
  );
  for (const ticket of tickets) {
    const roles = participationMap[ticket.key];
    if (roles?.length) ticket.participationRoles = roles;
  }

  // ── 정렬: 전체/부분 조회 모두 요청된 관리 순서 유지 ──
  const byKey = Object.fromEntries(tickets.map((t) => [t.key, t]));
  const responseOrderKeys = [...new Set([...requestedKeys, ...linkedDiscovery.keys])];
  const sorted = responseOrderKeys.map((k) => {
    if (byKey[k]) return byKey[k];
    // JIRA에서 못 가져온 키: TICKET_OVERRIDES fallback
    const ov = TICKET_OVERRIDES[k];
    if (manualKeySet.has(k) && ov && "summary" in ov && ov.summary) {
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
      const sf = sourceFiltersMap[k];
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

  return NextResponse.json({
    tickets: deduped,
    fetchedAt: new Date().toISOString(),
    customKeys: additionalKeys,
    partial: requestedParam !== null,
    managedCount: new Set([...allKeys, ...linkedDiscovery.keys]).size,
    refreshedCount: deduped.length,
    linkedDiscoveredCount: linkedDiscovery.keys.length,
  });
}
