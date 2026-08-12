import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { parseWeekly } from "@/lib/weekly-parser";
import { mergeWeeklySync, getRowAllKeys } from "@/lib/weekly-merge";
import { RedisLockTimeoutError, withRedisLock } from "@/lib/redis-lock";
import { reconcileUpdateCandidates } from "@/lib/weekly-candidates";
import type {
  ParsedWeekly, WeeklyNote, UpdateCandidate, WeeklySourceText, WeeklySyncMeta,
} from "@/lib/weekly-types";
import type { ExtendedSchedule } from "@/lib/weekly-merge";
import {
  addSyncRunStage,
  completeSyncRun,
  createSyncRun,
  saveSyncRun,
  startSyncRun,
} from "@/lib/sync-runs";

export const dynamic = "force-dynamic";
const WEEKLY_SYNC_LOCK_KEY = "lock:cc-weekly-sync";

// ─── GET: 특정 티켓의 weekly notes + update candidates ─────────
export async function GET(req: NextRequest) {
  const ticketKey = req.nextUrl.searchParams.get("ticketKey");
  if (!ticketKey) {
    return NextResponse.json({ error: "ticketKey required" }, { status: 400 });
  }
  try {
    const allNotes = await redis.get<Record<string, WeeklyNote[]>>("cc-weekly-notes") ?? {};
    const allCandidates = await redis.get<UpdateCandidate[]>("cc-update-candidates") ?? [];
    const notes = allNotes[ticketKey] ?? [];
    const candidates = allCandidates.filter(c => c.ticketKey === ticketKey && !c.resolved);
    return NextResponse.json({ notes, updateCandidates: candidates });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

async function persistWeeklySync(ticketKey: string, parsed: ParsedWeekly, sourceId?: string) {
  return withRedisLock(redis, WEEKLY_SYNC_LOCK_KEY, async () => {
    // Shared JSON keys must be read and written while holding the same lock.
    const [rawSchedules, rawNotes, rawCandidates, rawMeta] = await Promise.all([
      redis.get<Record<string, unknown[]>>("cc-schedules"),
      redis.get<Record<string, WeeklyNote[]>>("cc-weekly-notes"),
      redis.get<UpdateCandidate[]>("cc-update-candidates"),
      redis.get<Record<string, WeeklySyncMeta>>("cc-weekly-sync-meta"),
    ]);
    const allSchedules = rawSchedules ?? {};
    const allNotes     = rawNotes     ?? {};
    const allCandidates = rawCandidates ?? [];
    const allMeta = rawMeta ?? {};
    const previousMeta = allMeta[ticketKey];
    const existingSchedules = ((allSchedules as Record<string, unknown>)[ticketKey] ?? []) as ExtendedSchedule[];
    const existingNotes = (allNotes as Record<string, WeeklyNote[]>)[ticketKey] ?? [];
    if (sourceId && previousMeta?.appliedSourceIds?.includes(sourceId)) {
      return {
        ok: true,
        sourceWeek: parsed.sourceWeek,
        schedulesUpdated: existingSchedules.length,
        notesTotal: existingNotes.length,
        newNotesAdded: 0,
        updateCandidates: 0,
        staleCandidates: [],
        isIdempotent: true,
        sourceSkipped: true,
      };
    }

    // 3. Merge
    const result = mergeWeeklySync(ticketKey, parsed, existingSchedules, existingNotes);

    // 4. cc-schedules 갱신
    const updatedSchedules = { ...(allSchedules as Record<string, unknown>), [ticketKey]: result.updatedSchedules };
    await redis.set("cc-schedules", updatedSchedules);

    // 5. cc-weekly-notes 갱신
    const updatedNotes = { ...(allNotes as Record<string, WeeklyNote[]>), [ticketKey]: result.newNotes };
    await redis.set("cc-weekly-notes", updatedNotes);

    // 6. cc-update-candidates — 기존 보존 + 신규 추가 (id 중복 제거)
    const mergedCandidates = reconcileUpdateCandidates(
      allCandidates,
      result.updateCandidates,
      ticketKey,
      parsed.sourceWeek,
      new Date().toISOString(),
    );
    await redis.set("cc-update-candidates", mergedCandidates);

    // 7. cc-weekly-sync-meta 갱신 + PR #39: trace summary 저장 (UI visibility 용)
    // PR #39: outcome 별 카운트 + 항목 메타 추출 (mergeTrace 가 있을 때만).
    const trace = result.mergeTrace ?? [];
    const lastTraceSummary = {
      appended:    trace.filter(t => t.outcome === "appended").length,
      updated:     trace.filter(t => t.outcome === "updated").length,
      candidates:  trace.filter(t => t.outcome === "candidates_only").length,
      idempotent:  trace.filter(t => t.outcome === "idempotent").length,
      manualGuard: trace.filter(t => t.outcome === "manual_guard").length,
    };
    const lastTraceItems = trace.map(t => ({
      outcome:   t.outcome,
      itemText:  t.itemRawText,
      phase:     t.phase,
      startDate: t.startDate,
      endDate:   t.endDate,
    }));

    allMeta[ticketKey] = {
      ticketKey,
      lastSyncAt: new Date().toISOString(),
      lastSourceWeek: parsed.sourceWeek,
      lastTraceSummary,
      lastTraceItems,
      appliedSourceIds: sourceId
        ? [...(previousMeta?.appliedSourceIds ?? []), sourceId].slice(-100)
        : previousMeta?.appliedSourceIds,
    };
    await redis.set("cc-weekly-sync-meta", allMeta);

    return {
      ok: true,
      sourceWeek: parsed.sourceWeek,
      schedulesUpdated: result.updatedSchedules.length,
      notesTotal: result.newNotes.length,
      newNotesAdded: result.newNotes.length - existingNotes.length,
      updateCandidates: result.updateCandidates.length,
      staleCandidates: result.staleCandidates,
      isIdempotent: result.isIdempotent,
    };
  }, {
    // 배포 직후 replay처럼 쓰기가 몰릴 때도 lock holder가 끝날 시간을 충분히 준다.
    ttlMs: 30_000,
    waitTimeoutMs: 30_000,
    retryMs: 100,
  });
}

type WeeklyBatchItem = {
  ticketKey: string;
  weeklyText: string;
  sourceId: string;
};

type WeeklyBatchAttempt = {
  ticketKey: string;
  reason?: "no_marker" | "src_error";
};

type WeeklyBatchRequest = {
  items: WeeklyBatchItem[];
  attempts?: WeeklyBatchAttempt[];
  sourceTexts?: Record<string, WeeklySourceText>;
  timings?: {
    metadataMs?: number;
    sourceCollectionMs?: number;
    targetCount?: number;
    skippedUnchanged?: number;
  };
};

async function persistWeeklySyncBatch(body: WeeklyBatchRequest) {
  const mergeStartedAt = Date.now();
  const syncRun = createSyncRun("jira", "dashboard", {
    targets: String(body.timings?.targetCount ?? 0),
    changed: String(new Set(body.items.map(item => item.ticketKey)).size),
  });
  try {
    await startSyncRun(syncRun);
  } catch (error) {
    console.warn("[weekly-sync batch] 실행 기록 시작 실패", error);
  }

  if (body.timings?.metadataMs != null) {
    addSyncRunStage(syncRun, {
      key: "jira-metadata",
      label: "Jira 기본 정보 갱신",
      status: "success",
      durationMs: body.timings.metadataMs,
      counts: {
        targets: body.timings.targetCount ?? 0,
        skippedUnchanged: body.timings.skippedUnchanged ?? 0,
      },
    });
  }
  if (body.timings?.sourceCollectionMs != null) {
    const sourceErrors = (body.attempts ?? []).filter(attempt => attempt.reason === "src_error").length;
    addSyncRunStage(syncRun, {
      key: "weekly-source",
      label: "최신 Weekly 원문 확인",
      status: sourceErrors > 0 ? "failed" : "success",
      durationMs: body.timings.sourceCollectionMs,
      counts: {
        changedTickets: new Set(body.items.map(item => item.ticketKey)).size,
        sourceErrors,
      },
    });
  }

  try {
    const result = await withRedisLock(redis, WEEKLY_SYNC_LOCK_KEY, async () => {
      const [rawSchedules, rawNotes, rawCandidates, rawMeta, rawSourceTexts] = await Promise.all([
        redis.get<Record<string, unknown[]>>("cc-schedules"),
        redis.get<Record<string, WeeklyNote[]>>("cc-weekly-notes"),
        redis.get<UpdateCandidate[]>("cc-update-candidates"),
        redis.get<Record<string, WeeklySyncMeta>>("cc-weekly-sync-meta"),
        redis.get<Record<string, WeeklySourceText>>("cc-weekly-source-text"),
      ]);
      const allSchedules = rawSchedules ?? {};
      const allNotes = rawNotes ?? {};
      let allCandidates = rawCandidates ?? [];
      const allMeta = rawMeta ?? {};
      const allSourceTexts = rawSourceTexts ?? {};
      const results: Array<Record<string, unknown>> = [];
      const failures: Array<{ ticketKey: string; sourceId: string; error: string }> = [];
      const failedTicketKeys = new Set<string>();
      const successfulTicketKeys = new Set<string>();

      for (const item of body.items) {
        if (failedTicketKeys.has(item.ticketKey)) continue;
        try {
          const parsed = parseWeekly(item.weeklyText, item.ticketKey);
          const previousMeta = allMeta[item.ticketKey];
          const existingSchedules = (allSchedules[item.ticketKey] ?? []) as ExtendedSchedule[];
          const existingNotes = allNotes[item.ticketKey] ?? [];

          if (previousMeta?.appliedSourceIds?.includes(item.sourceId)) {
            successfulTicketKeys.add(item.ticketKey);
            results.push({
              ticketKey: item.ticketKey,
              sourceId: item.sourceId,
              ok: true,
              sourceSkipped: true,
              isIdempotent: true,
              schedulesUpdated: existingSchedules.length,
              updateCandidates: 0,
            });
            continue;
          }

          const merged = mergeWeeklySync(item.ticketKey, parsed, existingSchedules, existingNotes);
          allSchedules[item.ticketKey] = merged.updatedSchedules;
          allNotes[item.ticketKey] = merged.newNotes;
          allCandidates = reconcileUpdateCandidates(
            allCandidates,
            merged.updateCandidates,
            item.ticketKey,
            parsed.sourceWeek,
            new Date().toISOString(),
          );

          const trace = merged.mergeTrace ?? [];
          const lastTraceSummary = {
            appended: trace.filter(t => t.outcome === "appended").length,
            updated: trace.filter(t => t.outcome === "updated").length,
            candidates: trace.filter(t => t.outcome === "candidates_only").length,
            idempotent: trace.filter(t => t.outcome === "idempotent").length,
            manualGuard: trace.filter(t => t.outcome === "manual_guard").length,
          };
          allMeta[item.ticketKey] = {
            ticketKey: item.ticketKey,
            lastSyncAt: new Date().toISOString(),
            lastSourceWeek: parsed.sourceWeek,
            lastTraceSummary,
            lastTraceItems: trace.map(t => ({
              outcome: t.outcome,
              itemText: t.itemRawText,
              phase: t.phase,
              startDate: t.startDate,
              endDate: t.endDate,
            })),
            appliedSourceIds: [...(previousMeta?.appliedSourceIds ?? []), item.sourceId].slice(-100),
          };
          successfulTicketKeys.add(item.ticketKey);
          results.push({
            ticketKey: item.ticketKey,
            sourceId: item.sourceId,
            ok: true,
            sourceWeek: parsed.sourceWeek,
            schedulesUpdated: merged.updatedSchedules.length,
            notesTotal: merged.newNotes.length,
            updateCandidates: merged.updateCandidates.length,
            staleCandidates: merged.staleCandidates,
            isIdempotent: merged.isIdempotent,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failedTicketKeys.add(item.ticketKey);
          successfulTicketKeys.delete(item.ticketKey);
          failures.push({ ticketKey: item.ticketKey, sourceId: item.sourceId, error: message });
        }
      }

      const attemptAt = new Date().toISOString();
      const attemptedKeys = new Set([
        ...(body.attempts ?? []).map(attempt => attempt.ticketKey),
        ...body.items.map(item => item.ticketKey),
      ]);
      const reasonByKey = new Map((body.attempts ?? []).map(attempt => [attempt.ticketKey, attempt.reason]));
      for (const ticketKey of attemptedKeys) {
        const existing = allMeta[ticketKey] ?? {
          ticketKey,
          lastSyncAt: "",
          lastSourceWeek: "",
        };
        const reason = failedTicketKeys.has(ticketKey) ? "sync_error" : reasonByKey.get(ticketKey);
        allMeta[ticketKey] = {
          ...existing,
          lastAttemptAt: attemptAt,
          lastSkipReason: reason,
        };
      }

      Object.assign(allSourceTexts, body.sourceTexts ?? {});
      const hasWrites = body.items.length > 0 || attemptedKeys.size > 0 || Object.keys(body.sourceTexts ?? {}).length > 0;
      if (hasWrites) {
        await Promise.all([
          redis.set("cc-schedules", allSchedules),
          redis.set("cc-weekly-notes", allNotes),
          redis.set("cc-update-candidates", allCandidates),
          redis.set("cc-weekly-sync-meta", allMeta),
          redis.set("cc-weekly-source-text", allSourceTexts),
        ]);
      }

      return {
        ok: failures.length === 0,
        results,
        failures,
        summary: {
          sources: body.items.length,
          attemptedTickets: attemptedKeys.size,
          appliedTickets: successfulTicketKeys.size,
          failedTickets: failedTicketKeys.size,
          schedulesUpdated: results.reduce((sum, item) => sum + Number(item.schedulesUpdated ?? 0), 0),
          updateCandidates: results.reduce((sum, item) => sum + Number(item.updateCandidates ?? 0), 0),
        },
      };
    }, {
      ttlMs: 30_000,
      waitTimeoutMs: 30_000,
      retryMs: 100,
    });

    const mergeDurationMs = Date.now() - mergeStartedAt;
    addSyncRunStage(syncRun, {
      key: "weekly-merge",
      label: "Weekly 일정 일괄 병합",
      status: result.failures.length > 0 ? "failed" : "success",
      durationMs: mergeDurationMs,
      counts: result.summary,
      error: result.failures.length > 0 ? `${result.failures.length}개 티켓 처리 실패` : undefined,
    });
    const sourceErrors = (body.attempts ?? []).filter(attempt => attempt.reason === "src_error").length;
    const status = result.failures.length > 0 || sourceErrors > 0 ? "partial" : "success";
    completeSyncRun(syncRun, status, {
      counts: {
        ...result.summary,
        skippedUnchanged: body.timings?.skippedUnchanged ?? 0,
        sourceErrors,
      },
    });
    await saveSyncRun(syncRun).catch(error => {
      console.warn("[weekly-sync batch] 완료 기록 저장 실패", error);
    });
    return { ...result, syncRunId: syncRun.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addSyncRunStage(syncRun, {
      key: "weekly-merge",
      label: "Weekly 일정 일괄 병합",
      status: "failed",
      durationMs: Date.now() - mergeStartedAt,
      error: message,
    });
    completeSyncRun(syncRun, "failed", { error: message });
    await saveSyncRun(syncRun).catch(recordError => {
      console.warn("[weekly-sync batch] 실패 기록 저장 실패", recordError);
    });
    throw error;
  }
}

// ─── POST: weekly sync ─────────────────────────────────────────
// Body: { ticketKey: string, weeklyText: string, force?: boolean }
export async function POST(request: Request) {
  let ticketKey: string | undefined;
  let sourceId: string | undefined;
  try {
    const body = await request.json() as {
      ticketKey: string;
      weeklyText: string;
      force?: boolean;
      sourceId?: string;
      items?: WeeklyBatchItem[];
      attempts?: WeeklyBatchAttempt[];
      sourceTexts?: Record<string, WeeklySourceText>;
      timings?: WeeklyBatchRequest["timings"];
    };
    if (Array.isArray(body.items)) {
      if (body.items.length > 500) {
        return NextResponse.json({ error: "한 번에 처리할 수 있는 Weekly source는 최대 500개입니다." }, { status: 400 });
      }
      const invalidItem = body.items.find(item => !item.ticketKey || !item.weeklyText || !item.sourceId);
      if (invalidItem) {
        return NextResponse.json({ error: "items의 ticketKey, weeklyText, sourceId는 필수입니다." }, { status: 400 });
      }
      const result = await persistWeeklySyncBatch({
        items: body.items,
        attempts: body.attempts,
        sourceTexts: body.sourceTexts,
        timings: body.timings,
      });
      return NextResponse.json(result);
    }
    ({ ticketKey, sourceId } = body);
    const { weeklyText } = body;
    if (!ticketKey || !weeklyText) {
      return NextResponse.json({ error: "ticketKey and weeklyText required" }, { status: 400 });
    }

    const parsed = parseWeekly(weeklyText, ticketKey);
    const result = await persistWeeklySync(ticketKey, parsed, sourceId);
    return NextResponse.json(result);
  } catch (e) {
    const lockTimeout = e instanceof RedisLockTimeoutError;
    const status = lockTimeout ? 503 : 500;
    const code = lockTimeout ? "redis_lock_timeout" : "weekly_sync_failed";
    console.error(
      `[weekly-sync POST] ticket=${ticketKey ?? "unknown"} source=${sourceId ?? "unknown"} code=${code}`,
      e,
    );
    return NextResponse.json({
      error: String(e),
      code,
      retryable: lockTimeout,
      ticketKey,
      sourceId,
    }, { status });
  }
}

// ─── PUT: update candidate 승인/기각 ──────────────────────────
// Body: { candidateId: string, action: "apply" | "dismiss" }
//
// 정책 (safety / silent loss 방지):
//   - apply 시 target row를 getRowAllKeys (stableTaskId + mergeKey + role 추론 stableTaskId)로
//     multi-key lookup. legacy row(mergeKey=undefined) + 신 candidate 모두 매칭.
//   - row를 찾지 못하면 HTTP 409 + 명확한 reason + searchedKeys 응답.
//   - candidate는 resolved 처리하지 않음 — 재시도 가능.
//   - dismiss는 row lookup 없이 candidate만 closed (사용자가 명시적 기각).
export async function PUT(request: Request) {
  try {
    const body = await request.json() as { candidateId: string; action: "apply" | "dismiss" };
    const { candidateId, action } = body;
    if (!candidateId || !action) {
      return NextResponse.json({ error: "candidateId and action required" }, { status: 400 });
    }
    const allCandidates = await redis.get<UpdateCandidate[]>("cc-update-candidates") ?? [];
    const candidate = allCandidates.find(c => c.id === candidateId);
    if (!candidate) {
      return NextResponse.json({ error: "candidate not found" }, { status: 404 });
    }
    const now = new Date().toISOString();

    if (action === "dismiss") {
      // dismiss는 row lookup 불필요 — candidate만 closed
      const dismissed = allCandidates.map(c =>
        c.id === candidateId ? { ...c, resolved: true, resolvedAt: now } : c
      );
      await redis.set("cc-update-candidates", dismissed);
      return NextResponse.json({ ok: true, action, candidateId });
    }

    // action === "apply"
    const allSchedules = await redis.get<Record<string, unknown[]>>("cc-schedules") ?? {};
    const ticketSchedules = (allSchedules[candidate.ticketKey] ?? []) as ExtendedSchedule[];

    // multi-key lookup: 각 row의 getRowAllKeys 후보 중 candidate.mergeKey와 일치하는 것 찾기
    let idx = -1;
    let matchedBy: string | undefined;
    for (let i = 0; i < ticketSchedules.length; i++) {
      const rowKeys = getRowAllKeys(candidate.ticketKey, ticketSchedules[i]);
      if (rowKeys.includes(candidate.mergeKey)) {
        idx = i;
        matchedBy = candidate.mergeKey;
        break;
      }
    }

    if (idx < 0) {
      // row 찾지 못함 — candidate를 resolved 처리하지 않고 명시적 에러 반환 (silent loss 방지)
      const searchedKeys = ticketSchedules.flatMap(r => getRowAllKeys(candidate.ticketKey, r));
      return NextResponse.json(
        {
          ok: false,
          error: "target_schedule_row_not_found",
          message: "대상 schedule row를 찾지 못해 변경을 적용하지 않았습니다. candidate는 unresolved로 유지됩니다.",
          candidateId,
          mergeKey: candidate.mergeKey,
          searchedKeys: [...new Set(searchedKeys)].slice(0, 50),  // 첫 50개만 — 응답 크기 제한
        },
        { status: 409 },
      );
    }

    // 실제 schedule에 값 반영
    ticketSchedules[idx] = { ...ticketSchedules[idx], [candidate.field]: candidate.newValue };
    allSchedules[candidate.ticketKey] = ticketSchedules as unknown as Array<Record<string, unknown>>;
    await redis.set("cc-schedules", allSchedules);

    // candidate resolved 처리
    const updated = allCandidates.map(c =>
      c.id === candidateId ? { ...c, resolved: true, resolvedAt: now } : c
    );
    await redis.set("cc-update-candidates", updated);

    return NextResponse.json({ ok: true, action, candidateId, appliedRowIndex: idx, matchedBy });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
