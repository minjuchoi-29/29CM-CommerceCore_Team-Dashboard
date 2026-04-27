import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

const SPREADSHEET_ID = "1uCR-MCNpXO9b8iXIFZMgQIG-z54rzbVi4AN_1TtiSMw";

export async function GET() {
  const session = await auth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accessToken = (session as any)?.accessToken as string | undefined;

  if (!accessToken) {
    return NextResponse.json({ priorities: {}, planning: {} });
  }

  try {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/A:B`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!res.ok) {
      console.error("[sheet-priorities]", await res.text());
      return NextResponse.json({ priorities: {}, planning: {} });
    }

    const data = await res.json();
    const rows: string[][] = data.values ?? [];

    // 첫 행은 헤더(key, priority) — 건너뜀
    const priorities: Record<string, string> = {};
    for (let i = 1; i < rows.length; i++) {
      const key = rows[i][0]?.trim();
      const priority = rows[i][1]?.trim();
      if (key && priority) priorities[key] = priority;
    }

    return NextResponse.json({ priorities, planning: {} });
  } catch (e) {
    console.error("[sheet-priorities]", e);
    return NextResponse.json({ priorities: {}, planning: {} });
  }
}
