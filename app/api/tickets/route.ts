/**
 * GET  /api/tickets  → 공용 수동 추가 티켓 key 목록
 * POST /api/tickets  { action: "add", key: "TM-1234" }
 * POST /api/tickets  { action: "add", keys: ["TM-1234", "TM-5678"] }
 * POST /api/tickets  { action: "remove", key: "TM-1234" }
 *
 * 운영 데이터(수동 추가 티켓)는 KV(cc-custom-keys)에만 저장.
 * GitHub commit / Vercel deploy 없음.
 *
 * 이전 구조: GitHub API → tickets-data.ts 수정 → Git commit → Vercel deploy
 * 현재 구조: KV cc-custom-keys read/write → 즉시 반환, 배포 없음
 */

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { withRedisLock } from "@/lib/redis-lock";

export const dynamic = "force-dynamic";

const KEY_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;
const CUSTOM_TICKET_LOCK_KEY = "lock:cc-custom-keys";

async function getCustomKeys(): Promise<string[]> {
  const raw = await redis.get<unknown>("cc-custom-keys");
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  // 문자열 JSON 형태로 저장된 경우 파싱
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

export async function GET() {
  try {
    const keys = await getCustomKeys();
    return NextResponse.json(
      { keys },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[/api/tickets GET]", err);
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, key, keys } = body as {
      action: "add" | "remove";
      key?: string;
      keys?: string[];
    };
    const requestedKeys = [...new Set(
      (Array.isArray(keys) ? keys : key ? [key] : [])
        .map(value => value.trim().toUpperCase())
        .filter(Boolean),
    )];

    if (!action || requestedKeys.length === 0) {
      return NextResponse.json({ error: "action과 key 또는 keys 필수" }, { status: 400 });
    }
    const invalidKey = requestedKeys.find(value => !KEY_PATTERN.test(value));
    if (invalidKey) {
      return NextResponse.json({ error: `잘못된 키 형식: ${invalidKey}` }, { status: 400 });
    }
    if (!["add", "remove"].includes(action)) {
      return NextResponse.json({ error: "action은 add 또는 remove" }, { status: 400 });
    }

    const result = await withRedisLock(redis, CUSTOM_TICKET_LOCK_KEY, async () => {
      const currentKeys = await getCustomKeys();
      if (action === "add") {
        const currentSet = new Set(currentKeys);
        const addedKeys = requestedKeys.filter(value => !currentSet.has(value));
        if (addedKeys.length === 0) {
          return { keys: currentKeys, changedKeys: [] as string[] };
        }
        const nextKeys = [...currentKeys, ...addedKeys];
        await redis.set("cc-custom-keys", nextKeys);
        return { keys: nextKeys, changedKeys: addedKeys };
      }

      const removeSet = new Set(requestedKeys);
      const removedKeys = currentKeys.filter(value => removeSet.has(value));
      if (removedKeys.length === 0) {
        return { keys: currentKeys, changedKeys: [] as string[] };
      }
      const nextKeys = currentKeys.filter(value => !removeSet.has(value));
      await redis.set("cc-custom-keys", nextKeys);
      return { keys: nextKeys, changedKeys: removedKeys };
    });

    const verb = action === "add" ? "추가" : "제거";
    const message = result.changedKeys.length > 0
      ? `${result.changedKeys.length}개 티켓 ${verb}됨`
      : `${verb}할 변경 없음`;
    return NextResponse.json({ ok: true, message, keys: result.keys, changedKeys: result.changedKeys });
  } catch (err) {
    console.error("[/api/tickets]", err);
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
