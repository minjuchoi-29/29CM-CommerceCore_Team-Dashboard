/**
 * Phase B — ETR 상태 업데이트 댓글 작성 API.
 *
 * GET  /api/jira/comment?issueKey=ETR-X&marker=...
 *   Jira 의 comment list 를 받아 marker 가 포함된 comment 존재 여부 + lastCommentedAt 반환.
 *   KV miss 시 fallback dedupe 용도.
 *
 * POST /api/jira/comment
 *   body: { issueKey, text, marker? }
 *   text + marker 를 ADF 로 변환하여 Jira issue 에 comment 작성.
 *   환경 변수 JIRA_DRY_RUN=true 이면 실제 호출 대신 mock 응답 (Phase B-1 검증용).
 *
 * 인증: Basic Auth (JIRA_EMAIL / JIRA_API_TOKEN). read API 와 동일 패턴.
 * 본 PR 에서는 lib/jira-client.ts 추출 보류 — inline.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildCommentBody, findMarkerInADF } from "@/lib/jira-adf";

const JIRA_HOST = "https://musinsa-oneteam.atlassian.net";
const FETCH_TIMEOUT_MS = 15_000;
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

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

/** Jira HTTP status → app status + 한국어 메시지 매핑. */
function mapJiraError(status: number): { status: number; error: string } {
  if (status === 401) return { status: 502, error: "Jira 인증 실패. 관리자에게 문의해주세요." };
  if (status === 403) return { status: 502, error: "Jira 댓글 작성 권한이 없습니다." };
  if (status === 404) return { status: 404, error: "ETR 티켓을 찾을 수 없습니다." };
  if (status >= 500) return { status: 502, error: "Jira 서버 오류." };
  return { status: 502, error: `Jira 호출 실패: status ${status}` };
}

// ─── GET ────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const issueKey = req.nextUrl.searchParams.get("issueKey")?.trim() ?? "";
  const marker = req.nextUrl.searchParams.get("marker")?.trim() ?? "";

  if (!issueKey || !ISSUE_KEY_RE.test(issueKey)) {
    return NextResponse.json({ error: "issueKey 가 잘못되었습니다." }, { status: 400 });
  }
  if (!marker) {
    return NextResponse.json({ error: "marker 가 필요합니다." }, { status: 400 });
  }

  const auth = jiraAuthHeader();
  if (!auth) {
    return NextResponse.json(
      { error: "JIRA_EMAIL 또는 JIRA_API_TOKEN 환경변수가 없습니다." },
      { status: 500 },
    );
  }

  const url = `${JIRA_HOST}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?orderBy=-created`;
  try {
    const res = await fetchWithTimeout(url, {
      method: "GET",
      headers: { Authorization: auth, Accept: "application/json" },
    });
    if (!res.ok) {
      const mapped = mapJiraError(res.status);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const data = await res.json() as { comments?: Array<{ id: string; body?: unknown; created?: string }> };
    const comments = data.comments ?? [];
    for (const c of comments) {
      if (findMarkerInADF(c.body, marker)) {
        return NextResponse.json({
          exists: true,
          matchedCommentId: c.id,
          lastCommentedAt: c.created ?? null,
        });
      }
    }
    return NextResponse.json({ exists: false });
  } catch (e) {
    const isAbort = e instanceof Error && e.name === "AbortError";
    if (isAbort) {
      return NextResponse.json({ error: "Jira 응답 시간 초과." }, { status: 504 });
    }
    console.error("[jira-comment GET]", e);
    return NextResponse.json({ error: "Jira 호출 실패." }, { status: 502 });
  }
}

// ─── POST ───────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 파싱 실패." }, { status: 400 });
  }

  const { issueKey, text, marker } = (body ?? {}) as {
    issueKey?: string; text?: string; marker?: string;
  };
  if (!issueKey || !ISSUE_KEY_RE.test(issueKey)) {
    return NextResponse.json({ error: "issueKey 가 잘못되었습니다." }, { status: 400 });
  }
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "text 가 필요합니다." }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: "댓글 본문이 너무 깁니다 (max 4000자)." }, { status: 400 });
  }

  const adfBody = buildCommentBody(text, marker);

  // Phase B-1: dry-run 모드 — 실제 호출 없이 mock 응답
  if (process.env.JIRA_DRY_RUN === "true") {
    console.log("[jira-comment dry-run]", { issueKey, marker, textPreview: text.slice(0, 100) });
    return NextResponse.json({
      ok: true,
      dryRun: true,
      commentId: `dry-run-${Date.now()}`,
      createdAt: new Date().toISOString(),
    });
  }

  const auth = jiraAuthHeader();
  if (!auth) {
    return NextResponse.json(
      { error: "JIRA_EMAIL 또는 JIRA_API_TOKEN 환경변수가 없습니다." },
      { status: 500 },
    );
  }

  const url = `${JIRA_HOST}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`;
  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: auth,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: adfBody }),
    });
    if (!res.ok) {
      const mapped = mapJiraError(res.status);
      console.error("[jira-comment POST]", { issueKey, status: res.status });
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    const data = await res.json() as { id?: string; created?: string };
    return NextResponse.json({
      ok: true,
      commentId: data.id ?? null,
      createdAt: data.created ?? new Date().toISOString(),
    });
  } catch (e) {
    const isAbort = e instanceof Error && e.name === "AbortError";
    if (isAbort) {
      return NextResponse.json({ error: "Jira 응답 시간 초과." }, { status: 504 });
    }
    console.error("[jira-comment POST]", e);
    return NextResponse.json({ error: "Jira 호출 실패." }, { status: 502 });
  }
}
