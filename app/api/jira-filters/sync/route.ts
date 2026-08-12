import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { TICKET_KEYS } from "@/app/jira-tickets/tickets-data";
import { syncAllJiraFilters } from "@/lib/filter-sync";
import {
  addSyncRunStage,
  completeSyncRun,
  createSyncRun,
  saveSyncRun,
  startSyncRun,
} from "@/lib/sync-runs";

export const dynamic = "force-dynamic";

/** Jira Sync 직전에 모든 활성 데이터 소스의 멤버십을 제한 병렬로 갱신한다. */
export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const run = createSyncRun("filter", "dashboard", { scope: "all-enabled" });
  await startSyncRun(run).catch(error => {
    console.warn("[jira-filters sync-all] 실행 기록 시작 실패", error);
  });
  const startedAt = Date.now();

  try {
    const result = await syncAllJiraFilters(new Set(TICKET_KEYS));
    const durationMs = Date.now() - startedAt;
    addSyncRunStage(run, {
      key: "filter-membership",
      label: "데이터 소스 티켓 확인",
      status: result.failedFilters > 0 ? "failed" : result.skippedFilters > 0 && result.syncedFilters === 0 ? "skipped" : "success",
      durationMs,
      counts: {
        syncedFilters: result.syncedFilters,
        failedFilters: result.failedFilters,
        skippedFilters: result.skippedFilters,
        newTickets: result.totalNewTickets,
      },
    });
    const status = result.failedFilters > 0
      ? result.syncedFilters > 0 ? "partial" : "failed"
      : "success";
    completeSyncRun(run, status, {
      counts: {
        syncedFilters: result.syncedFilters,
        failedFilters: result.failedFilters,
        newTickets: result.totalNewTickets,
      },
    });
    await saveSyncRun(run).catch(error => {
      console.warn("[jira-filters sync-all] 완료 기록 저장 실패", error);
    });
    return NextResponse.json({ ...result, syncRunId: run.id, durationMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startedAt;
    addSyncRunStage(run, {
      key: "filter-membership",
      label: "데이터 소스 티켓 확인",
      status: "failed",
      durationMs,
      error: message,
    });
    completeSyncRun(run, "failed", { error: message });
    await saveSyncRun(run).catch(recordError => {
      console.warn("[jira-filters sync-all] 실패 기록 저장 실패", recordError);
    });
    return NextResponse.json({ error: message, syncRunId: run.id }, { status: 502 });
  }
}
