import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JIRA_HOST = "https://musinsa-oneteam.atlassian.net";
const FETCH_TIMEOUT_MS = 15_000;
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** ADF(Atlassian Document Format) JSON → plain text */
function adfToText(node: unknown, depth = 0): string {
  if (!node || typeof node !== "object") return "";
  const n = node as Record<string, unknown>;
  if (n.type === "text") return (n.text as string) ?? "";
  if (n.type === "hardBreak" || n.type === "rule") return "\n";
  if (Array.isArray(n.content)) {
    const sep = ["paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock"].includes(n.type as string) ? "\n" : "";
    return sep + (n.content as unknown[]).map(c => adfToText(c, depth + 1)).join("") + sep;
  }
  return "";
}

/** Confluence storage XML에서 텍스트 추출 (간단 태그 제거) */
function storageToText(html: string): string {
  return html
    .replace(/<ac:[^>]*>[\s\S]*?<\/ac:[^>]*>/g, "") // Confluence 매크로 제거
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, "\n\n")
    .trim();
}

/** Confluence 페이지 URL에서 pageId 추출 */
function extractConfluencePageId(url: string): string | null {
  const m = url.match(/\/pages\/(\d+)/);
  return m ? m[1] : null;
}

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key")?.trim().toUpperCase() ?? "";
  if (!key || !/^[A-Z]+-\d+$/.test(key)) {
    return NextResponse.json({ error: "유효하지 않은 티켓 키" }, { status: 400 });
  }

  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;

  console.log("[ai-summary] key:", key, "| GEMINI_API_KEY:", geminiKey ? "SET" : "MISSING");

  if (!email || !token) return NextResponse.json({ error: "JIRA 환경변수 누락" }, { status: 500 });
  if (!geminiKey) return NextResponse.json({ error: "GEMINI_API_KEY 누락" }, { status: 500 });

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const jiraHeaders = { Authorization: `Basic ${auth}`, Accept: "application/json" };

  // 1. JIRA 티켓 상세 조회 (description 포함)
  let ticketSummary = "";
  let ticketDescription = "";
  let ticketAssignee = "";
  let ticketType = "";
  let twoPagerUrl: string | null = null;

  try {
    const res = await fetchWithTimeout(
      `${JIRA_HOST}/rest/api/3/search/jql?` +
        new URLSearchParams({
          jql: `key = ${key}`,
          maxResults: "1",
          fields: "summary,description,assignee,issuetype,customfield_10070",
        }),
      { headers: jiraHeaders, cache: "no-store" }
    );
    if (res.ok) {
      const data = await res.json();
      const issue = (data.issues as Array<Record<string, unknown>>)?.[0];
      if (issue) {
        const f = issue.fields as Record<string, unknown>;
        ticketSummary = (f.summary as string) ?? "";
        ticketAssignee = ((f.assignee as Record<string, unknown>)?.displayName as string | undefined)?.split("/")[0].trim() ?? "-";
        ticketType = (f.issuetype as Record<string, unknown>)?.name as string ?? "";
        ticketDescription = adfToText(f.description).slice(0, 2000).trim();

        // customfield_10070 = 2-Pager/PRD URL
        const prd = f.customfield_10070;
        if (prd) {
          if (typeof prd === "string") twoPagerUrl = prd;
          else if (typeof prd === "object") {
            const p = prd as Record<string, unknown>;
            twoPagerUrl = (p.url ?? p.href ?? p.link) as string | null;
          }
        }
      }
    }
  } catch {}

  // 2. JIRA Remote Links 조회 → Confluence 페이지 URL 찾기
  const remotePageUrls: string[] = [];
  if (twoPagerUrl) remotePageUrls.push(twoPagerUrl);

  try {
    const res = await fetchWithTimeout(
      `${JIRA_HOST}/rest/api/3/issue/${key}/remotelink`,
      { headers: jiraHeaders, cache: "no-store" }
    );
    if (res.ok) {
      const links = await res.json() as Array<Record<string, unknown>>;
      for (const link of links) {
        const obj = link.object as Record<string, unknown> | undefined;
        const url = obj?.url as string | undefined;
        if (url && (url.includes("atlassian.net/wiki") || url.includes("confluence"))) {
          if (!remotePageUrls.includes(url)) remotePageUrls.push(url);
        }
      }
    }
  } catch {}

  // 3. Confluence 페이지 내용 조회 (최대 2개, 각 3000자 제한)
  let confluenceContent = "";
  for (const url of remotePageUrls.slice(0, 2)) {
    const pageId = extractConfluencePageId(url);
    if (!pageId) continue;
    try {
      const res = await fetchWithTimeout(
        `${JIRA_HOST}/wiki/rest/api/content/${pageId}?expand=body.storage`,
        { headers: jiraHeaders, cache: "no-store" }
      );
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        const title = (data.title as string) ?? "";
        const storage = (data.body as Record<string, unknown>)?.storage as Record<string, unknown> | undefined;
        const raw = (storage?.value as string) ?? "";
        const text = storageToText(raw).slice(0, 3000);
        if (text) confluenceContent += `\n\n### 연결 페이지: ${title}\n${text}`;
      }
    } catch {}
  }

  // 4. Gemini API로 요약 생성
  const context = [
    `티켓: ${key} (${ticketType})`,
    `제목: ${ticketSummary}`,
    `담당자: ${ticketAssignee}`,
    ticketDescription ? `\n설명:\n${ticketDescription}` : "",
    confluenceContent,
  ].filter(Boolean).join("\n");

  if (!context.trim()) {
    return NextResponse.json({ error: "요약할 내용이 없습니다." }, { status: 422 });
  }

  const prompt = `아래는 JIRA 티켓과 연결 문서의 내용이다. 이 과제가 무엇인지 처음 보는 사람도 핵심을 파악할 수 있도록 팀 대시보드용 요약을 작성하라.

${context}

---
작성 규칙:
- 한국어로 작성
- 4~6개의 bullet point (•)로 구성
- 각 항목은 구체적이고 명확하게 (추상적 표현 금지)
- 아래 항목을 중심으로 작성:
  1. 이 과제가 왜 필요한가 (배경/목적)
  2. 무엇을 만들거나 변경하는가 (핵심 작업 내용)
  3. 주요 Acceptance Criteria 또는 완료 조건
  4. 기술적으로 중요한 포인트 (있는 경우)
  5. 영향 범위 또는 주의사항 (있는 경우)
- 티켓 제목을 단순 반복하는 bullet 금지
- 불필요한 서론/결론 없이 bullet만 출력
- 앞뒤에 제목/레이블 없이 bullet만 출력`;

  try {
    const res = await fetchWithTimeout(
      `${GEMINI_API_URL}?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1024, temperature: 0.2 },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("[ai-summary] Gemini API error:", res.status, errText);
      return NextResponse.json({ error: `AI 요약 실패: ${res.status} ${errText}` }, { status: 500 });
    }

    const data = await res.json() as Record<string, unknown>;
    const summary = ((data.candidates as Array<Record<string, unknown>>)?.[0]
      ?.content as Record<string, unknown>)
      ?.parts as Array<Record<string, unknown>>;
    const text = summary?.[0]?.text as string | undefined;

    if (!text) {
      return NextResponse.json({ error: "요약 결과가 없습니다." }, { status: 500 });
    }

    return NextResponse.json({ summary: text.trim(), key });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ai-summary] Gemini fetch error:", msg);
    return NextResponse.json({ error: `AI 요약 실패: ${msg}` }, { status: 500 });
  }
}
