/**
 * GET  /api/jira-filters          — 등록된 필터 목록 반환
 * GET  /api/jira-filters?preview=<filterId|filterUrl>  — Jira 필터 미리보기
 * POST /api/jira-filters          — 새 필터 등록
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { adminApiGuard } from "@/lib/auth/admin";
import { redis } from "@/lib/redis";
import type {
  AddFilterRequest,
  FilterPreview,
  JiraFilter,
  JiraFiltersStore,
} from "@/lib/filter-types";

export const dynamic = "force-dynamic";

const JIRA_BASE = "https://musinsa-oneteam.atlassian.net";

function jiraAuthHeader() {
  const email = process.env.JIRA_EMAIL ?? "";
  const token = process.env.JIRA_API_TOKEN ?? "";
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

/** Jira Filter URL 또는 숫자 ID에서 filterId 추출 */
function extractJiraFilterId(raw: string): string | null {
  const trimmed = raw.trim();
  // 순수 숫자
  if (/^\d+$/.test(trimmed)) return trimmed;
  // URL ?filter=12345 또는 ?filterId=12345
  const m = trimmed.match(/[?&]filter(?:Id)?=(\d+)/i);
  if (m) return m[1];
  return null;
}

/** 내부 filterID 생성 (충돌 가능성 극소) */
function generateFilterId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  const block = adminApiGuard(session?.user?.email);
  if (block) return block;

  const previewParam = req.nextUrl.searchParams.get("preview");

  // ?preview=<filterIdOrUrl> — Jira에서 필터 정보 미리 조회
  if (previewParam) {
    const jiraFilterId = extractJiraFilterId(previewParam);
    if (!jiraFilterId) {
      return NextResponse.json({ error: "유효하지 않은 Jira Filter ID입니다." }, { status: 400 });
    }

    try {
      // 필터 메타 조회
      const metaRes = await fetch(
        `${JIRA_BASE}/rest/api/3/filter/${jiraFilterId}`,
        { headers: { Authorization: jiraAuthHeader(), Accept: "application/json" } }
      );
      if (!metaRes.ok) {
        const msg = metaRes.status === 404 ? "필터를 찾을 수 없습니다." : `Jira API 오류 (${metaRes.status})`;
        return NextResponse.json({ error: msg }, { status: metaRes.status });
      }
      const meta = await metaRes.json() as { name: string; jql: string };

      // 예상 티켓 수 조회
      const countRes = await fetch(
        `${JIRA_BASE}/rest/api/3/search/jql?jql=${encodeURIComponent(`filter = ${jiraFilterId}`)}&maxResults=0`,
        { headers: { Authorization: jiraAuthHeader(), Accept: "application/json" } }
      );
      const countData = countRes.ok ? (await countRes.json() as { total?: number }) : { total: null };

      const preview: FilterPreview = {
        jiraFilterId,
        name: meta.name,
        jql: meta.jql,
        estimatedCount: countData.total ?? 0,
      };
      return NextResponse.json(preview);
    } catch (e) {
      console.error("[jira-filters GET preview]", e);
      return NextResponse.json({ error: "Jira 연결 오류" }, { status: 502 });
    }
  }

  // 기본: 등록된 필터 목록
  try {
    const store = (await redis.get<JiraFiltersStore>("cc-jira-filters")) ?? {};
    const filters = Object.values(store).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return NextResponse.json({ filters });
  } catch (e) {
    console.error("[jira-filters GET]", e);
    return NextResponse.json({ error: "KV 읽기 오류" }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  const block = adminApiGuard(session?.user?.email);
  if (block) return block;

  let body: AddFilterRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const { filterIdOrUrl, label } = body;
  if (!filterIdOrUrl?.trim()) {
    return NextResponse.json({ error: "filterIdOrUrl은 필수입니다." }, { status: 400 });
  }

  const jiraFilterId = extractJiraFilterId(filterIdOrUrl);
  if (!jiraFilterId) {
    return NextResponse.json({ error: "유효하지 않은 Jira Filter ID 또는 URL입니다." }, { status: 400 });
  }

  // Jira에서 필터 검증
  let filterMeta: { name: string; jql: string };
  try {
    const res = await fetch(
      `${JIRA_BASE}/rest/api/3/filter/${jiraFilterId}`,
      { headers: { Authorization: jiraAuthHeader(), Accept: "application/json" } }
    );
    if (!res.ok) {
      const msg = res.status === 404 ? "Jira에서 필터를 찾을 수 없습니다." : `Jira API 오류 (${res.status})`;
      return NextResponse.json({ error: msg }, { status: res.status });
    }
    filterMeta = await res.json() as { name: string; jql: string };
  } catch (e) {
    console.error("[jira-filters POST] Jira fetch error", e);
    return NextResponse.json({ error: "Jira 연결 오류" }, { status: 502 });
  }

  // 기존 등록 여부 확인 (jiraFilterId 중복)
  const store = (await redis.get<JiraFiltersStore>("cc-jira-filters")) ?? {};
  const existing = Object.values(store).find((f) => f.jiraFilterId === jiraFilterId);
  if (existing) {
    return NextResponse.json(
      { error: `이미 등록된 필터입니다. (${existing.label ?? existing.name})` },
      { status: 409 }
    );
  }

  const newFilter: JiraFilter = {
    id: generateFilterId(),
    jiraFilterId,
    name: filterMeta.name,
    jql: filterMeta.jql,
    label: label?.trim() || undefined,
    createdAt: new Date().toISOString(),
    lastSyncAt: null,
    lastSyncCount: null,
    lastSyncError: null,
  };

  store[newFilter.id] = newFilter;
  await redis.set("cc-jira-filters", store);

  return NextResponse.json({ filter: newFilter }, { status: 201 });
}
