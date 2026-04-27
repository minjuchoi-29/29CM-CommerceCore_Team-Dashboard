import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

const SPREADSHEET_ID = "1uCR-MCNpXO9b8iXIFZMgQIG-z54rzbVi4AN_1TtiSMw";

export async function POST(req: NextRequest) {
  const session = await auth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accessToken = (session as any)?.accessToken as string | undefined;
  if (!accessToken) {
    return NextResponse.json({ error: "인증 필요 — 재로그인 후 시도해주세요" }, { status: 401 });
  }

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
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/A:A:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: keys.map((k) => [k]) }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message ?? JSON.stringify(data));
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sheet-append]", msg);
    return NextResponse.json({ error: `시트 추가 실패: ${msg}` }, { status: 500 });
  }
}
