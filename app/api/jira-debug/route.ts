import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  if (!email || !token) {
    return NextResponse.json({ error: "env missing", email: !!email, token: !!token });
  }

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };

  const url = `https://musinsa-oneteam.atlassian.net/rest/api/3/search/jql?jql=key+in+(TM-1241)&fields=summary,status`;

  const res = await fetch(url, { headers, cache: "no-store" });
  const body = await res.text();

  return NextResponse.json({
    status: res.status,
    ok: res.ok,
    emailUsed: email,
    body: body.slice(0, 1000),
  });
}
