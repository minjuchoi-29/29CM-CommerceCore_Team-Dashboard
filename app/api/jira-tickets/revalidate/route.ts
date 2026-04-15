import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 클라이언트 localStorage 캐시를 무효화하도록 알림만 반환
// (서버 캐시 없이 클라이언트 단에서 12h 캐싱)
export async function POST() {
  return NextResponse.json({ ok: true });
}
