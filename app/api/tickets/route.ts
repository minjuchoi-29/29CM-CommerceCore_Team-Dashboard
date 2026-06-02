/**
 * POST /api/tickets  { action: "add", key: "TM-1234" }
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

export const dynamic = "force-dynamic";

const KEY_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;

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

    const currentKeys = await getCustomKeys();

    if (action === "add") {
      if (currentKeys.includes(key)) {
        return NextResponse.json({ ok: true, message: "이미 존재하는 키", keys: currentKeys });
      }
      const newKeys = [...currentKeys, key];
      await redis.set("cc-custom-keys", newKeys);
      return NextResponse.json({ ok: true, message: `${key} 추가됨`, keys: newKeys });
    }

    if (action === "remove") {
      if (!currentKeys.includes(key)) {
        return NextResponse.json({ ok: true, message: "존재하지 않는 키", keys: currentKeys });
      }
      const newKeys = currentKeys.filter(k => k !== key);
      await redis.set("cc-custom-keys", newKeys);
      return NextResponse.json({ ok: true, message: `${key} 제거됨`, keys: newKeys });
    }

    return NextResponse.json({ error: "알 수 없는 action" }, { status: 400 });
  } catch (err) {
    console.error("[/api/tickets]", err);
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
