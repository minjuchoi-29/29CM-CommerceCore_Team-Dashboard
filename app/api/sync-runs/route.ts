import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { adminApiGuard } from "@/lib/auth/admin";
import { listSyncRuns } from "@/lib/sync-runs";
import type { SyncRunKind } from "@/lib/sync-run-types";

export const dynamic = "force-dynamic";

const SYNC_RUN_KINDS = new Set<SyncRunKind>(["daily-refresh", "filter", "jira"]);

export async function GET(req: NextRequest) {
  const session = await auth();
  const block = adminApiGuard(session?.user?.email);
  if (block) return block;

  const parsedLimit = Number(req.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 20;
  const rawKind = req.nextUrl.searchParams.get("kind");
  const kind = rawKind && SYNC_RUN_KINDS.has(rawKind as SyncRunKind)
    ? rawKind as SyncRunKind
    : undefined;

  try {
    const runs = await listSyncRuns(limit, kind);
    return NextResponse.json({ runs });
  } catch (error) {
    console.error("[sync-runs GET]", error);
    return NextResponse.json({ error: "동기화 실행 기록을 불러오지 못했습니다." }, { status: 500 });
  }
}
