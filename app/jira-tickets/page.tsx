import { unstable_cache } from "next/cache";
import TicketBoard, { type Ticket } from "./TicketBoard";

export const dynamic = "force-dynamic";

const JIRA_HOST = "https://jira.team.musinsa.com";
const JQL =
  '"sub group[select list (multiple choices)]" = "29CM-P Commerce Core" ORDER BY created DESC';
const JIRA_API = `${JIRA_HOST}/rest/api/3/search/jql`;

async function fetchJiraTickets(): Promise<{ tickets: Ticket[]; error?: string }> {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) {
    return { tickets: [], error: "JIRA_EMAIL 또는 JIRA_API_TOKEN 환경변수가 없습니다." };
  }

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  };

  const tickets: Ticket[] = [];
  let startAt = 0;

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
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      const body = await res.text();
      return { tickets: [], error: `Jira API ${res.status}: ${body.slice(0, 300)}` };
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

  return { tickets };
}

export default async function JiraTicketsPage() {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  if (!email || !token) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="bg-white border border-red-200 rounded-xl px-8 py-6 max-w-md text-center">
          <p className="text-sm font-semibold text-red-600 mb-2">환경변수 미설정</p>
          <p className="text-xs text-gray-500 leading-relaxed">
            Vercel 대시보드 → Settings → Environment Variables 에서
            <br />
            <code className="bg-gray-100 px-1 rounded">JIRA_EMAIL</code> 과{" "}
            <code className="bg-gray-100 px-1 rounded">JIRA_API_TOKEN</code> 을 등록해주세요.
          </p>
        </div>
      </div>
    );
  }

  const getCached = unstable_cache(fetchJiraTickets, ["jira-cc-tickets"], {
    revalidate: 300,
  });
  const { tickets, error } = await getCached();

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="bg-white border border-red-200 rounded-xl px-8 py-6 max-w-lg text-center">
          <p className="text-sm font-semibold text-red-600 mb-2">Jira API 오류</p>
          <p className="text-xs text-gray-500 font-mono break-all leading-relaxed">{error}</p>
        </div>
      </div>
    );
  }

  return <TicketBoard tickets={tickets} />;
}
