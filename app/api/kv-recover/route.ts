import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import type { Ticket } from "@/app/jira-tickets/TicketBoard";
import { TICKET_OVERRIDES, TICKET_KEYS } from "@/app/jira-tickets/tickets-data";
import { JIRA_BATCH_FIELDS_STR } from "@/lib/jira-fields";

export const dynamic = "force-dynamic";

const JIRA_HOST = "https://musinsa-oneteam.atlassian.net";
const FETCH_TIMEOUT_MS = 15_000;

// TICKET_KEYS에 포함된 배치 티켓 — cc-custom-keys 복원 대상에서 제외
const BATCH_TICKET_KEYS = new Set(TICKET_KEYS);

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

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJiraTicket(key: string): Promise<Ticket | null> {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) {
    console.warn(`JIRA credentials not found, skipping ticket ${key}`);
    return null;
  }

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };

  // β-1: Jira FIELDS 공통 상수 (lib/jira-fields.ts) 사용 — drift 정리
  // (기존 누락: reporter / issuelinks → 공통 상수로 자동 포함)
  const FIELDS = JIRA_BATCH_FIELDS_STR;

  const searchUrl =
    `${JIRA_HOST}/rest/api/3/search/jql?` +
    new URLSearchParams({
      jql: `key = ${key}`,
      maxResults: "1",
      fields: FIELDS,
    });

  try {
    const res = await fetchWithTimeout(searchUrl, { headers, cache: "no-store" });

    if (!res.ok) {
      console.warn(`Failed to fetch JIRA ticket ${key}: ${res.status}`);
      return null;
    }

    const data = await res.json();

    if (!data.issues || (data.issues as unknown[]).length === 0) {
      // JIRA에서 가져올 수 없을 때 — TICKET_OVERRIDES + 플레이스홀더로 fallback
      const override = TICKET_OVERRIDES[key] ?? {};
      const ticket: Ticket = {
        ...override,
        key,
        summary: override.summary ?? `(${key})`,
        status: override.status ?? "-",
        assignee: "-",
        eta: override.eta ?? "-",
        type: override.type ?? "-",
        project: key.split("-")[0],
      };
      return ticket;
    }

    const issue = (data.issues as Array<Record<string, any>>)[0];
    const override = TICKET_OVERRIDES[issue.key] ?? {};
    const f = issue.fields;
    const ticket: Ticket = {
      key: issue.key,
      summary: f.summary,
      status: f.status.name,
      assignee: (f.assignee?.displayName ?? "-").split("/")[0].trim() || "-",
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
    };

    return ticket;
  } catch (err) {
    console.warn(`Error fetching JIRA ticket ${key}:`, err);
    return null;
  }
}

/** JIRA 티켓 키 형식 검증 (배치 티켓은 제외) */
function isValidCustomKey(key: string): boolean {
  return /^[A-Z][A-Z0-9]*-\d+$/.test(key) && !BATCH_TICKET_KEYS.has(key);
}

export async function POST(req: NextRequest) {
  let body: { dryRun?: boolean } = {};
  try {
    const text = await req.text();
    if (text.trim()) {
      body = JSON.parse(text);
    }
  } catch {
    // Empty body is fine, just use defaults
  }

  const { dryRun = false } = body;

  try {
    const allKeys = new Set<string>();
    const sources: Record<string, string[]> = {};

    // ── Source 1: cc-custom-keys (현재 KV — 일부만 남아있을 수 있음) ───────
    console.log("Reading cc-custom-keys...");
    const existingCustomKeys = await redis.get<string[]>("cc-custom-keys");
    const customKeysList: string[] = [];
    if (Array.isArray(existingCustomKeys)) {
      existingCustomKeys.forEach(key => {
        if (typeof key === "string" && isValidCustomKey(key)) {
          allKeys.add(key);
          customKeysList.push(key);
        }
      });
    }
    sources["cc-custom-keys"] = customKeysList;

    // ── Source 2: cc-ticket-added-dates (전체 키 포함, 배치 티켓만 제외) ──
    console.log("Reading cc-ticket-added-dates...");
    const ticketAddedDates = await redis.get<Record<string, any>>("cc-ticket-added-dates");
    const addedKeysList: string[] = [];
    if (ticketAddedDates && typeof ticketAddedDates === "object") {
      Object.keys(ticketAddedDates).forEach(key => {
        if (isValidCustomKey(key)) {
          allKeys.add(key);
          addedKeysList.push(key);
        }
      });
    }
    sources["cc-ticket-added-dates"] = addedKeysList;

    // ── Source 3: cc-planning (가장 광범위 — 대부분의 커스텀 티켓 포함) ─────
    console.log("Reading cc-planning...");
    const planningData = await redis.get<Record<string, any>>("cc-planning");
    const planningKeysList: string[] = [];
    if (planningData && typeof planningData === "object") {
      Object.keys(planningData).forEach(key => {
        if (isValidCustomKey(key)) {
          allKeys.add(key);
          planningKeysList.push(key);
        }
      });
    }
    sources["cc-planning"] = planningKeysList;

    // ── Source 4: cc-schedules (스케줄 데이터가 있는 티켓) ──────────────────
    console.log("Reading cc-schedules...");
    const schedulesData = await redis.get<Record<string, any>>("cc-schedules");
    const schedulesKeysList: string[] = [];
    if (schedulesData && typeof schedulesData === "object") {
      Object.keys(schedulesData).forEach(key => {
        if (isValidCustomKey(key)) {
          allKeys.add(key);
          schedulesKeysList.push(key);
        }
      });
    }
    sources["cc-schedules"] = schedulesKeysList;

    // ── Source 5: cc-memos-v2 (메모가 있는 티켓) ────────────────────────────
    console.log("Reading cc-memos-v2...");
    const memosData = await redis.get<Record<string, any>>("cc-memos-v2");
    const memosKeysList: string[] = [];
    if (memosData && typeof memosData === "object") {
      Object.keys(memosData).forEach(key => {
        if (isValidCustomKey(key)) {
          allKeys.add(key);
          memosKeysList.push(key);
        }
      });
    }
    sources["cc-memos-v2"] = memosKeysList;

    // ── Source 6: cc-etr (ETR 티켓 참조) ─────────────────────────────────────
    console.log("Reading cc-etr...");
    const etrData = await redis.get<Record<string, any>>("cc-etr");
    const etrKeysList: string[] = [];
    if (etrData && typeof etrData === "object") {
      Object.values(etrData).forEach(entry => {
        if (entry && typeof entry === "object" && Array.isArray(entry.etrTickets)) {
          entry.etrTickets.forEach((item: unknown) => {
            const k = typeof item === "string" ? item
                    : (item && typeof item === "object" ? (item as Record<string, unknown>).key as string : null);
            if (k && isValidCustomKey(k)) {
              allKeys.add(k);
              etrKeysList.push(k);
            }
          });
        }
      });
    }
    sources["cc-etr"] = [...new Set(etrKeysList)];

    const allKeysArray = Array.from(allKeys).sort();
    console.log(`총 복구 대상: ${allKeysArray.length}개`);
    console.log("소스별 건수:", Object.entries(sources).map(([k, v]) => `${k}:${v.length}`).join(", "));

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        summary: {
          allKeys: allKeysArray,
          totalKeys: allKeys.size,
          sources: Object.fromEntries(
            Object.entries(sources).map(([k, v]) => [k, [...new Set(v)].sort()])
          ),
        },
      });
    }

    // ── 기존 cc-custom-tickets 읽어 safe-merge 기반으로 복구 ────────────────
    console.log("Reading existing cc-custom-tickets for safe-merge...");
    const existingTickets = await redis.get<Ticket[]>("cc-custom-tickets") ?? [];
    const existingByKey = new Map(existingTickets.map(t => [t.key, t]));

    // 순차 fetch (병렬 시 Vercel timeout 위험 — 안전성 우선)
    console.log(`Fetching ${allKeysArray.length} tickets from JIRA (sequential)...`);
    const fetchedByKey = new Map<string, Ticket>();
    const failedKeys: string[] = [];

    for (const key of allKeysArray) {
      try {
        const ticket = await fetchJiraTicket(key);
        if (ticket) {
          fetchedByKey.set(key, ticket);
        } else {
          failedKeys.push(key);
        }
      } catch (err) {
        console.error(`Failed to fetch ${key}:`, err);
        failedKeys.push(key);
      }
    }

    // SAFE-MERGE: fetch 성공 = 새 데이터, 실패 = 기존 KV 데이터 보존
    const mergedTickets: Ticket[] = allKeysArray
      .map(key => fetchedByKey.get(key) ?? existingByKey.get(key))
      .filter((t): t is Ticket => t !== undefined);

    const mergedKeys = mergedTickets.map(t => t.key);

    console.log(`Fetched ${fetchedByKey.size}, preserved ${failedKeys.filter(k => existingByKey.has(k)).length}, lost ${failedKeys.filter(k => !existingByKey.has(k)).length}`);

    // KV 저장
    console.log(`Saving ${mergedKeys.length} tickets to KV...`);
    await Promise.all([
      redis.set("cc-custom-tickets", mergedTickets),
      redis.set("cc-custom-keys", mergedKeys),
    ]);

    return NextResponse.json({
      success: true,
      summary: {
        totalKeysFound: allKeys.size,
        ticketsFetched: fetchedByKey.size,
        ticketsPreserved: failedKeys.filter(k => existingByKey.has(k)).length,
        ticketsLost: failedKeys.filter(k => !existingByKey.has(k)).length,
        savedToKV: mergedKeys.length,
        sources: Object.fromEntries(
          Object.entries(sources).map(([k, v]) => [k, [...new Set(v)].length])
        ),
        failedKeys: failedKeys.sort(),
        savedKeys: mergedKeys.sort(),
      },
    });
  } catch (err) {
    console.error("[KV RECOVERY]", err);
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json(
      { error: `복구 실패: ${message}` },
      { status: 500 }
    );
  }
}
