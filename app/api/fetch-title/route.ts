/**
 * GET /api/fetch-title?url=...
 *
 * URL 종류에 따라 실제 문서 제목을 반환
 * - Confluence 페이지: /wiki/spaces/SPACE/pages/ID/... → content API
 * - Confluence 스페이스 overview: /wiki/spaces/SPACE/overview → space API
 * - Google Drive/Docs/Sheets: URL 파싱 fallback
 * - 그 외: <title> 태그 파싱 시도 → fallback
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const FETCH_TIMEOUT_MS = 8_000;

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** URL 파싱 기반 fallback 제목 추출 */
function extractFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    // Confluence: /wiki/spaces/SPACE/pages/ID/Page+Title
    const pagesIdx = segments.indexOf("pages");
    if (pagesIdx !== -1 && segments.length > pagesIdx + 2) {
      return decodeURIComponent(segments[pagesIdx + 2]).replace(/\+/g, " ");
    }
    const last = segments[segments.length - 1];
    return last ? decodeURIComponent(last).replace(/[_+\-]/g, " ").trim() : url;
  } catch {
    return url;
  }
}

/** Confluence 인증 헤더 */
function confluenceAuth(): Record<string, string> | null {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) return null;
  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  return { Authorization: `Basic ${auth}`, Accept: "application/json" };
}

/** /wiki/spaces/SPACE_KEY/pages/PAGE_ID/... → PAGE_ID 추출 */
function extractPageId(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const pagesIdx = segments.indexOf("pages");
  if (pagesIdx !== -1 && segments[pagesIdx + 1]) {
    const id = segments[pagesIdx + 1];
    if (/^\d+$/.test(id)) return id;
  }
  return null;
}

/** /wiki/spaces/SPACE_KEY/overview 또는 /wiki/spaces/SPACE_KEY → SPACE_KEY 추출 */
function extractSpaceKey(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const spacesIdx = segments.indexOf("spaces");
  if (spacesIdx !== -1 && segments[spacesIdx + 1]) {
    return segments[spacesIdx + 1];
  }
  return null;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url 파라미터 필요" }, { status: 400 });

  try {
    const u = new URL(url);
    const hostname = u.hostname;
    const pathname = u.pathname;

    // ── Confluence ──────────────────────────────────────────────────────
    // wiki.team.musinsa.com은 커스텀 도메인 — 실제 API는 atlassian.net에서 처리
    if (hostname.includes("atlassian.net") || hostname.includes("musinsa")) {
      const headers = confluenceAuth();
      // 커스텀 도메인이면 atlassian.net으로 리디렉트
      const apiBase = hostname.includes("atlassian.net")
        ? `https://${hostname}`
        : "https://musinsa-oneteam.atlassian.net";

      if (headers) {
        // 1) 페이지 ID가 있으면 content API
        const pageId = extractPageId(pathname) ?? u.searchParams.get("pageId");
        if (pageId && /^\d+$/.test(pageId)) {
          const res = await fetchWithTimeout(
            `${apiBase}/wiki/rest/api/content/${pageId}?expand=title`,
            { headers }
          );
          if (res.ok) {
            const data = await res.json();
            if (data.title) return NextResponse.json({ title: data.title });
          }
        }

        // 2) overview 또는 스페이스 홈 → space API로 스페이스 이름 반환
        const spaceKey = extractSpaceKey(pathname);
        if (spaceKey) {
          const res = await fetchWithTimeout(
            `${apiBase}/wiki/rest/api/space/${spaceKey}`,
            { headers }
          );
          if (res.ok) {
            const data = await res.json();
            if (data.name) return NextResponse.json({ title: `${data.name} (스페이스)` });
          }
        }
      }

      // URL 파싱 fallback
      return NextResponse.json({ title: extractFromUrl(url) });
    }

    // ── Google Drive / Docs / Sheets / Slides ───────────────────────────
    if (hostname.includes("google.com")) {
      return NextResponse.json({ title: extractFromUrl(url) });
    }

    // ── 그 외: HTML <title> 파싱 시도 ───────────────────────────────────
    try {
      const res = await fetchWithTimeout(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; bot)" },
      });
      if (res.ok) {
        const html = await res.text();
        const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (match?.[1]) {
          return NextResponse.json({ title: match[1].trim().replace(/\s+/g, " ") });
        }
      }
    } catch {}

    return NextResponse.json({ title: extractFromUrl(url) });

  } catch {
    return NextResponse.json({ title: extractFromUrl(url) });
  }
}
