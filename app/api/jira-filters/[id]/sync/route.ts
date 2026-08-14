/**
 * POST /api/jira-filters/[id]/sync
 *
 * 지정 필터의 Jira 이슈를 페이지네이션으로 가져와
 * cc-filter-tickets, cc-ticket-sources를 갱신합니다.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { adminApiGuard } from "@/lib/auth/admin";
import { redis } from "@/lib/redis";
import type { JiraFiltersStore } from "@/lib/filter-types";
import { TICKET_KEYS } from "@/app/jira-tickets/tickets-data";
import { syncJiraFilter } from "@/lib/filter-sync";
import {
  addSyncRunStage,
  completeSyncRun,
  createSyncRun,
  saveSyncRun,
  startSyncRun,
} from "@/lib/sync-runs";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const block = adminApiGuard(session?.user?.email);
  if (block) return block;

  const { id } = await params;

  // 필터 정보 조회
  const store = (await redis.get<JiraFiltersStore>("cc-jira-filters")) ?? {};
  const filter = store[id];
  if (!filter) {
    return NextResponse.json({ error: "필터를 찾을 수 없습니다." }, { status: 404 });
  }
  if (filter.enabled === false) {
    return NextResponse.json(
      { error: "중지된 데이터 소스입니다. 다시 사용한 뒤 동기화해주세요." },
      { status: 409 },
    );
  }

  const filterLabel = filter.label ?? filter.name;
  const syncRun = createSyncRun("filter", "manual", {
    filterId: id,
    jiraFilterId: filter.jiraFilterId,
    filterName: filterLabel,
  });
  try {
    await startSyncRun(syncRun);
  } catch (error) {
    // 실행 기록 실패가 실제 필터 동기화를 막으면 안 된다.
    console.warn("[jira-filters sync] 실행 기록 시작 실패", error);
  }

  const result = await syncJiraFilter(id, new Set(TICKET_KEYS));
  if (!result) {
    return NextResponse.json({ error: "필터를 찾을 수 없습니다." }, { status: 404 });
  }
  addSyncRunStage(syncRun, {
    key: "filter-sync",
    label: "Jira Filter 티켓 조회",
    status: result.ok ? "success" : "failed",
    durationMs: result.durationMs,
    counts: { tickets: result.ticketCount, overlap: result.overlapCount },
    error: result.error,
  });
  completeSyncRun(syncRun, result.ok ? "success" : "failed", {
    counts: { tickets: result.ticketCount, overlap: result.overlapCount },
    error: result.error,
  });
  await saveSyncRun(syncRun).catch(error => {
    console.warn("[jira-filters sync] 완료 기록 저장 실패", error);
  });
  return NextResponse.json({
    filterId: result.filterId,
    ok: result.ok,
    ticketKeys: result.ticketKeys,
    overlapCount: result.overlapCount,
    durationMs: result.durationMs,
    error: result.error,
  }, { status: result.ok ? 200 : 502 });
}
