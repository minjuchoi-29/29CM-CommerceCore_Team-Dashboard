import TicketBoard, { type Ticket } from "./TicketBoard";

const CLOUD_ID = "23c14e7d-74ed-40b6-a0bb-fbc1f6351b84";
const JQL =
  '"sub group[select list (multiple choices)]" = "29CM-P Commerce Core" ORDER BY created DESC';
const JIRA_API =
  `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/3/search`;

async function fetchJiraTickets(): Promise<Ticket[]> {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) {
    console.error("[jira-tickets] JIRA_EMAIL or JIRA_API_TOKEN is not set");
    return [];
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
      console.error(
        `[jira-tickets] Jira API error ${res.status}: ${await res.text()}`
      );
      break;
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

  return tickets;
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

  const tickets = await fetchJiraTickets();
  return <TicketBoard tickets={tickets} />;
}
