import { NextResponse } from "next/server";
import { TICKET_OVERRIDES } from "@/app/jira-tickets/tickets-data";
import type { Ticket } from "@/app/jira-tickets/TicketBoard";

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key")?.trim().toUpperCase() ?? "";

  if (!key || !/^[A-Z]+-\d+$/.test(key)) {
    return NextResponse.json(
      { error: "유효하지 않은 티켓 키입니다. 예: TM-1234" },
      { status: 400 }
    );
  }

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
    "summary", "status", "assignee", "issuetype", "project", "duedate",
    "priority", "parent",
    "customfield_10015", // Start date
    "customfield_10036", // Story Points
    "customfield_10070", // 2-Pager/PRD Link
    "customfield_10071", // Health Check
    "customfield_14402", // Main Subject (요청부문)
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
      const body = await res.text();
      return NextResponse.json(
        { error: `Jira API ${res.status}: ${body.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const data = await res.json();

    if (!data.issues || (data.issues as unknown[]).length === 0) {
      // JIRA에서 가져올 수 없을 때 — TICKET_OVERRIDES + 플레이스홀더로 fallback
      const ov = TICKET_OVERRIDES[key] ?? {};
      const ticket = {
        ...ov,
        key,
        summary: ov.summary ?? `(${key})`,
        status:  ov.status  ?? "-",
        assignee: "-",
        eta:     ov.eta     ?? "-",
        type:    ov.type    ?? "-",
        project: key.split("-")[0],
      } as Ticket;
      return NextResponse.json({ ticket });
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
      requestPriority: f.priority?.name ?? undefined,
      parent: f.parent?.key ?? undefined,
      ...override,
    };

    return NextResponse.json({ ticket });
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: `요청 실패: ${message}` }, { status: 504 });
  }
}
