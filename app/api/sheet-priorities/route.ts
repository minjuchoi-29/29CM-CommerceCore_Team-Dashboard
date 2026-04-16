import { NextResponse } from "next/server";

const SPREADSHEET_ID = "1uCR-MCNpXO9b8iXIFZMgQIG-z54rzbVi4AN_1TtiSMw";
const SHEET_NAME = "시트1";

// Google Visualization API — "링크가 있는 사용자 편집 가능" 시트에서 인증 없이 읽기 가능
const GViz_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NAME)}&range=A:B`;

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(GViz_URL, {
      next: { revalidate: 300 }, // 5분 캐시
      headers: { Accept: "text/plain" },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Sheet fetch failed: ${res.status}` }, { status: 502 });
    }

    const raw = await res.text();

    // gviz 응답은 "/*O_o*/\ngoogle.visualization.Query.setResponse({...});" 형식
    const jsonStr = raw.replace(/^.*?google\.visualization\.Query\.setResponse\(/, "").replace(/\);?\s*$/, "");
    const gviz = JSON.parse(jsonStr) as {
      table: { rows: Array<{ c: Array<{ v: string | number | null } | null> }> };
    };

    const priorities: Record<string, string> = {};

    for (const row of gviz.table.rows) {
      const aCell = row.c?.[0];
      const bCell = row.c?.[1];
      const key = aCell?.v != null ? String(aCell.v).trim() : null;
      const priority = bCell?.v != null ? String(bCell.v).trim() : null;
      if (key && key !== "ticket" && priority) {
        priorities[key] = priority;
      }
    }

    return NextResponse.json({ priorities });
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
