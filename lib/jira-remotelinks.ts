/**
 * Jira Remote Links (Web Links) helpers.
 *
 * Jira API: GET /rest/api/3/issue/{issueIdOrKey}/remotelink
 * 응답은 array of { id, self, object: { url, title, summary, icon } }.
 *
 * Dashboard 는 url + title 만 필요. 본 헬퍼는 응답을 정규화하고
 * 중복 / 빈 URL 케이스를 안전하게 처리한다.
 */

export type JiraRemoteLink = { url: string; title: string };

/** URL 정규화 — 비교용. trim + lowercase + trailing slash 제거. */
function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** URL 에서 fallback title 추출 (path 마지막 segment 또는 host). */
function fallbackTitle(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(last || u.hostname);
  } catch {
    return url;
  }
}

/**
 * Jira API 의 remotelink array → 정규화된 RemoteLink[].
 *
 * 규칙:
 *  - object.url 없거나 빈 문자열 → skip
 *  - object.title 없으면 URL 에서 fallback
 *  - 같은 URL 중복은 첫 번째만 유지 (title 보존)
 *  - 잘못된 형태의 항목 (object 없음, 배열 아님 등) → skip
 */
export function normalizeRemoteLinks(raw: unknown): JiraRemoteLink[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: JiraRemoteLink[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = (item as { object?: unknown }).object;
    if (!obj || typeof obj !== "object") continue;
    const url = (obj as { url?: unknown }).url;
    const title = (obj as { title?: unknown }).title;
    if (typeof url !== "string" || url.trim().length === 0) continue;

    const key = normalizeUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      url: url.trim(),
      title: typeof title === "string" && title.trim().length > 0
        ? title.trim()
        : fallbackTitle(url),
    });
  }

  return out;
}
