import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { redis } from "@/lib/redis";
import { canAccessRoadmap } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

const ROADMAP_KEY = "cc-roadmap-initiatives";

/** 현재 세션의 로드맵 권한을 확인하고, 비허용 시 403 Response를 반환 */
async function checkAccess(): Promise<NextResponse | null> {
  const session = await auth();
  if (!canAccessRoadmap(session?.user?.email)) {
    return NextResponse.json(
      { error: "로드맵 기능에 대한 접근 권한이 없습니다." },
      { status: 403 }
    );
  }
  return null;
}

// GET /api/roadmap
export async function GET() {
  const denied = await checkAccess();
  if (denied) return denied;

  try {
    const data = await redis.get(ROADMAP_KEY);
    return NextResponse.json({ initiatives: data ?? null });
  } catch (e) {
    console.error("[ROADMAP GET]", e);
    return NextResponse.json({ error: "KV 읽기 오류" }, { status: 500 });
  }
}

// POST /api/roadmap  body: { initiatives: RoadmapInitiative[] }
export async function POST(req: NextRequest) {
  const denied = await checkAccess();
  if (denied) return denied;

  let body: { initiatives?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식" }, { status: 400 });
  }

  const { initiatives } = body;
  if (!Array.isArray(initiatives)) {
    return NextResponse.json({ error: "initiatives 배열이 필요합니다." }, { status: 400 });
  }

  try {
    await redis.set(ROADMAP_KEY, initiatives);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[ROADMAP POST]", e);
    return NextResponse.json({ error: "KV 쓰기 오류" }, { status: 500 });
  }
}
