/**
 * Confluence Cloud REST API v1 client helpers.
 *
 * 인증 / base URL / fetch timeout 을 한곳에 두어 신규 confluence route 들이
 * 재사용. 기존 ai-summary / fetch-title 의 inline 패턴은 본 PR 에서 건드리지
 * 않음 (PR-Y 범위: 신규 파일만).
 *
 * Auth: JIRA_EMAIL / JIRA_API_TOKEN (Atlassian Cloud unified).
 * Base: https://musinsa-oneteam.atlassian.net
 */

export const CONFLUENCE_BASE = "https://musinsa-oneteam.atlassian.net";
export const CONFLUENCE_FETCH_TIMEOUT_MS = 15_000;

/**
 * Basic Auth header. env 누락 시 null 반환 → 호출부가 명확한 500 응답.
 */
export function confluenceAuthHeader(): string | null {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) return null;
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

/**
 * Timeout 가드 포함 fetch wrapper.
 */
export async function confluenceFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFLUENCE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Confluence HTTP status → app status + 한국어 메시지.
 * remote-links / jira-comment route 패턴과 동일.
 */
export function mapConfluenceError(status: number): { status: number; error: string } {
  if (status === 401) return { status: 502, error: "Confluence 인증 실패." };
  if (status === 403) return { status: 502, error: "Confluence 권한이 없습니다." };
  if (status === 404) return { status: 404, error: "Confluence 페이지를 찾을 수 없습니다." };
  if (status >= 500) return { status: 502, error: "Confluence 서버 오류." };
  return { status: 502, error: `Confluence 호출 실패: status ${status}` };
}
