import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

const VALID_KEYS = ["cc-planning", "cc-schedules", "cc-memos", "cc-memos-v2", "cc-custom-keys", "cc-custom-tickets", "cc-planning-notes", "cc-etr"] as const;
type ValidKey = (typeof VALID_KEYS)[number];

function isValidKey(k: string): k is ValidKey {
  return VALID_KEYS.includes(k as ValidKey);
}

// GET /api/kv?keys=cc-planning,cc-schedules,cc-memos
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("keys") ?? "";
  const keys = raw.split(",").map((k) => k.trim()).filter(isValidKey);
  if (keys.length === 0) {
    return NextResponse.json({ error: "keys 파라미터가 필요합니다." }, { status: 400 });
  }

  try {
    const results = await Promise.all(
      keys.map((k) => redis.get<Record<string, unknown>>(k))
    );
    const data: Record<string, unknown> = {};
    keys.forEach((k, i) => { data[k] = results[i] ?? {}; });
    return NextResponse.json(data);
  } catch (e) {
    console.error("[KV GET]", e);
    return NextResponse.json({ error: "KV 읽기 오류" }, { status: 500 });
  }
}

// POST /api/kv  body: { key: "cc-planning", value: { ... } }
export async function POST(req: NextRequest) {
  let body: { key?: string; value?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "잘못된 요청 형식" }, { status: 400 });
  }

  const { key, value } = body;
  if (!key || !isValidKey(key)) {
    return NextResponse.json({ error: "유효하지 않은 key" }, { status: 400 });
  }
  if (value === undefined) {
    return NextResponse.json({ error: "value가 필요합니다." }, { status: 400 });
  }

  try {
    await redis.set(key, value);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[KV POST]", e);
    return NextResponse.json({ error: "KV 쓰기 오류" }, { status: 500 });
  }
}
