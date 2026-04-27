import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

const SPREADSHEET_ID = "1uCR-MCNpXO9b8iXIFZMgQIG-z54rzbVi4AN_1TtiSMw";

export async function GET() {
  const session = await auth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accessToken = (session as any)?.accessToken as string | undefined;

  if (!accessToken) {
    return NextResponse.json({ priorities: {}, planning: {}, error: "no_token" });
  }

  try {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/A:B`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("[sheet-priorities] Sheets API error:", res.status, errText);
      return NextResponse.json({ priorities: {}, planning: {}, error: `sheets_${res.status}` });
    }

    const data = await res.json();
    const rows: string[][] = data.values ?? [];

    // 첫 행은 헤더(key, priority) — 건너뜀
    const priorities: Record<string, string> = {};
    const sheetKeys: string[] = [];
    for (let i = 1; i < rows.length; i++) {
      const key = rows[i][0]?.trim();
      const priority = rows[i][1]?.trim();
      if (key) {
        sheetKeys.push(key);
        if (priority) priorities[key] = priority;
      }
    }

    return NextResponse.json({ priorities, sheetKeys, planning: {} });
  } catch (e) {
    console.error("[sheet-priorities]", e);
    return NextResponse.json({ priorities: {}, planning: {}, error: "fetch_error" });
  }
}

// POST: 우선순위 재정렬 결과를 시트 B열에 일괄 반영
// body: { priorities: { [ticketKey]: "1" | "2" | "" } }  (빈 문자열 = 셀 초기화)
export async function POST(req: NextRequest) {
  const session = await auth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accessToken = (session as any)?.accessToken as string | undefined;
  if (!accessToken) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  let body: { priorities?: Record<string, string> };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  const updates = body.priorities ?? {};
  if (Object.keys(updates).length === 0) return NextResponse.json({ ok: true, updated: 0 });

  try {
    // 시트 A:B 읽어서 티켓키 → 행 번호 매핑
    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/A:B`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!readRes.ok) throw new Error(`read ${readRes.status}`);
    const rows: string[][] = (await readRes.json()).values ?? [];

    const keyToRow = new Map<string, number>();
    for (let i = 1; i < rows.length; i++) {
      const k = rows[i][0]?.trim();
      if (k) keyToRow.set(k, i + 1); // 시트는 1-based
    }

    const data = Object.entries(updates)
      .filter(([key]) => keyToRow.has(key))
      .map(([key, val]) => ({ range: `B${keyToRow.get(key)}`, values: [[val]] }));

    if (data.length === 0) return NextResponse.json({ ok: true, updated: 0 });

    const writeRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ valueInputOption: "RAW", data }),
      }
    );
    if (!writeRes.ok) throw new Error(`write ${writeRes.status} ${await writeRes.text()}`);

    return NextResponse.json({ ok: true, updated: data.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sheet-priorities POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
