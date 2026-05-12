/**
 * GET /api/quick-links
 *
 * Google Sheets "퀵링크" 시트에서 링크 목록을 읽어 반환합니다.
 * 컬럼: A=category, B=label, C=url, D=icon
 *
 * 로그인된 사용자의 Google accessToken으로 인증하여 읽습니다.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

const SHEET_ID = "1uCR-MCNpXO9b8iXIFZMgQIG-z54rzbVi4AN_1TtiSMw";
const SHEET_NAME = "퀵링크";

export type QuickLink = {
  category: string;
  label: string;
  url: string;
  icon: string;
};

export type QuickLinkGroup = {
  category: string;
  items: QuickLink[];
};

/** URL · 카테고리 · 라벨 기반 아이콘 자동 배정 */
function autoIcon(url: string, category: string, label: string): string {
  const u = url.toLowerCase();
  const c = category.toLowerCase();
  const l = label.toLowerCase();

  // URL 도메인 기반
  if (u.includes("docs.google.com/spreadsheets")) return "📊";
  if (u.includes("docs.google.com/document"))     return "📄";
  if (u.includes("docs.google.com/presentation")) return "📑";
  if (u.includes("docs.google.com/forms"))        return "📋";
  if (u.includes("drive.google.com"))             return "📁";
  if (u.includes("notion.so") || u.includes("notion.com")) return "🗒️";
  if (u.includes("atlassian.net") || u.includes("wiki.team")) return "📝";
  if (u.includes("github.com"))                   return "🐙";
  if (u.includes("figma.com"))                    return "🎨";
  if (u.includes("slack.com"))                    return "💬";
  if (u.includes("zoom.us") || u.includes("meet.google")) return "📹";
  if (u.includes("linear.app"))                   return "📐";
  if (u.includes("miro.com"))                     return "🗺️";

  // 카테고리 키워드 기반
  if (c.includes("okr"))       return "🎯";
  if (c.includes("weekly") || l.includes("weekly")) return "📅";
  if (c.includes("sprint"))    return "🏃";
  if (c.includes("kpi") || c.includes("metric")) return "📈";
  if (c.includes("디자인") || c.includes("design")) return "🎨";
  if (c.includes("개발") || c.includes("dev"))   return "💻";
  if (c.includes("기획") || c.includes("plan"))  return "📌";
  if (c.includes("회고") || c.includes("retro")) return "🔄";
  if (c.includes("온보딩") || c.includes("onboard")) return "🚀";
  if (c.includes("문서") || c.includes("doc"))   return "📝";

  // 라벨 키워드 기반
  if (l.includes("okr"))    return "🎯";
  if (l.includes("weekly")) return "📅";
  if (l.includes("대시보드") || l.includes("dashboard")) return "📊";
  if (l.includes("로드맵") || l.includes("roadmap"))     return "🗺️";
  if (l.includes("회의") || l.includes("meeting"))       return "📹";
  if (l.includes("채용") || l.includes("hire"))          return "👥";

  return "🔗";
}


export async function GET() {
  try {
    const session = await auth();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accessToken = (session as any)?.accessToken as string | undefined;

    if (!accessToken) {
      return NextResponse.json({ error: "인증 필요", groups: [] }, { status: 200 });
    }

    const range = `'${SHEET_NAME}'!A:D`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?ranges=${encodeURIComponent(range)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[quick-links] Sheets API error:", res.status, errText);
      return NextResponse.json({ error: "시트를 가져오지 못했습니다", groups: [] }, { status: 200 });
    }

    const data = await res.json();
    const rows: string[][] = data.valueRanges?.[0]?.values ?? [];

    // 첫 행은 헤더 (category, label, url, icon) — 스킵
    const dataRows = rows.slice(1).filter(r => r.length >= 3 && r[2]);

    const links: QuickLink[] = dataRows.map(r => {
      const category = r[0] || "기타";
      const label    = r[1] || r[2];
      const url      = r[2];
      const icon     = r[3]?.trim() || autoIcon(url, category, label);
      return { category, label, url, icon };
    });

    // category 기준으로 그룹핑 (순서 유지)
    const groupMap = new Map<string, QuickLink[]>();
    for (const link of links) {
      if (!groupMap.has(link.category)) groupMap.set(link.category, []);
      groupMap.get(link.category)!.push(link);
    }

    const groups: QuickLinkGroup[] = Array.from(groupMap.entries()).map(([category, items]) => ({
      category,
      items,
    }));

    return NextResponse.json({ groups });
  } catch (err) {
    console.error("[quick-links]", err);
    return NextResponse.json({ error: "오류가 발생했습니다", groups: [] }, { status: 200 });
  }
}
