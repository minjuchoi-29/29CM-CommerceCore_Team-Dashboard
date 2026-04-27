import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JIRA_HOST = "https://musinsa-oneteam.atlassian.net";
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

/** ADF(Atlassian Document Format) JSON → plain text */
function adfToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as Record<string, unknown>;
  if (n.type === "text") return (n.text as string) ?? "";
  if (n.type === "hardBreak" || n.type === "rule") return "\n";
  if (n.type === "mention") return `@${(n.attrs as Record<string, unknown>)?.text ?? ""}`;
  if (n.type === "inlineCard") {
    const url = (n.attrs as Record<string, unknown>)?.url as string ?? "";
    return url ? `[링크: ${url}]` : "";
  }
  if (Array.isArray(n.content)) {
    const blockTypes = ["paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "panel"];
    const sep = blockTypes.includes(n.type as string) ? "\n" : "";
    const prefix = n.type === "heading" ? `${"#".repeat((n.attrs as Record<string, unknown>)?.level as number ?? 2)} ` : "";
    return sep + prefix + (n.content as unknown[]).map(c => adfToText(c)).join("") + sep;
  }
  return "";
}

/** Confluence storage XML → plain text */
function storageToText(html: string): string {
  return html
    .replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/g, "")
    .replace(/<ac:[^>]*\/>/g, "")
    .replace(/<ac:[^>]*>[\s\S]*?<\/ac:[^>]*>/g, "")
    .replace(/<h([1-6])[^>]*>/g, "\n## ")
    .replace(/<\/h[1-6]>/g, "\n")
    .replace(/<li[^>]*>/g, "\n• ")
    .replace(/<\/li>/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>/g, "\n")
    .replace(/<\/p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
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

  const email       = process.env.JIRA_EMAIL;
  const token       = process.env.JIRA_API_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!email || !token)  return NextResponse.json({ error: "JIRA 환경변수 누락" }, { status: 500 });
  if (!anthropicKey)     return NextResponse.json({ error: "ANTHROPIC_API_KEY 누락" }, { status: 500 });

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const jiraHeaders = { Authorization: `Basic ${auth}`, Accept: "application/json" };

  // ── 1. JIRA 티켓 상세 조회 ──────────────────────────────────────────────
  let ticketSummary     = "";
  let ticketDescription = "";
  let ticketAssignee    = "";
  let ticketType        = "";
  let ticketPriority    = "";
  let ticketLabels: string[]     = [];
  let ticketComponents: string[] = [];
  let ticketEta         = "";
  let parentSummary     = "";
  let twoPagerUrl: string | null = null;

  try {
    const res = await fetchWithTimeout(
      `${JIRA_HOST}/rest/api/3/search/jql?` +
        new URLSearchParams({
          jql: `key = ${key}`,
          maxResults: "1",
          fields: "summary,description,assignee,issuetype,priority,labels,components,duedate,parent,customfield_10070,customfield_10014",
        }),
      { headers: jiraHeaders, cache: "no-store" }
    );
    if (res.ok) {
      const data = await res.json();
      const issue = (data.issues as Array<Record<string, unknown>>)?.[0];
      if (issue) {
        const f = issue.fields as Record<string, unknown>;
        ticketSummary    = (f.summary as string) ?? "";
        ticketAssignee   = ((f.assignee as Record<string, unknown>)?.displayName as string | undefined)
          ?.split("/")[0].trim() ?? "-";
        ticketType       = (f.issuetype as Record<string, unknown>)?.name as string ?? "";
        ticketPriority   = (f.priority as Record<string, unknown>)?.name as string ?? "";
        ticketLabels     = Array.isArray(f.labels) ? (f.labels as string[]) : [];
        ticketComponents = Array.isArray(f.components)
          ? (f.components as Array<Record<string, unknown>>).map(c => c.name as string)
          : [];
        ticketEta        = (f.duedate as string) ?? "";
        parentSummary    = (f.parent as Record<string, unknown>)?.fields
          ? ((f.parent as Record<string, unknown>).fields as Record<string, unknown>).summary as string ?? ""
          : "";

        ticketDescription = adfToText(f.description).slice(0, 5000).trim();

        const prd = f.customfield_10070;
        if (prd) {
          if (typeof prd === "string") twoPagerUrl = prd;
          else if (typeof prd === "object") {
            const p = prd as Record<string, unknown>;
            twoPagerUrl = (p.url ?? p.href ?? p.link) as string | null;
          }
        }
        if (!twoPagerUrl && typeof f.customfield_10014 === "string") {
          twoPagerUrl = f.customfield_10014;
        }
      }
    }
  } catch {}

  // ── 2. JIRA Remote Links → Confluence URL 수집 ──────────────────────────
  const PRD_TITLE_KEYWORDS = ["prd", "2-pager", "2pager", "기획서", "기획안", "요구사항", "spec", "제품 요구"];

  type LinkedDoc = { url: string; title: string; isPrd: boolean };
  const linkedDocs: LinkedDoc[] = [];

  if (twoPagerUrl) {
    linkedDocs.push({ url: twoPagerUrl, title: "", isPrd: true });
  }

  try {
    const res = await fetchWithTimeout(
      `${JIRA_HOST}/rest/api/3/issue/${key}/remotelink`,
      { headers: jiraHeaders, cache: "no-store" }
    );
    if (res.ok) {
      const links = await res.json() as Array<Record<string, unknown>>;
      for (const link of links) {
        const obj   = link.object as Record<string, unknown> | undefined;
        const url   = obj?.url   as string | undefined;
        const title = (obj?.title as string | undefined) ?? "";
        if (!url || (!url.includes("atlassian.net/wiki") && !url.includes("confluence"))) continue;
        if (linkedDocs.some(d => d.url === url)) continue;
        const isPrd = PRD_TITLE_KEYWORDS.some(k => title.toLowerCase().includes(k));
        linkedDocs.push({ url, title, isPrd });
      }
    }
  } catch {}

  // ── 3. Confluence 본문 조회 — PRD(최대 8,000자) / 기타(최대 3,000자) ────
  let prdDoc: { title: string; content: string } | null = null;
  const suppDocs: { title: string; content: string }[] = [];

  for (const doc of linkedDocs.slice(0, 4)) {
    const pageId = extractConfluencePageId(doc.url);
    if (!pageId) continue;
    const limit = (doc.isPrd && !prdDoc) ? 8000 : 3000;
    try {
      const res = await fetchWithTimeout(
        `${JIRA_HOST}/wiki/rest/api/content/${pageId}?expand=body.storage`,
        { headers: jiraHeaders, cache: "no-store" }
      );
      if (!res.ok) continue;
      const data    = await res.json() as Record<string, unknown>;
      const title   = (data.title as string) ?? doc.title ?? "";
      const storage = (data.body as Record<string, unknown>)?.storage as Record<string, unknown> | undefined;
      const raw     = (storage?.value as string) ?? "";
      const content = storageToText(raw).slice(0, limit);
      if (!content) continue;

      if (doc.isPrd && !prdDoc) {
        prdDoc = { title, content };
      } else if (suppDocs.length < 2) {
        suppDocs.push({ title, content });
      }
    } catch {}
  }

  // ── 4. 컨텍스트 블록 조립 ────────────────────────────────────────────────
  const metaLines = [
    `- 티켓: ${key} (${ticketType})`,
    `- 제목: ${ticketSummary}`,
    `- 담당자: ${ticketAssignee || "-"}`,
    ticketPriority          ? `- 우선순위: ${ticketPriority}`               : "",
    ticketEta               ? `- 목표일(ETA): ${ticketEta}`                 : "",
    parentSummary           ? `- 상위 과제: ${parentSummary}`               : "",
    ticketLabels.length     > 0 ? `- 레이블: ${ticketLabels.join(", ")}`    : "",
    ticketComponents.length > 0 ? `- 컴포넌트: ${ticketComponents.join(", ")}` : "",
    prdDoc                  ? `- PRD/2-Pager: ${prdDoc.title} (연결됨)`     : "",
  ].filter(Boolean).join("\n");

  const contextParts = [
    `## 과제 정보\n${metaLines}`,
    ticketDescription ? `## JIRA 설명\n${ticketDescription}` : "",
    prdDoc ? `## PRD / 2-Pager: ${prdDoc.title}\n${prdDoc.content}` : "",
    suppDocs.length > 0
      ? `## 기타 연결 문서\n${suppDocs.map(d => `### ${d.title}\n${d.content}`).join("\n\n")}`
      : "",
  ].filter(Boolean);

  const context = contextParts.join("\n\n");

  if (!context.trim()) {
    return NextResponse.json({ error: "요약할 내용이 없습니다." }, { status: 422 });
  }

  // ── 5. Claude 요약 생성 ──────────────────────────────────────────────────
  const systemPrompt = `당신은 29CM Commerce Core 팀 대시보드를 위해 과제 요약을 작성하는 PM 어시스턴트입니다.

목적: 팀원이 처음 보는 과제를 10초 이내에 핵심 파악할 수 있도록 돕는 것.
독자: Commerce Core 팀 PM 및 개발자 (도메인 맥락을 이미 알고 있음).
문체: 간결한 한국어. 주어 생략 가능. 명사형 또는 동사 원형 종결.`;

  const hasPrd = !!prdDoc;

  const userPrompt = `아래 JIRA 티켓 정보를 분석해 과제 요약을 작성하라.

${context}

---
## 작성 규칙

### [1단계] 과제 요약 (필수)
bullet point (•) 4~5개 항목으로 작성.

각 bullet의 역할 (순서 준수):
1. **배경/목적** — 왜 이 과제가 필요한가. 사용자 문제나 비즈니스 필요성 중심으로.
2. **핵심 작업** — 구체적으로 무엇을 만들거나 변경하는가. 산출물·기능 중심.
3. **완료 조건** — 이 과제가 끝났다고 볼 수 있는 기준 (Acceptance Criteria 또는 Done 조건).
4. **영향 범위** — 어떤 시스템·도메인·서비스·팀에 영향을 주는가.
5. **주의사항** — 기술 리스크, 의존성, 알려진 제약 (해당될 때만. 없으면 생략).
${hasPrd ? `
### [2단계] PRD 핵심 (PRD / 2-Pager 문서가 있을 때 필수)
위 과제 요약 아래에 빈 줄을 하나 두고, 다음 형식으로 출력:

PRD 핵심:
• (bullet 3~5개)

각 bullet의 역할:
1. **핵심 목표** — PRD가 달성하고자 하는 최종 목표 또는 사용자 가치.
2. **주요 요구사항** — 반드시 구현해야 하는 핵심 기능/조건.
3. **스코프** — In-Scope와 Out-of-Scope 항목 중 중요한 것.
4. **성공 기준** — 이 PRD가 성공했다고 볼 수 있는 측정 기준 또는 완료 조건.
5. **제약/리스크** — 명시된 기술 제약, 의존성, 주의해야 할 리스크 (해당될 때만).

금지 사항:
- PRD 원문을 그대로 복붙하는 bullet 금지
- 정보가 없는 항목을 억지로 채우거나 일반적인 말로 때우는 것 금지
` : ""}
공통 금지 사항:
- 티켓 제목을 그대로 반복하는 bullet 금지
- 정보가 없는 항목을 억지로 채우거나 일반적인 말로 때우는 것 금지
- "~를 개발합니다", "~를 구현합니다" 같은 서술형 종결 금지 (명사형 사용)
- [1단계] bullet 앞에 제목·레이블·서론·결론 출력 금지
- [2단계]의 "PRD 핵심:" 헤더 외의 추가 제목·레이블 출력 금지`;

  try {
    const client = new Anthropic({ apiKey: anthropicKey, maxRetries: 3 });
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const block = message.content[0];
    const text = block.type === "text" ? block.text.trim() : "";

    if (!text) {
      return NextResponse.json({ error: "요약 결과가 없습니다." }, { status: 500 });
    }

    return NextResponse.json({ summary: text, key });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ai-summary] Claude error:", msg);
    return NextResponse.json({ error: `AI 요약 실패: ${msg}` }, { status: 500 });
  }
}
