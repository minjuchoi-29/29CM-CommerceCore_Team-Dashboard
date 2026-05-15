import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { redis } from "@/lib/redis";
import { appendActivity, ActivityEntry, ACTIVITY_KV_KEY } from "@/lib/activity";

export const dynamic = "force-dynamic";

// GET /api/activity?ticketKey=TM-2727   (optional filter)
// GET /api/activity?roadmapId=xxx       (optional filter)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  try {
    const data = await redis.get<ActivityEntry[]>(ACTIVITY_KV_KEY);
    let entries: ActivityEntry[] = Array.isArray(data) ? data : [];

    // 선택적 필터
    const ticketKey  = req.nextUrl.searchParams.get("ticketKey");
    const roadmapId  = req.nextUrl.searchParams.get("roadmapId");
    if (ticketKey)  entries = entries.filter((e) => e.ticketKey  === ticketKey);
    if (roadmapId)  entries = entries.filter((e) => e.roadmapId  === roadmapId);

    return NextResponse.json({ entries });
  } catch (e) {
    console.error("[ACTIVITY GET]", e);
    return NextResponse.json({ error: "KV 읽기 오류" }, { status: 500 });
  }
}

// POST /api/activity
// body: Omit<ActivityEntry, "id">  — id는 서버에서 생성
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  let body: Partial<Omit<ActivityEntry, "id">>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식" }, { status: 400 });
  }

  const { verb, actor, at, ticketKey, roadmapId, meta } = body;
  if (!verb || !actor || !at) {
    return NextResponse.json({ error: "verb, actor, at 필드가 필요합니다." }, { status: 400 });
  }

  try {
    const existing = (await redis.get<ActivityEntry[]>(ACTIVITY_KV_KEY)) ?? [];
    const updated = appendActivity(Array.isArray(existing) ? existing : [], {
      verb,
      actor,
      at,
      ...(ticketKey  ? { ticketKey }  : {}),
      ...(roadmapId  ? { roadmapId }  : {}),
      ...(meta       ? { meta }       : {}),
    });
    await redis.set(ACTIVITY_KV_KEY, updated);
    return NextResponse.json({ ok: true, entry: updated[0] });
  } catch (e) {
    console.error("[ACTIVITY POST]", e);
    return NextResponse.json({ error: "KV 쓰기 오류" }, { status: 500 });
  }
}
