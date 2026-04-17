import { NextResponse } from "next/server";
import { TICKET_KEYS, TICKET_OVERRIDES } from "@/app/jira-tickets/tickets-data";
import type { Ticket } from "@/app/jira-tickets/TicketBoard";

export const dynamic = "force-dynamic";

const JIRA_HOST = "https://jira.team.musinsa.com";

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
  const jql = `key in (${TICKET_KEYS.join(",")})`;

  const FIELDS = [
    "summary", "status", "assignee", "issuetype", "project", "duedate",
    "priority", "parent",
    "customfield_10015", // Start date
    "customfield_10036", // Story Points
    "customfield_10070", // 2-Pager/PRD Link
    "customfield_10071", // Health Check
    "customfield_14402", // Main Subject (요청부문)
  ].join(",");

  const tickets: Ticket[] = [];
  let startAt = 0;

  try {
    while (true) {
      const url =
        `${JIRA_HOST}/rest/api/2/search?` +
        new URLSearchParams({
          jql,
          startAt: String(startAt),
          maxResults: "100",
          fields: FIELDS,
        });

      const res = await fetchWithTimeout(url, { headers, cache: "no-store" });

      if (!res.ok) {
        const body = await res.text();
        return NextResponse.json(
          { error: `Jira API ${res.status}: ${body.slice(0, 300)}` },
          { status: 502 }
        );
      }

      const data = await res.json();

      for (const issue of data.issues as Array<Record<string, any>>) {
        const override = TICKET_OVERRIDES[issue.key] ?? {};
        const f = issue.fields;
        tickets.push({
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
          requestPriority: f.priority?.name ?? undefined,
          parent: f.parent?.key ?? undefined,
          ...override,
        });
      }

      // isLast: /search/jql 엔드포인트는 total 대신 isLast를 반환하기도 함
      const fetched = (data.issues as unknown[]).length;
      if (data.isLast || fetched === 0 || startAt + fetched >= (data.total ?? 0)) break;
      startAt += fetched;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: `요청 실패: ${message}` }, { status: 504 });
  }

  // TICKET_KEYS 순서 유지
  // JIRA에서 못 가져온 키는 TICKET_OVERRIDES에 summary가 있으면 fallback으로 표시
  const byKey = Object.fromEntries(tickets.map((t) => [t.key, t]));
  const sorted = TICKET_KEYS.map((k) => {
    if (byKey[k]) return byKey[k];
    const ov = TICKET_OVERRIDES[k];
    if (ov && "summary" in ov && ov.summary) {
      return { key: k, assignee: "-", eta: "-", type: "-", project: k.split("-")[0], ...ov } as Ticket;
    }
    return null;
  }).filter((t): t is Ticket => t != null);

  return NextResponse.json({ tickets: sorted, fetchedAt: new Date().toISOString() });
}
