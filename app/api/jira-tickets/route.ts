import { NextResponse } from "next/server";
import { TICKET_KEYS, TICKET_OVERRIDES } from "@/app/jira-tickets/tickets-data";
import type { Ticket } from "@/app/jira-tickets/TicketBoard";
import { redis } from "@/lib/redis";
import { mergeTicketKeyLists, buildSourceFiltersMap } from "@/lib/ticket-sources";
import type { FilterTicketsStore, JiraFiltersStore } from "@/lib/filter-types";

export const dynamic = "force-dynamic";

const JIRA_HOST = "https://musinsa-oneteam.atlassian.net";

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

    const data = await res.json();

    for (const issue of data.issues as Array<Record<string, any>>) {
      const override = TICKET_OVERRIDES[issue.key] ?? {};
      const f = issue.fields;
      results.push({
        key: issue.key,
        summary: f.summary,
        status: f.status.name,
        assignee: (f.assignee?.displayName ?? "-").split("/")[0].trim() || "-",
        requestMeta: {
          reporter: (f.reporter?.displayName ?? "").split("/")[0].trim() || undefined,
        },
        eta: f.duedate ?? "-",
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
        ...override,
      });
    }

    const fetched = (data.issues as unknown[]).length;
    if (data.isLast || fetched === 0 || startAt + fetched >= (data.total ?? 0)) break;
    startAt += fetched;
  }

  return results;
}

export async function GET() {
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

  const FIELDS = [
    "summary", "status", "assignee", "reporter", "issuetype", "project", "duedate",
    "priority", "parent",
    "customfield_10015", // Start date
    "customfield_10036", // Story Points
    "customfield_10067", // 요청부문 (multiselect)
    "customfield_10070", // 2-Pager/PRD Link
    "customfield_10071", // Health Check
    "customfield_14402", // Main Subject
  ].join(",");

  // ── KV 로드: cc-filter-tickets + cc-jira-filters + cc-custom-keys ──
  let filterTickets: FilterTicketsStore = {};
  let filtersStore: JiraFiltersStore = {};
  let customKeysRaw: string[] = [];
  try {
    const [ft, fs, ck] = await Promise.all([
      redis.get<FilterTicketsStore>("cc-filter-tickets"),
      redis.get<JiraFiltersStore>("cc-jira-filters"),
      redis.get<unknown>("cc-custom-keys"),
    ]);
    filterTickets = ft ?? {};
    filtersStore = fs ?? {};
    // cc-custom-keys는 배열 또는 JSON 문자열로 저장될 수 있음
    if (Array.isArray(ck)) customKeysRaw = ck as string[];
    else if (typeof ck === "string") { try { customKeysRaw = JSON.parse(ck); } catch {} }
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

  // TICKET_KEYS + cc-custom-keys + 필터 전용 키 병합 (key 기준 dedupe)
  const { allKeys, filterOnlyKeys } = mergeTicketKeyLists(manualKeys, filterTickets);
  // 어떤 티켓이 어떤 필터에 속하는지 맵 빌드
  const sourceFiltersMap = buildSourceFiltersMap(filterTickets, filtersStore);

  // JIRA key in (...) 제한 회피를 위해 50개씩 청크로 나눠 병렬 조회
  const CHUNK_SIZE = 50;
  const chunks = chunkArray(allKeys, CHUNK_SIZE);

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

  // sourceFilters 부착 (필터에 속한 티켓만 — 수동 전용은 undefined 유지)
  for (const t of tickets) {
    const sf = sourceFiltersMap[t.key];
    if (sf && sf.length > 0) (t as Ticket).sourceFilters = sf;
    if (manualKeySet.has(t.key)) (t as Ticket).isManual = true;
  }

  // ── 정렬: TICKET_KEYS 순서 우선 → 필터 전용 키 후미 ──
  const byKey = Object.fromEntries(tickets.map((t) => [t.key, t]));

  // 1) 수동 등록 티켓 (TICKET_KEYS 순서 → cc-custom-keys 추가분 순서 유지)
  const manualSorted = manualKeys.map((k) => {
    if (byKey[k]) return byKey[k];
    // JIRA에서 못 가져온 키: TICKET_OVERRIDES fallback
    const ov = TICKET_OVERRIDES[k];
    if (ov && "summary" in ov && ov.summary) {
      const fallback: Ticket = { key: k, assignee: "-", eta: "-", type: "-", project: k.split("-")[0], summary: "", status: "-", isManual: true, ...ov };
      const sf = sourceFiltersMap[k];
      if (sf && sf.length > 0) fallback.sourceFilters = sf;
      return fallback;
    }
    return null;
  }).filter((t): t is Ticket => t != null);

  // 2) 필터 전용 티켓 (TICKET_KEYS에 없는 것)
  const filterOnlySorted = filterOnlyKeys
    .map((k) => byKey[k])
    .filter((t): t is Ticket => t != null);

  const sorted = [...manualSorted, ...filterOnlySorted];

  // 중복 방어 (race condition 등)
  const seen = new Set<string>();
  const deduped = sorted.filter(t => {
    if (seen.has(t.key)) return false;
    seen.add(t.key);
    return true;
  });

  return NextResponse.json({ tickets: deduped, fetchedAt: new Date().toISOString() });
}
