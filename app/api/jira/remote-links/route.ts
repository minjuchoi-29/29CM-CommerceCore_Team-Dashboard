/**
 * PR-A: Jira Remote Links (Web Links) lazy fetch endpoint.
 *
 * GET /api/jira/remote-links?issueKey=ETR-X[&refresh=true]
 *  → { links: JiraRemoteLink[], cachedAt: ISO, fromCache: boolean }
 *
 * 동작:
 *  1) KV (cc-remote-links-cache) 조회 — 1h 이내면 그대로 반환 (fromCache: true)
 *  2) miss / refresh=true / TTL 만료 → Jira API 호출
 *     GET /rest/api/3/issue/{key}/remotelink
 *  3) 응답을 normalizeRemoteLinks() 로 정리 → KV 저장 → 반환 (fromCache: false)
 *
 * 인증: Basic Auth (JIRA_EMAIL / JIRA_API_TOKEN) — 다른 read endpoint 와 동일.
 * lib/jira-client.ts 추출은 별도 task — 본 PR 은 inline.
 */

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { normalizeRemoteLinks, type JiraRemoteLink } from "@/lib/jira-remotelinks";

export const dynamic = "force-dynamic";

const JIRA_HOST = "https://musinsa-oneteam.atlassian.net";
const FETCH_TIMEOUT_MS = 15_000;
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;
const KV_KEY = "cc-remote-links-cache";
const TTL_MS = 60 * 60 * 1000; // 1h

type CacheEntry = { fetchedAt: string; links: JiraRemoteLink[] };
type CacheMap = Record<string, CacheEntry>;

function jiraAuthHeader(): string | null {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) return null;
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
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

function isFresh(entry: CacheEntry | undefined): boolean {
  if (!entry?.fetchedAt) return false;
  const fetchedMs = Date.parse(entry.fetchedAt);
  if (Number.isNaN(fetchedMs)) return false;
  return Date.now() - fetchedMs < TTL_MS;
}

function mapJiraError(status: number): { status: number; error: string } {
  if (status === 401) return { status: 502, error: "Jira 인증 실패." };
  if (status === 403) return { status: 502, error: "Jira 권한이 없습니다." };
  if (status === 404) return { status: 404, error: "티켓을 찾을 수 없습니다." };
  if (status >= 500) return { status: 502, error: "Jira 서버 오류." };
  return { status: 502, error: `Jira 호출 실패: status ${status}` };
}

export async function GET(req: NextRequest) {
  const issueKey = req.nextUrl.searchParams.get("issueKey")?.trim() ?? "";
  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "true";

  if (!issueKey || !ISSUE_KEY_RE.test(issueKey)) {
    return NextResponse.json({ error: "issueKey 가 잘못되었습니다." }, { status: 400 });
  }

  // 1. KV cache lookup
  let cache: CacheMap = {};
  try {
    const raw = await redis.get<CacheMap>(KV_KEY);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      cache = raw;
    }
  } catch (e) {
    console.warn("[remote-links cache get]", e);
  }

  if (!forceRefresh && isFresh(cache[issueKey])) {
    const entry = cache[issueKey];
    return NextResponse.json({
      links: entry.links,
      cachedAt: entry.fetchedAt,
      fromCache: true,
    });
  }

  // 2. Jira API
  const auth = jiraAuthHeader();
  if (!auth) {
    return NextResponse.json(
      { error: "JIRA_EMAIL 또는 JIRA_API_TOKEN 환경변수가 없습니다." },
      { status: 500 },
    );
  }

  const url = `${JIRA_HOST}/rest/api/3/issue/${encodeURIComponent(issueKey)}/remotelink`;
  let raw: unknown;
  try {
    const res = await fetchWithTimeout(url, {
      method: "GET",
      headers: { Authorization: auth, Accept: "application/json" },
    });
    if (!res.ok) {
      const mapped = mapJiraError(res.status);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    raw = await res.json();
  } catch (e) {
    const isAbort = e instanceof Error && e.name === "AbortError";
    if (isAbort) {
      return NextResponse.json({ error: "Jira 응답 시간 초과." }, { status: 504 });
    }
    console.error("[remote-links GET]", e);
    return NextResponse.json({ error: "Jira 호출 실패." }, { status: 502 });
  }

  const links = normalizeRemoteLinks(raw);
  const now = new Date().toISOString();

  // 3. KV write (best-effort)
  const nextCache: CacheMap = { ...cache, [issueKey]: { fetchedAt: now, links } };
  try {
    await redis.set(KV_KEY, nextCache);
  } catch (e) {
    console.warn("[remote-links cache set]", e);
  }

  return NextResponse.json({
    links,
    cachedAt: now,
    fromCache: false,
  });
}
