import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import type { Ticket } from "@/app/jira-tickets/TicketBoard";
import { TICKET_OVERRIDES } from "@/app/jira-tickets/tickets-data";

export const dynamic = "force-dynamic";

const JIRA_HOST = "https://musinsa-oneteam.atlassian.net";
const FETCH_TIMEOUT_MS = 15_000;

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

  const FIELDS = [
    "summary", "status", "assignee", "issuetype", "project", "duedate",
    "priority", "parent",
    "customfield_10015", // Start date
    "customfield_10036", // Story Points
    "customfield_10067", // 요청부문 (multiselect)
    "customfield_10070", // 2-Pager/PRD Link
    "customfield_10071", // Health Check
    "customfield_14402", // Main Subject
  ].join(",");

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

function isNonTMKey(key: string): boolean {
  return /^[A-Z][A-Z0-9]*-\d+$/.test(key) && !key.startsWith("TM-");
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
    // Step 1: Read cc-etr to extract ETR/OPS ticket keys from etrTickets arrays
    console.log("Reading cc-etr...");
    const etrData = await redis.get<Record<string, any>>("cc-etr");
    const etrKeys = new Set<string>();

    if (etrData && typeof etrData === "object") {
      Object.values(etrData).forEach(entry => {
        if (entry && typeof entry === "object" && Array.isArray(entry.etrTickets)) {
          // etrTickets는 { key: string, ... } 객체 배열
          entry.etrTickets.forEach((item: unknown) => {
            const k = typeof item === "string" ? item
                    : (item && typeof item === "object" ? (item as Record<string, unknown>).key as string : null);
            if (k && isNonTMKey(k)) etrKeys.add(k);
          });
        }
      });
    }

    // Step 2: Read cc-ticket-added-dates to extract non-TM ticket keys
    console.log("Reading cc-ticket-added-dates...");
    const ticketAddedDates = await redis.get<Record<string, any>>("cc-ticket-added-dates");
    const addedKeys = new Set<string>();

    if (ticketAddedDates && typeof ticketAddedDates === "object") {
      Object.keys(ticketAddedDates).forEach(key => {
        if (isNonTMKey(key)) {
          addedKeys.add(key);
        }
      });
    }

    // Step 3: Read cc-custom-keys from KV (might be empty)
    console.log("Reading cc-custom-keys...");
    const existingCustomKeys = await redis.get<string[]>("cc-custom-keys");
    const customKeys = new Set<string>();

    if (Array.isArray(existingCustomKeys)) {
      existingCustomKeys.forEach(key => {
        if (typeof key === "string" && isNonTMKey(key)) {
          customKeys.add(key);
        }
      });
    }

    // Step 4: Combine all unique non-TM keys found
    const allKeys = new Set([...etrKeys, ...addedKeys, ...customKeys]);
    const allKeysArray = Array.from(allKeys).sort();

    console.log(`Found keys - ETR: ${etrKeys.size}, Added: ${addedKeys.size}, Custom: ${customKeys.size}, Total unique: ${allKeys.size}`);

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        summary: {
          etrKeys: Array.from(etrKeys).sort(),
          addedKeys: Array.from(addedKeys).sort(),
          customKeys: Array.from(customKeys).sort(),
          allKeys: allKeysArray,
          totalKeys: allKeys.size,
        },
      });
    }

    // Step 5: For each key, fetch ticket data from JIRA
    console.log(`Fetching ticket data for ${allKeysArray.length} keys...`);
    const ticketList: Ticket[] = [];  // cc-custom-tickets는 배열 형식
    const fetchedKeys: string[] = [];
    const failedKeys: string[] = [];

    for (const key of allKeysArray) {
      try {
        const ticket = await fetchJiraTicket(key);
        if (ticket) {
          ticketList.push(ticket);
          fetchedKeys.push(key);
        } else {
          failedKeys.push(key);
        }
      } catch (err) {
        console.error(`Failed to fetch ${key}:`, err);
        failedKeys.push(key);
      }
    }

    console.log(`Fetched ${fetchedKeys.length} tickets successfully, ${failedKeys.length} failed`);

    // Step 6: cc-custom-tickets(배열)와 cc-custom-keys 저장
    if (fetchedKeys.length > 0) {
      console.log("Saving to KV...");
      await Promise.all([
        redis.set("cc-custom-tickets", ticketList),   // Ticket[] 배열로 저장
        redis.set("cc-custom-keys", fetchedKeys),
      ]);
    }

    // Step 7: Return a summary of what was recovered
    return NextResponse.json({
      success: true,
      summary: {
        totalKeysFound: allKeys.size,
        ticketsFetched: fetchedKeys.length,
        ticketsFailed: failedKeys.length,
        savedToKV: fetchedKeys.length > 0,
        breakdown: {
          fromEtr: etrKeys.size,
          fromAddedDates: addedKeys.size,
          fromCustomKeys: customKeys.size,
        },
        fetchedKeys: fetchedKeys.sort(),
        failedKeys: failedKeys.sort(),
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