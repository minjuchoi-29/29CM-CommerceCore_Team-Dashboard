/**
 * Confluence storage XML 유틸리티.
 *
 * Confluence REST API v1 의 body.storage.value 는 storage XML 형식
 * (HTML 비슷한 Atlassian 확장 + macro). plain text 로 변환 후
 * ticket key 검색 / surrounding snippet 추출을 위한 helper.
 *
 * PR-Y 범위: read-only. write/append 없음.
 */

/**
 * Storage XML → plain text.
 *
 * 변환 규칙 (`app/api/ai-summary/route.ts` 와 동일 패턴):
 *  - <ac:structured-macro>...</ac:structured-macro> 제거 (macro body)
 *  - <ac:.../> self-closing 제거
 *  - <h1-6> → "## " (heading marker, snippet 가독성 보존)
 *  - <li> → "• " 접두
 *  - <br> / <p> → 줄바꿈
 *  - 나머지 태그 strip
 *  - HTML entity 디코드
 *  - 3+ 연속 줄바꿈 → 2개
 */
export function storageToText(html: string): string {
  if (typeof html !== "string" || html.length === 0) return "";
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

const TICKET_KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/g;

/**
 * 텍스트에서 Jira ticket key 패턴 (PROJECT-NUMBER) 검색.
 * 같은 key 중복 제거. 정렬 없음 (원문 순서 유지).
 *
 * @param text storageToText() 결과
 * @returns 발견된 ticket key 배열
 */
export function findTicketKeys(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const matches = text.match(TICKET_KEY_RE) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

/**
 * 특정 ticket key 가 텍스트에 존재하는지.
 * word boundary 기반 (CMALL-78 이 CMALL-784 에 매칭되지 않도록).
 */
export function hasTicketKey(text: string, ticketKey: string): boolean {
  if (typeof text !== "string" || typeof ticketKey !== "string") return false;
  if (text.length === 0 || ticketKey.length === 0) return false;
  // 사용자 입력을 안전하게 escape (RegExp metacharacter)
  const escaped = ticketKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

/**
 * ticket key 위치 기준 ±radius 자 surrounding snippet 추출.
 *
 *  - 첫 번째 발견 위치를 중심으로 (앞/뒤 radius 자)
 *  - 시작/끝에 ellipsis "…" 추가 (단, 본문 경계면 생략)
 *  - 줄바꿈은 보존 (snippet 다중 줄 OK)
 *
 * @param text storageToText() 결과
 * @param ticketKey 검색할 key
 * @param radius 앞뒤 글자 수 (기본 200)
 * @returns snippet 또는 null (미발견 시)
 */
export function extractSnippet(text: string, ticketKey: string, radius = 200): string | null {
  if (typeof text !== "string" || text.length === 0) return null;
  if (typeof ticketKey !== "string" || ticketKey.length === 0) return null;
  const escaped = ticketKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`);
  const m = re.exec(text);
  if (!m) return null;

  const idx = m.index;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + ticketKey.length + radius);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet.trim();
}
