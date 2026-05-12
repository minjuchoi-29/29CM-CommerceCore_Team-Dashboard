/**
 * POST /api/tickets  { action: "add", key: "TM-1234" }
 * POST /api/tickets  { action: "remove", key: "TM-1234" }
 *
 * tickets-data.ts의 TICKET_KEYS 배열을 GitHub API로 직접 수정 + 커밋
 * → Vercel 자동 배포로 영구 반영 (KV 의존 없음, 데이터 유실 없음)
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN!;
const GITHUB_OWNER  = "minjuchoi-29";
const GITHUB_REPO   = "29CM-CommerceCore_Team-Dashboard";
const FILE_PATH     = "app/jira-tickets/tickets-data.ts";
const API_BASE      = "https://api.github.com";

const KEY_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;

async function getFile(): Promise<{ content: string; sha: string }> {
  const res = await fetch(
    `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const data = await res.json();
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { content, sha: data.sha };
}

async function commitFile(content: string, sha: string, message: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${FILE_PATH}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        content: Buffer.from(content).toString("base64"),
        sha,
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub PUT failed: ${res.status} ${JSON.stringify(err)}`);
  }
}

/** TICKET_KEYS 배열에서 현재 키 목록 파싱 */
function parseKeys(content: string): string[] {
  const match = content.match(/export const TICKET_KEYS[^=]*=\s*\[([\s\S]*?)\];/);
  if (!match) throw new Error("TICKET_KEYS 파싱 실패");
  return [...match[1].matchAll(/"([A-Z][A-Z0-9]*-\d+)"/g)].map(m => m[1]);
}

/** TICKET_KEYS 배열에 키 추가 (마지막 항목 뒤에 삽입) */
function addKey(content: string, key: string): string {
  // 마지막 키 항목 뒤 (];  바로 앞)에 삽입
  return content.replace(
    /(\s*"[A-Z][A-Z0-9]*-\d+"[^"]*\n)(\s*\];)/,
    `$1  "${key}",\n$2`
  );
}

/** TICKET_KEYS 배열에서 키 제거 */
function removeKey(content: string, key: string): string {
  // 해당 키가 포함된 라인 전체 제거
  return content.replace(new RegExp(`^\\s*"${key}"[^\\n]*\\n`, "m"), "");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, key } = body as { action: "add" | "remove"; key: string };

    if (!action || !key) {
      return NextResponse.json({ error: "action, key 필수" }, { status: 400 });
    }
    if (!KEY_PATTERN.test(key)) {
      return NextResponse.json({ error: `잘못된 키 형식: ${key}` }, { status: 400 });
    }
    if (!["add", "remove"].includes(action)) {
      return NextResponse.json({ error: "action은 add 또는 remove" }, { status: 400 });
    }

    const { content, sha } = await getFile();
    const currentKeys = parseKeys(content);

    if (action === "add") {
      if (currentKeys.includes(key)) {
        return NextResponse.json({ ok: true, message: "이미 존재하는 키", keys: currentKeys });
      }
      const newContent = addKey(content, key);
      await commitFile(newContent, sha, `feat: 티켓 추가 ${key}`);
      return NextResponse.json({ ok: true, message: `${key} 추가됨`, keys: [...currentKeys, key] });
    }

    if (action === "remove") {
      if (!currentKeys.includes(key)) {
        return NextResponse.json({ ok: true, message: "존재하지 않는 키", keys: currentKeys });
      }
      const newContent = removeKey(content, key);
      await commitFile(newContent, sha, `chore: 티켓 제거 ${key}`);
      const remaining = currentKeys.filter(k => k !== key);
      return NextResponse.json({ ok: true, message: `${key} 제거됨`, keys: remaining });
    }
  } catch (err) {
    console.error("[/api/tickets]", err);
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
