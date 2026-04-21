import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import type { Ticket } from "@/app/jira-tickets/TicketBoard";

export const dynamic = "force-dynamic";

const JIRA_HOST = "https://musinsa-oneteam.atlassian.net";
const FETCH_TIMEOUT_MS = 20_000;

function extractUrl(val: unknown): string | undefined {
  if (!val) return undefined;
  if (typeof val === "string") return val || undefined;
  if (typeof val === "object") {
    const v = val as Record<string, unknown>;
    return ((v.url ?? v.href ?? v.link) as string | undefined) || undefined;
  }
  return undefined;
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

// Vercel Cron이 호출하는 핸들러 (매일 09:00 KST)
// KV의 cc-custom-keys를 읽어 JIRA 재조회 → cc-custom-tickets KV 갱신
export async function GET(request: Request) {
  // Vercel Cron 인증: 프로덕션에서는 CRON_SECRET 환경변수로 보호
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) {
    return NextResponse.json({ error: "JIRA 환경변수 누락" }, { status: 500 });
  }

  try {
    // 1. KV에서 커스텀 키 목록 읽기
    const customKeys = await redis.get<string[]>("cc-custom-keys");
    if (!customKeys || customKeys.length === 0) {
      return NextResponse.json({ ok: true, message: "커스텀 티켓 없음", refreshed: 0 });
    }

    // 2. JIRA에서 커스텀 티켓 재조회
    const auth = Buffer.from(`${email}:${token}`).toString("base64");
    const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };
    const FIELDS = [
      "summary", "status", "assignee", "issuetype", "project", "duedate",
      "priority", "parent",
      "customfield_10015",
      "customfield_10036",
      "customfield_10070",
      "customfield_10071",
      "customfield_14402",
    ].join(",");

    const freshTickets: Ticket[] = [];
    await Promise.all(
      customKeys.map(async (key) => {
        try {
          const url =
            `${JIRA_HOST}/rest/api/3/search/jql?` +
            new URLSearchParams({ jql: `key = ${key}`, maxResults: "1", fields: FIELDS });
          const res = await fetchWithTimeout(url, { headers, cache: "no-store" });
          if (!res.ok) return;
          const data = await res.json();
          if (!data.issues || (data.issues as unknown[]).length === 0) return;
          const issue = (data.issues as Array<Record<string, unknown>>)[0];
          const f = issue.fields as Record<string, unknown>;
          const status = f.status as Record<string, unknown>;
          const assignee = f.assignee as Record<string, unknown> | null;
          const issuetype = f.issuetype as Record<string, unknown>;
          const project = f.project as Record<string, unknown>;
          const parent = f.parent as Record<string, unknown> | null;
          const priority = f.priority as Record<string, unknown> | null;
          const healthCheck = f.customfield_10071 as Record<string, unknown> | null;
          const requestDept = f.customfield_14402 as Record<string, unknown> | null;
          freshTickets.push({
            key: issue.key as string,
            summary: f.summary as string,
            status: status.name as string,
            assignee: ((assignee?.displayName as string | undefined) ?? "-").split("/")[0].trim() || "-",
            eta: (f.duedate as string | undefined) ?? "-",
            type: issuetype.name as string,
            project: project.key as string,
            startDate: (f.customfield_10015 as string | undefined) ?? undefined,
            storyPoints: (f.customfield_10036 as number | undefined) ?? undefined,
            twoPagerUrl: extractUrl(f.customfield_10070),
            healthCheck: healthCheck?.value as string | undefined,
            requestDept: requestDept?.value as string | undefined,
            requestPriority: priority?.name as string | undefined,
            parent: parent?.key as string | undefined,
          });
        } catch {}
      })
    );

    // 3. KV 갱신
    await redis.set("cc-custom-tickets", freshTickets);

    return NextResponse.json({
      ok: true,
      refreshed: freshTickets.length,
      total: customKeys.length,
      refreshedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[daily-refresh]", e);
    return NextResponse.json({ error: "갱신 실패" }, { status: 500 });
  }
}
