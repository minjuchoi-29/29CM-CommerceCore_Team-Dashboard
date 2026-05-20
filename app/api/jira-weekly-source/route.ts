import { NextRequest, NextResponse } from "next/server";
import { parseWeekly } from "@/lib/weekly-parser";

export const dynamic = "force-dynamic";

const JIRA_HOST = "https://musinsa-oneteam.atlassian.net";
const FETCH_TIMEOUT_MS = 15_000;

// ─── ADF → plain text ─────────────────────────────────────────
// Atlassian Document Format은 ProseMirror-like JSON. 텍스트 노드만 합치고
// block-level 노드는 줄바꿈으로 구분해 marker 매칭이 가능한 형태로 평탄화.

type AdfNode = {
  type?: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
};

const BLOCK_TYPES = new Set([
  "paragraph", "heading", "codeBlock", "blockquote",
  "rule", "panel", "expand", "nestedExpand", "mediaSingle",
]);

function adfToText(node: AdfNode | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";

  const inner = Array.isArray(node.content)
    ? node.content.map(adfToText).join("")
    : "";

  if (node.type === "listItem") return `- ${inner.trim()}\n`;
  if (node.type === "tableRow") return inner.replace(/\n+/g, " | ") + "\n";
  if (node.type && BLOCK_TYPES.has(node.type)) return inner + "\n";
  return inner;
}

// ─── Marker 정의 ──────────────────────────────────────────────
const MARKER_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "주차_Weekly_공유사항", re: /\d+\s*주차\s*Weekly\s*공유사항/i },
  { name: "[진행상황]",         re: /\[\s*진행\s*상황\s*\]/ },
  { name: "[일정]",             re: /\[\s*일정\s*\]/ },
  { name: "[이슈/리스크]",      re: /\[\s*이슈\s*[/··]\s*리스크\s*\]/ },
  { name: "[다음 액션]",        re: /\[\s*다음\s*액션\s*\]/ },
];

function findMarkers(text: string): string[] {
  const out: string[] = [];
  for (const m of MARKER_PATTERNS) {
    if (m.re.test(text)) out.push(m.name);
  }
  return out;
}

// ─── Jira fetch helper ───────────────────────────────────────
async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type JiraComment = {
  id: string;
  body: AdfNode;
  created: string;
  updated: string;
  author?: { displayName?: string };
};

// ─── 메인 ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const key = (req.nextUrl.searchParams.get("key") ?? "").trim().toUpperCase();
  if (!key || !/^[A-Z][A-Z0-9]*-\d+$/.test(key)) {
    return NextResponse.json(
      { error: "유효한 티켓 키가 필요합니다. 예: TM-1234" },
      { status: 400 },
    );
  }

  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) {
    return NextResponse.json(
      { error: "JIRA_EMAIL 또는 JIRA_API_TOKEN 환경변수가 없습니다." },
      { status: 500 },
    );
  }

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };

  try {
    // 1) description + updated
    const issueUrl =
      `${JIRA_HOST}/rest/api/3/issue/${encodeURIComponent(key)}` +
      `?fields=description,updated`;
    const issueRes = await fetchWithTimeout(issueUrl, { headers, cache: "no-store" });
    if (!issueRes.ok) {
      const body = await issueRes.text();
      return NextResponse.json(
        { error: `Jira issue API ${issueRes.status}: ${body.slice(0, 300)}` },
        { status: issueRes.status === 404 ? 404 : 502 },
      );
    }
    const issueData = await issueRes.json();
    const descAdf = (issueData.fields?.description ?? null) as AdfNode | null;
    const descText = adfToText(descAdf).trim();
    const descUpdated = (issueData.fields?.updated as string | undefined) ?? "";
    const descMarkers = descText ? findMarkers(descText) : [];

    // 2) comments — 최신순 (Jira는 기본 created asc, 최근 N개만 보려면 orderBy=-created)
    const commentUrl =
      `${JIRA_HOST}/rest/api/3/issue/${encodeURIComponent(key)}/comment` +
      `?orderBy=-created&maxResults=20`;
    const commentRes = await fetchWithTimeout(commentUrl, { headers, cache: "no-store" });
    if (!commentRes.ok) {
      const body = await commentRes.text();
      return NextResponse.json(
        { error: `Jira comment API ${commentRes.status}: ${body.slice(0, 300)}` },
        { status: 502 },
      );
    }
    const commentData = await commentRes.json();
    const comments = (commentData.comments ?? []) as JiraComment[];

    // marker 있는 최신 comment 탐색 (이미 -created 정렬)
    let markedComment:
      | { text: string; updated: string; created: string; author: string; markers: string[] }
      | null = null;
    for (const c of comments) {
      const t = adfToText(c.body).trim();
      if (!t) continue;
      const ms = findMarkers(t);
      if (ms.length > 0) {
        markedComment = {
          text: t,
          updated: c.updated,
          created: c.created,
          author: c.author?.displayName ?? "-",
          markers: ms,
        };
        break;
      }
    }

    // ─── 우선순위 결정 (2026-05-20 정책 변경) ───────────────────
    // 운영 흐름:
    //   - description = 현재 주차 working area (PM이 매주 월/화 직접 수정)
    //   - automation comment = append-only weekly history (cascade archive 후 description reset)
    // 따라서:
    //   1) description에 marker 있음  → description = current SoT
    //   2) 없으면 comment에 marker 있음 → historical fallback (transition 기간 대응)
    //   3) 둘 다 없으면 null
    type Pick = {
      text: string;
      source: "description" | "comment";
      sourceUpdatedAt: string;
      markers: string[];
      policyReason: "description-first" | "comment-fallback";
    };

    const descCandidate: Pick | null = descMarkers.length > 0 && descText
      ? {
          text: descText,
          source: "description",
          sourceUpdatedAt: descUpdated,
          markers: descMarkers,
          policyReason: "description-first",
        }
      : null;

    const commentCandidate: Pick | null = markedComment
      ? {
          text: markedComment.text,
          source: "comment",
          sourceUpdatedAt: markedComment.updated,
          markers: markedComment.markers,
          policyReason: "comment-fallback",
        }
      : null;

    // description-first: description marker 있으면 무조건 description.
    // updatedAt 비교 없음 — description이 가장 최근 working area라는 운영 약속이 우선.
    const pick: Pick | null = descCandidate ?? commentCandidate;

    // ─── 파싱 결과 (선택) — text가 있으면 parseWeekly 실행 ───────
    const parsed = pick ? parseWeekly(pick.text, key) : null;
    const parseSummary = parsed ? {
      sourceWeek: parsed.sourceWeek,
      schedulesCount: parsed.scheduleItems.length,
      progressCount: parsed.progressItems.length,
      risksCount: parsed.risks.length,
      actionsCount: parsed.nextActions.length,
      noIssues: parsed.noIssues,
      sectionsFound: parsed.debug?.sectionsFound ?? [],
      ignoredLines: parsed.debug?.ignoredLines ?? [],
      warnings: parsed.debug?.warnings ?? [],
    } : null;

    return NextResponse.json({
      ticketKey: key,
      text: pick?.text ?? null,
      source: pick?.source ?? null,
      policyReason: pick ? pick.policyReason : null,
      sourceUpdatedAt: pick?.sourceUpdatedAt ?? null,
      foundMarker: pick !== null,
      markers: pick?.markers ?? [],
      parsed,
      parseSummary,
      debug: {
        descriptionLength: descText.length,
        descriptionHasMarker: descMarkers.length > 0,
        descriptionMarkers: descMarkers,
        descriptionPreview: descText.slice(0, 200),
        descriptionUpdated: descUpdated,
        commentCount: comments.length,
        markedCommentFound: !!markedComment,
        markedCommentMarkers: markedComment?.markers ?? [],
        markedCommentUpdated: markedComment?.updated ?? null,
        markedCommentAuthor: markedComment?.author ?? null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `요청 실패: ${msg}` }, { status: 500 });
  }
}
