/**
 * Jira issue 에서 Weekly 공유사항 텍스트를 추출.
 *
 * 우선순위:
 *   1) description 에 [진행상황]/[일정]/[이슈·리스크]/[다음 액션] 마커가 있으면 description 사용
 *   2) comments 중 가장 최신 comment에 마커가 있으면 그 comment 사용
 *   3) 둘 다 없으면 null (skip)
 *
 * Jira Cloud v3 의 description / comment.body 는 ADF (Atlassian Document Format) JSON.
 * 우리는 plain text 만 필요하므로 ADF 의 모든 text 노드를 평탄화한다.
 */

const JIRA_HOST = "https://musinsa-oneteam.atlassian.net";
const FETCH_TIMEOUT_MS = 12_000;

const WEEKLY_MARKERS = ["[진행상황]", "[일정]", "[이슈/리스크]", "[이슈·리스크]", "[다음 액션]", "[다음액션]"];

/** ADF JSON 트리를 평탄화하여 plain text 로 변환 */
function flattenAdf(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(flattenAdf).join("");

  const n = node as Record<string, unknown>;
  const type = n.type as string | undefined;

  if (type === "text") return (n.text as string) ?? "";
  if (type === "hardBreak") return "\n";

  const content = Array.isArray(n.content) ? (n.content as unknown[]).map(flattenAdf).join("") : "";

  // 블록 레벨은 줄바꿈으로 구분
  if (type === "paragraph" || type === "heading" || type === "listItem" || type === "blockquote" || type === "codeBlock") {
    return content + "\n";
  }
  if (type === "bulletList" || type === "orderedList") {
    return content;
  }
  return content;
}

function hasWeeklyMarker(text: string): boolean {
  return WEEKLY_MARKERS.some((m) => text.includes(m));
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

export interface WeeklyFetchResult {
  weeklyText: string | null;
  source: "description" | "comment" | "none";
  commentAuthor?: string;
  commentCreated?: string;
}

export async function fetchWeeklyTextFromJira(ticketKey: string): Promise<WeeklyFetchResult> {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) {
    throw new Error("JIRA_EMAIL or JIRA_API_TOKEN missing");
  }
  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };

  // 1) Description (issue endpoint 가 가장 가볍게 description+comment 다 줌)
  const url = `${JIRA_HOST}/rest/api/3/issue/${encodeURIComponent(ticketKey)}?fields=description,comment`;
  const res = await fetchWithTimeout(url, { headers, cache: "no-store" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const fields = (data.fields as Record<string, unknown>) ?? {};

  // description 검사
  const descText = flattenAdf(fields.description).trim();
  if (descText && hasWeeklyMarker(descText)) {
    return { weeklyText: descText, source: "description" };
  }

  // 2) Comments 검사 — 최신부터
  const commentBlock = fields.comment as Record<string, unknown> | undefined;
  const comments = Array.isArray(commentBlock?.comments) ? (commentBlock!.comments as Array<Record<string, unknown>>) : [];
  // 최신 comment 가 배열 마지막. 역순으로 탐색.
  for (let i = comments.length - 1; i >= 0; i -= 1) {
    const c = comments[i];
    const body = flattenAdf(c.body).trim();
    if (body && hasWeeklyMarker(body)) {
      return {
        weeklyText: body,
        source: "comment",
        commentAuthor: ((c.author as Record<string, unknown>)?.displayName as string) ?? undefined,
        commentCreated: (c.created as string) ?? undefined,
      };
    }
  }

  return { weeklyText: null, source: "none" };
}
