import { NextRequest, NextResponse } from "next/server";

const APPS_SCRIPT_URL =
  "https://script.google.com/a/macros/29cm.co.kr/s/AKfycbxksQwQg3U1CzyLn4ihgUzpI-aWJAF9QVABefVWKkYC-ykdvXr7o3pWQ2lEuKmwCcs/exec";

export async function POST(req: NextRequest) {
  let body: { keys?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식" }, { status: 400 });
  }

  const keys = (body.keys ?? []).filter((k) => /^[A-Z]+-\d+$/.test(k));
  if (keys.length === 0) {
    return NextResponse.json({ error: "유효한 티켓 키가 없습니다" }, { status: 400 });
  }

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sheet-append]", msg);
    return NextResponse.json({ error: `시트 추가 실패: ${msg}` }, { status: 500 });
  }
}
