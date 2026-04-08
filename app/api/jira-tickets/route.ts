import { NextResponse } from "next/server";

const JIRA_HOST = "https://jira.team.musinsa.com";
const JQL =
  '"sub group[select list (multiple choices)]" = "29CM-P Commerce Core" ORDER BY created DESC';
const JIRA_API = `${JIRA_HOST}/rest/api/3/search/jql`;

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

  const tickets: unknown[] = [];
  let startAt = 0;

  try {
    while (true) {
      const url =
        `${JIRA_API}?` +
        new URLSearchParams({
          jql: JQL,
          startAt: String(startAt),
          maxResults: "100",
          fields: "summary,status,assignee,issuetype,project,duedate",
        });

      const res = await fetch(url, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const body = await res.text();
        return NextResponse.json(
          { error: `Jira API ${res.status}: ${body.slice(0, 300)}` },
          { status: 502 }
        );
      }

      const data = await res.json();

      for (const issue of data.issues as Array<Record<string, any>>) {
        const rawName: string = issue.fields.assignee?.displayName ?? "";
        tickets.push({
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status.name,
          assignee: rawName.split("/")[0].trim() || "-",
          eta: issue.fields.duedate ?? "-",
          type: issue.fields.issuetype.name,
          project: issue.fields.project.key,
        });
      }

      if (startAt + data.issues.length >= data.total) break;
      startAt += data.issues.length;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json(
      { error: `요청 실패: ${message}` },
      { status: 504 }
    );
  }

  return NextResponse.json({ tickets });
}
