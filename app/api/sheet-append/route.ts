import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

const SPREADSHEET_ID = "1uCR-MCNpXO9b8iXIFZMgQIG-z54rzbVi4AN_1TtiSMw";
const SHEET_RANGE = "A:A";

export async function POST(req: NextRequest) {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!serviceAccountEmail || !privateKey) {
    return NextResponse.json({ error: "서비스 계정 환경변수 누락" }, { status: 500 });
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
    const auth = new google.auth.JWT({
      email: serviceAccountEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // 기존 A열 데이터 조회 → 중복 제거
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: SHEET_RANGE,
    });
    const existingValues: string[] = (existing.data.values ?? []).flat().map(String);
    const newKeys = keys.filter((k) => !existingValues.includes(k));

    if (newKeys.length === 0) {
      return NextResponse.json({ ok: true, appended: 0, message: "이미 시트에 있는 티켓입니다" });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: SHEET_RANGE,
      valueInputOption: "RAW",
      requestBody: { values: newKeys.map((k) => [k]) },
    });

    return NextResponse.json({ ok: true, appended: newKeys.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sheet-append]", msg);
    return NextResponse.json({ error: `시트 추가 실패: ${msg}` }, { status: 500 });
  }
}
