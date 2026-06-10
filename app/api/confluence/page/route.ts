/**
 * PR-Y: Confluence page fetch endpoint.
 *
 * GET /api/confluence/page?pageId=410847151[&ticketKey=CMALL-784][&refresh=true]
 *
 * 동작:
 *  1) KV cc-confluence-page-cache 조회 — 2h 이내면 cache hit 즉시 반환
 *  2) miss / TTL 만료 / refresh=true → Confluence GET 호출
 *     GET /wiki/rest/api/content/{pageId}?expand=body.storage,title,space,version
 *  3) body.storage.value → storageToText() → plain text
 *  4) ticketKey 가 있으면 hasTicketKey / extractSnippet
 *  5) findTicketKeys 로 matchedKeys 전체 추출 (UI 확장 대비)
 *  6) KV 저장 (best-effort)
 *
 * 응답:
 * {
 *   title: string,
 *   exists: boolean,        // ticketKey 미제공 시 false
 *   snippet?: string,       // ticketKey 발견 시 surrounding ±200자
 *   matchedKeys: string[],  // 본문에 등장한 모든 Jira key
 *   cachedAt: ISO,
 *   fromCache: boolean,
 * }
 *
 * 인증: Basic Auth (JIRA_EMAIL / JIRA_API_TOKEN) — Atlassian Cloud unified.
 * 본 PR 에서는 UI 변경 / write API 모두 없음. read-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import {
  storageToText,
  findTicketKeys,
  hasTicketKey,
  extractSnippet,
} from "@/lib/confluence-storage";
import {
  CONFLUENCE_BASE,
  confluenceAuthHeader,
  confluenceFetch,
  mapConfluenceError,
} from "@/lib/confluence-client";

export const dynamic = "force-dynamic";

const KV_KEY = "cc-confluence-page-cache";
const TTL_MS = 2 * 60 * 60 * 1000; // 2h — 페이지 변경 빈도 낮음
const PAGE_ID_RE = /^\d+$/;
const TICKET_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

type CacheEntry = {
  pageId: string;
  title: string;
  content: string;
  matchedKeys: string[];
  fetchedAt: string;
};
type CacheMap = Record<string, CacheEntry>;

function isFresh(entry: CacheEntry | undefined): boolean {
  if (!entry?.fetchedAt) return false;
  const ms = Date.parse(entry.fetchedAt);
  if (Number.isNaN(ms)) return false;
  return Date.now() - ms < TTL_MS;
}

export async function GET(req: NextRequest) {
  const pageId = req.nextUrl.searchParams.get("pageId")?.trim() ?? "";
  const ticketKey = req.nextUrl.searchParams.get("ticketKey")?.trim() ?? "";
  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "true";

  if (!pageId || !PAGE_ID_RE.test(pageId)) {
    return NextResponse.json(
      { error: "pageId 가 잘못되었습니다 (숫자만)." },
      { status: 400 },
    );
  }
  if (ticketKey && !TICKET_KEY_RE.test(ticketKey)) {
    return NextResponse.json(
      { error: "ticketKey 가 잘못되었습니다." },
      { status: 400 },
    );
  }

  // 1. KV cache lookup
  let cache: CacheMap = {};
  try {
    const raw = await redis.get<CacheMap>(KV_KEY);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      cache = raw;
    }
  } catch (e) {
    console.warn("[confluence-page cache get]", e);
  }

  let entry = cache[pageId];
  let fromCache = true;

  // 2. cache miss / refresh → Confluence API
  if (forceRefresh || !isFresh(entry)) {
    fromCache = false;
    const auth = confluenceAuthHeader();
    if (!auth) {
      return NextResponse.json(
        { error: "JIRA_EMAIL 또는 JIRA_API_TOKEN 환경변수가 없습니다." },
        { status: 500 },
      );
    }

    const url = `${CONFLUENCE_BASE}/wiki/rest/api/content/${encodeURIComponent(pageId)}?expand=body.storage,title,space,version`;
    try {
      const res = await confluenceFetch(url, {
        method: "GET",
        headers: { Authorization: auth, Accept: "application/json" },
      });
      if (!res.ok) {
        const mapped = mapConfluenceError(res.status);
        return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      }
      const data = await res.json() as {
        title?: string;
        body?: { storage?: { value?: string } };
      };
      const title = data.title ?? "";
      const rawStorage = data.body?.storage?.value ?? "";
      const content = storageToText(rawStorage);
      const matchedKeys = findTicketKeys(content);

      entry = {
        pageId,
        title,
        content,
        matchedKeys,
        fetchedAt: new Date().toISOString(),
      };

      // 3. KV write (best-effort)
      const nextCache: CacheMap = { ...cache, [pageId]: entry };
      try {
        await redis.set(KV_KEY, nextCache);
      } catch (e) {
        console.warn("[confluence-page cache set]", e);
      }
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      if (isAbort) {
        return NextResponse.json({ error: "Confluence 응답 시간 초과." }, { status: 504 });
      }
      console.error("[confluence-page GET]", e);
      return NextResponse.json({ error: "Confluence 호출 실패." }, { status: 502 });
    }
  }

  // 4. ticketKey 검색
  const exists = ticketKey ? hasTicketKey(entry.content, ticketKey) : false;
  const snippet = exists ? (extractSnippet(entry.content, ticketKey, 200) ?? undefined) : undefined;

  return NextResponse.json({
    title: entry.title,
    exists,
    snippet,
    matchedKeys: entry.matchedKeys,
    cachedAt: entry.fetchedAt,
    fromCache,
  });
}
