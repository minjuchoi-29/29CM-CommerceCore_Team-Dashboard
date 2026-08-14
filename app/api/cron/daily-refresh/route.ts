import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import type { Ticket } from "@/app/jira-tickets/TicketBoard";
import type { StoredSnapshots, SnapshotSet } from "@/lib/transitions";
import { buildTicketSnapshot, snapshotLabel, MAX_SNAPSHOTS } from "@/lib/transitions";
import { JIRA_BATCH_FIELDS_STR } from "@/lib/jira-fields";
import { syncAllJiraFilters } from "@/lib/filter-sync";
import { TICKET_KEYS } from "@/app/jira-tickets/tickets-data";
import { POST as refreshJiraTicketsIncrementally } from "@/app/api/jira-tickets/route";
import { GET as fetchJiraWeeklySource } from "@/app/api/jira-weekly-source/route";
import { POST as persistWeeklyBatch } from "@/app/api/weekly-sync/route";
import { readJiraTicketCache } from "@/lib/jira-ticket-cache";
import { mergeTicketKeyLists } from "@/lib/ticket-sources";
import type { FilterTicketsStore, JiraFiltersStore } from "@/lib/filter-types";
import type { LinkedTicketRegistry } from "@/lib/linked-ticket-discovery";
import { selectWeeklySyncTargets } from "@/lib/weekly-targets";
import { prepareWeeklySync, type JiraWeeklySourceResponse } from "@/lib/weekly-sync-client";
import type { WeeklySourceText } from "@/lib/weekly-types";
import {
  addSyncRunStage,
  completeSyncRun,
  createSyncRun,
  saveSyncRun,
  startSyncRun,
} from "@/lib/sync-runs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JIRA_HOST = "https://musinsa-oneteam.atlassian.net";
const FETCH_TIMEOUT_MS = 20_000;
const AUTO_WEEKLY_PENDING_KEY = "cc-auto-weekly-pending-keys";
const AUTO_WEEKLY_CONCURRENCY = 8;
const MAX_AUTO_WEEKLY_TARGETS = 40;
const AUTO_WEEKLY_BOOTSTRAP_LOOKBACK_MS = 48 * 60 * 60 * 1_000;

function extractUrl(val: unknown): string | undefined {
  if (!val) return undefined;
  if (typeof val === "string") return val || undefined;
  if (typeof val === "object") {
    const v = val as Record<string, unknown>;
    return ((v.url ?? v.href ?? v.link) as string | undefined) || undefined;
  }
  return undefined;
}

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseStoredStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function uniqueKeys(keys: string[]): string[] {
  return [...new Set(keys.map(key => key.trim().toUpperCase()).filter(Boolean))];
}

function isRecentlyUpdated(ticket: Pick<Ticket, "updatedAt">, nowMs: number): boolean {
  if (!ticket.updatedAt) return false;
  const updatedMs = new Date(ticket.updatedAt).getTime();
  return Number.isFinite(updatedMs) && nowMs - updatedMs <= AUTO_WEEKLY_BOOTSTRAP_LOOKBACK_MS;
}

/**
 * Vercel Cron 핸들러 (매일 09:00 KST)
 *
 * 단계:
 *   1. cc-custom-keys 기반 커스텀 티켓 갱신 (legacy, 비어있으면 스킵)
 *   2. Transition Snapshot 저장 (하루 1회)
 *   3. Jira Filter 일괄 sync (cc-jira-filters에 등록된 모든 필터)
 *   4. key + updated 경량 확인 후 변경된 Jira 메타데이터만 공용 캐시에 반영
 *   5. 변경된 실행/최근 완료 티켓의 Weekly만 증분 파싱·병합
 *
 * 각 단계는 독립적 try-catch — 한 단계 실패가 다른 단계를 중단시키지 않음.
 */
export async function GET(request: Request) {
  // ── Vercel Cron 인증 ──────────────────────────────────────────────────────
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const syncRun = createSyncRun("daily-refresh", "cron");
  try {
    await startSyncRun(syncRun);
  } catch (error) {
    console.warn("[daily-refresh] 실행 기록 시작 실패", error);
  }

  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) {
    addSyncRunStage(syncRun, {
      key: "environment",
      label: "환경 설정 확인",
      status: "failed",
      durationMs: 0,
      error: "JIRA 환경변수 누락",
    });
    completeSyncRun(syncRun, "failed", { error: "JIRA 환경변수 누락" });
    await saveSyncRun(syncRun).catch(error => {
      console.warn("[daily-refresh] 환경 오류 기록 저장 실패", error);
    });
    return NextResponse.json({ error: "JIRA 환경변수 누락" }, { status: 500 });
  }

  const refreshedAt = new Date().toISOString();

  // ── 결과 집계 변수 ────────────────────────────────────────────────────────
  let customResult = {
    refreshed: 0, preserved: 0, lost: 0, total: 0, merged: 0,
    failedKeys: undefined as string[] | undefined,
  };
  let snapshotSaved = false;
  let filterSyncResult: Awaited<ReturnType<typeof syncAllJiraFilters>> | null = null;
  const errors: string[] = [];
  let customStageError: string | undefined;
  let filterStageError: string | undefined;
  let metadataStageError: string | undefined;
  let weeklyStageError: string | undefined;
  let metadataResult = {
    managed: 0,
    checked: 0,
    changed: 0,
    unavailable: 0,
    cacheBootstrap: false,
  };
  const weeklyResult = {
    candidates: 0,
    processed: 0,
    applied: 0,
    noMarker: 0,
    sourceErrors: 0,
    mergeErrors: 0,
    deferred: 0,
  };
  let changedTickets: Ticket[] = [];
  let managedKeysForRun: string[] = [];
  let cacheWasEmpty = false;
  let weeklyRetryKeys: string[] = [];

  // ══════════════════════════════════════════════════════════════════════════
  // 단계 1: cc-custom-keys 기반 커스텀 티켓 갱신 (legacy)
  // SAFE-MERGE: fetch 실패 티켓은 기존 KV 데이터를 그대로 보존
  // ══════════════════════════════════════════════════════════════════════════
  const customStageStartedAt = Date.now();
  try {
    const customKeys = await redis.get<string[]>("cc-custom-keys");

    if (customKeys && customKeys.length > 0) {
      // 기존 KV 데이터 먼저 읽기 (실패 시 보존용)
      const existingTickets = await redis.get<Ticket[]>("cc-custom-tickets") ?? [];
      const existingByKey = new Map(existingTickets.map(t => [t.key, t]));
      console.log(`[daily-refresh] cc-custom-keys: ${customKeys.length}개`);

      const authBase64 = Buffer.from(`${email}:${token}`).toString("base64");
      const headers = { Authorization: `Basic ${authBase64}`, Accept: "application/json" };
      // β-1: Jira FIELDS 공통 상수 (lib/jira-fields.ts) 사용 — drift 정리
      // (기존 누락: reporter / issuelinks / customfield_10067 → 공통 상수로 자동 포함)
      const FIELDS = JIRA_BATCH_FIELDS_STR;

      const freshByKey = new Map<string, Ticket>();
      const failedKeys: string[] = [];

      await Promise.all(
        customKeys.map(async (key) => {
          try {
            const url =
              `${JIRA_HOST}/rest/api/3/search/jql?` +
              new URLSearchParams({ jql: `key = ${key}`, maxResults: "1", fields: FIELDS });
            const res = await fetchWithTimeout(url, { headers, cache: "no-store" });
            if (!res.ok) { failedKeys.push(key); return; }
            const data = await res.json();
            if (!data.issues || (data.issues as unknown[]).length === 0) { failedKeys.push(key); return; }

            const issue = (data.issues as Array<Record<string, unknown>>)[0];
            const f = issue.fields as Record<string, unknown>;
            const getField = <T>(k: string) => f[k] as T | undefined;

            freshByKey.set(key, {
              key:           issue.key as string,
              summary:       f.summary as string,
              status:        (f.status as Record<string, unknown>).name as string,
              statusCategory: ((f.status as Record<string, unknown>).statusCategory as Record<string, unknown> | undefined)?.key as string | undefined,
              assignee:      (((f.assignee as Record<string, unknown> | null)?.displayName as string) ?? "-").split("/")[0].trim() || "-",
              eta:           (f.duedate as string | undefined) ?? "-",
              updatedAt:     (f.updated as string | undefined) ?? undefined,
              resolutionDate: (f.resolutiondate as string | null | undefined) ?? undefined, // β-1: Done ticket 완료일
              type:          (f.issuetype as Record<string, unknown>).name as string,
              project:       (f.project as Record<string, unknown>).key as string,
              startDate:     getField<string>("customfield_10015"),
              storyPoints:   getField<number>("customfield_10036"),
              twoPagerUrl:   extractUrl(f.customfield_10070),
              healthCheck:   (getField<Record<string, unknown>>("customfield_10071"))?.value as string | undefined,
              requestDept:   (getField<Record<string, unknown>>("customfield_14402"))?.value as string | undefined,
              requestPriority: (f.priority as Record<string, unknown> | null)?.name as string | undefined,
              parent:        (f.parent as Record<string, unknown> | null)?.key as string | undefined,
            });
          } catch (err) {
            console.warn(`[daily-refresh] ${key} fetch 실패:`, err);
            failedKeys.push(key);
          }
        })
      );

      // SAFE-MERGE: 성공 티켓 새 데이터, 실패 티켓 기존 데이터 유지
      const mergedTickets: Ticket[] = customKeys
        .map(k => freshByKey.get(k) ?? existingByKey.get(k))
        .filter((t): t is Ticket => t !== undefined);

      const refreshedCount = freshByKey.size;
      const preservedCount = failedKeys.filter(k => existingByKey.has(k)).length;
      const lostCount = failedKeys.filter(k => !existingByKey.has(k)).length;

      console.log(`[daily-refresh] 갱신: ${refreshedCount}개, 기존보존: ${preservedCount}개, 유실: ${lostCount}개`);

      if (mergedTickets.length > 0) {
        await redis.set("cc-custom-tickets", mergedTickets);
      }

      // ── 단계 2: Transition Snapshot (단계 1 성공 데이터 기반) ────────────
      try {
        const todayStr = refreshedAt.slice(0, 10);
        const stored = (await redis.get<StoredSnapshots>("cc-transition-snapshots")) ?? { snapshots: [] };
        const alreadyToday = stored.snapshots.find(s => s.takenAt.startsWith(todayStr));

        if (!alreadyToday && mergedTickets.length > 0) {
          const planningData = await redis.get<Record<string, unknown>>("cc-planning") ?? {};
          const latestSnap = stored.snapshots.length > 0 ? stored.snapshots[stored.snapshots.length - 1] : null;
          const snapshotTickets: SnapshotSet["tickets"] = {};
          for (const t of mergedTickets) {
            const snap = buildTicketSnapshot(t.key, t.status, t.eta, planningData[t.key]);
            snap.firstSeenAt = latestSnap?.tickets[t.key]?.firstSeenAt ?? refreshedAt;
            snapshotTickets[t.key] = snap;
          }
          const newSnap: SnapshotSet = {
            takenAt: refreshedAt,
            label:   snapshotLabel(refreshedAt),
            tickets: snapshotTickets,
          };
          const snapshots = [...stored.snapshots, newSnap].slice(-MAX_SNAPSHOTS);
          await redis.set("cc-transition-snapshots", { snapshots });
          snapshotSaved = true;
          console.log(`[daily-refresh] Transition snapshot 저장: ${Object.keys(snapshotTickets).length}개`);
        }
      } catch (snapErr) {
        console.warn("[daily-refresh] Transition snapshot 저장 실패:", snapErr);
        const snapshotError = snapErr instanceof Error ? snapErr.message : String(snapErr);
        customStageError = `snapshot: ${snapshotError}`;
        errors.push(customStageError);
      }

      customResult = {
        refreshed: refreshedCount,
        preserved: preservedCount,
        lost: lostCount,
        total: customKeys.length,
        merged: mergedTickets.length,
        failedKeys: failedKeys.length > 0 ? failedKeys : undefined,
      };
    } else {
      console.log("[daily-refresh] cc-custom-keys 없음 — 커스텀 티켓 갱신 스킵");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[daily-refresh] 단계 1(custom-keys) 실패:", msg);
    customStageError = msg;
    errors.push(`custom-keys: ${msg}`);
  }
  addSyncRunStage(syncRun, {
    key: "custom-tickets",
    label: "수동 등록 티켓과 스냅샷 갱신",
    status: customStageError ? "failed" : customResult.total === 0 ? "skipped" : "success",
    durationMs: Date.now() - customStageStartedAt,
    counts: {
      total: customResult.total,
      refreshed: customResult.refreshed,
      preserved: customResult.preserved,
      lost: customResult.lost,
      snapshots: snapshotSaved ? 1 : 0,
    },
    error: customStageError,
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 단계 3: Jira Filter 일괄 sync
  //
  // 보호 정책:
  //   - TICKET_KEYS(수동 등록 티켓) 변경 금지 — manualKeySet은 overlapCount 계산에만 사용
  //   - cc-hidden-keys 읽기/쓰기 없음
  //   - 개별 필터 실패는 lastSyncError 기록 후 계속 진행
  //   - 필터에서 빠진 티켓 자동 삭제 없음 (cc-filter-tickets 키만 교체)
  // ══════════════════════════════════════════════════════════════════════════
  const filterStageStartedAt = Date.now();
  try {
    const manualKeySet = new Set<string>(TICKET_KEYS);
    filterSyncResult = await syncAllJiraFilters(manualKeySet);

    if (filterSyncResult.syncedFilters > 0 || filterSyncResult.failedFilters > 0) {
      console.log(
        `[daily-refresh] Filter sync 완료: ${filterSyncResult.syncedFilters}개 성공, ` +
        `${filterSyncResult.failedFilters}개 실패, 신규 소스 ${filterSyncResult.totalNewTickets}개`
      );
    } else {
      console.log("[daily-refresh] 등록된 Jira Filter 없음 — 필터 sync 스킵");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[daily-refresh] 단계 3(filter sync) 실패:", msg);
    filterStageError = msg;
    errors.push(`filter-sync: ${msg}`);
  }

  addSyncRunStage(syncRun, {
    key: "jira-filters",
    label: "Jira 데이터 소스 갱신",
    status: filterStageError || (filterSyncResult?.failedFilters ?? 0) > 0
      ? "failed"
      : (filterSyncResult?.skippedFilters ?? 0) > 0
        ? "skipped"
        : "success",
    durationMs: Date.now() - filterStageStartedAt,
    counts: {
      syncedFilters: filterSyncResult?.syncedFilters ?? 0,
      failedFilters: filterSyncResult?.failedFilters ?? 0,
      newTickets: filterSyncResult?.totalNewTickets ?? 0,
    },
    error: filterStageError,
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 단계 4: Jira 메타데이터 증분 갱신
  // - 전체 필드는 매번 조회하지 않는다.
  // - 모든 관리 key의 updated 값만 병렬 확인하고 변경된 key만 상세 조회한다.
  // - 결과는 공용 KV 캐시에 저장되어 새 브라우저도 즉시 재사용한다.
  // ══════════════════════════════════════════════════════════════════════════
  const metadataStageStartedAt = Date.now();
  try {
    const [filterTickets, filtersStore, customRaw, linkedRegistry, cacheBefore] = await Promise.all([
      redis.get<FilterTicketsStore>("cc-filter-tickets"),
      redis.get<JiraFiltersStore>("cc-jira-filters"),
      redis.get<unknown>("cc-custom-keys"),
      redis.get<LinkedTicketRegistry>("cc-linked-ticket-registry"),
      readJiraTicketCache(),
    ]);
    const customKeys = parseStoredStringArray(customRaw);
    const seedKeys = uniqueKeys([
      ...TICKET_KEYS,
      ...customKeys,
      ...Object.keys(linkedRegistry ?? {}),
    ]);
    managedKeysForRun = mergeTicketKeyLists(
      seedKeys,
      filterTickets ?? {},
      filtersStore ?? {},
    ).allKeys;
    cacheWasEmpty = Object.keys(cacheBefore.tickets).length === 0;

    const incrementalRequest = new NextRequest(new URL("/api/jira-tickets", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tickets: managedKeysForRun.map(key => ({
          key,
          updatedAt: cacheBefore.tickets[key]?.updatedAt,
        })),
      }),
    });
    const incrementalResponse = await refreshJiraTicketsIncrementally(incrementalRequest);
    const incrementalBody = await incrementalResponse.json() as {
      tickets?: Ticket[];
      checkedCount?: number;
      changedCount?: number;
      unavailableCount?: number;
      error?: string;
    };
    if (!incrementalResponse.ok || !Array.isArray(incrementalBody.tickets)) {
      throw new Error(incrementalBody.error ?? `Jira 증분 조회 실패 (${incrementalResponse.status})`);
    }
    changedTickets = incrementalBody.tickets;
    metadataResult = {
      managed: managedKeysForRun.length,
      checked: incrementalBody.checkedCount ?? managedKeysForRun.length,
      changed: incrementalBody.changedCount ?? changedTickets.length,
      unavailable: incrementalBody.unavailableCount ?? 0,
      cacheBootstrap: cacheWasEmpty,
    };
  } catch (error) {
    metadataStageError = error instanceof Error ? error.message : String(error);
    errors.push(`jira-metadata: ${metadataStageError}`);
    console.error("[daily-refresh] 단계 4(jira metadata) 실패:", error);
  }
  const metadataDurationMs = Date.now() - metadataStageStartedAt;
  addSyncRunStage(syncRun, {
    key: "jira-metadata",
    label: "변경된 Jira 기본 정보 갱신",
    status: metadataStageError ? "failed" : metadataResult.changed === 0 ? "skipped" : "success",
    durationMs: metadataDurationMs,
    counts: {
      managed: metadataResult.managed,
      checked: metadataResult.checked,
      changed: metadataResult.changed,
      unavailable: metadataResult.unavailable,
      cacheBootstrap: metadataResult.cacheBootstrap ? 1 : 0,
    },
    error: metadataStageError,
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 단계 5: 변경된 실행/최근 완료 티켓의 Weekly 증분 갱신
  // - Jira updated가 달라진 티켓만 대상으로 한다.
  // - 최초 캐시 구성 시에는 최근 48시간 변경분만 처리해 긴 첫 실행을 방지한다.
  // - 한 실행당 40개 상한과 pending queue로 timeout 없이 다음 실행에 이어간다.
  // ══════════════════════════════════════════════════════════════════════════
  const weeklyStageStartedAt = Date.now();
  try {
    if (metadataStageError) {
      throw new Error("Jira 메타데이터 갱신 실패로 Weekly 증분 동기화를 건너뜁니다.");
    }
    const [cacheAfter, hiddenRaw, pendingRaw] = await Promise.all([
      readJiraTicketCache(),
      redis.get<unknown>("cc-hidden-keys"),
      redis.get<unknown>(AUTO_WEEKLY_PENDING_KEY),
    ]);
    const hiddenKeys = new Set(parseStoredStringArray(hiddenRaw));
    const allCachedTickets = Object.values(cacheAfter.tickets);
    const eligibleTickets = selectWeeklySyncTargets(allCachedTickets, hiddenKeys, new Date()).targets;
    const eligibleByKey = new Map(eligibleTickets.map(ticket => [ticket.key, ticket]));
    const pendingKeys = parseStoredStringArray(pendingRaw).filter(key => eligibleByKey.has(key));
    const changedEligible = selectWeeklySyncTargets(changedTickets, hiddenKeys, new Date()).targets
      .filter(ticket => !cacheWasEmpty || isRecentlyUpdated(ticket, Date.now()))
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    const queueKeys = uniqueKeys([
      ...pendingKeys,
      ...changedEligible.map(ticket => ticket.key),
    ]);
    const selectedKeys = queueKeys.slice(0, MAX_AUTO_WEEKLY_TARGETS);
    const deferredKeys = queueKeys.slice(MAX_AUTO_WEEKLY_TARGETS);
    weeklyRetryKeys = queueKeys;
    const targets = selectedKeys
      .map(key => eligibleByKey.get(key))
      .filter((ticket): ticket is Ticket => Boolean(ticket));
    weeklyResult.candidates = queueKeys.length;
    weeklyResult.processed = targets.length;
    weeklyResult.deferred = deferredKeys.length;

    const batchItems: Array<{ ticketKey: string; weeklyText: string; sourceId: string }> = [];
    const attempts: Array<{ ticketKey: string; reason?: "no_marker" | "src_error" }> = [];
    const sourceTexts: Record<string, WeeklySourceText> = {};
    const sourceErrorKeys: string[] = [];

    for (let index = 0; index < targets.length; index += AUTO_WEEKLY_CONCURRENCY) {
      const chunk = targets.slice(index, index + AUTO_WEEKLY_CONCURRENCY);
      await Promise.all(chunk.map(async ticket => {
        try {
          const sourceUrl = new URL("/api/jira-weekly-source", request.url);
          sourceUrl.searchParams.set("key", ticket.key);
          sourceUrl.searchParams.set("compact", "1");
          const sourceResponse = await fetchJiraWeeklySource(new NextRequest(sourceUrl));
          const source = await sourceResponse.json() as JiraWeeklySourceResponse;
          if (!sourceResponse.ok) {
            weeklyResult.sourceErrors++;
            sourceErrorKeys.push(ticket.key);
            attempts.push({ ticketKey: ticket.key, reason: "src_error" });
            return;
          }
          const prepared = prepareWeeklySync(ticket.key, source);
          if (!prepared) {
            weeklyResult.noMarker++;
            attempts.push({ ticketKey: ticket.key, reason: "no_marker" });
            return;
          }
          batchItems.push(...prepared.items);
          sourceTexts[ticket.key] = prepared.sourceText;
          attempts.push({ ticketKey: ticket.key });
        } catch (error) {
          weeklyResult.sourceErrors++;
          sourceErrorKeys.push(ticket.key);
          attempts.push({ ticketKey: ticket.key, reason: "src_error" });
          console.error(`[daily-refresh] Weekly source ${ticket.key} 실패:`, error);
        }
      }));
    }

    const failedMergeKeys: string[] = [];
    if (targets.length > 0) {
      const persistRequest = new NextRequest(new URL("/api/weekly-sync", request.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: batchItems,
          attempts,
          sourceTexts,
          trigger: "cron",
          timings: {
            metadataMs: metadataDurationMs,
            sourceCollectionMs: Date.now() - weeklyStageStartedAt,
            targetCount: targets.length,
            skippedUnchanged: Math.max(0, metadataResult.checked - metadataResult.changed),
          },
        }),
      });
      const persistResponse = await persistWeeklyBatch(persistRequest);
      const persistBody = await persistResponse.json() as {
        summary?: { appliedTickets?: number; failedTickets?: number };
        failures?: Array<{ ticketKey?: string }>;
        error?: string;
      };
      if (!persistResponse.ok) {
        throw new Error(persistBody.error ?? `Weekly batch 저장 실패 (${persistResponse.status})`);
      }
      weeklyResult.applied = persistBody.summary?.appliedTickets ?? 0;
      weeklyResult.mergeErrors = persistBody.summary?.failedTickets ?? 0;
      failedMergeKeys.push(...(persistBody.failures ?? [])
        .map(failure => failure.ticketKey)
        .filter((key): key is string => Boolean(key)));
    }

    const nextPendingKeys = uniqueKeys([
      ...deferredKeys,
      ...sourceErrorKeys,
      ...failedMergeKeys,
    ]);
    weeklyResult.deferred = nextPendingKeys.length;
    await redis.set(AUTO_WEEKLY_PENDING_KEY, nextPendingKeys);
    weeklyRetryKeys = [];
  } catch (error) {
    weeklyStageError = error instanceof Error ? error.message : String(error);
    errors.push(`weekly-auto: ${weeklyStageError}`);
    console.error("[daily-refresh] 단계 5(weekly auto) 실패:", error);
    if (weeklyRetryKeys.length > 0) {
      await redis.set(AUTO_WEEKLY_PENDING_KEY, weeklyRetryKeys).catch(pendingError => {
        console.error("[daily-refresh] Weekly 재시도 queue 저장 실패:", pendingError);
      });
      weeklyResult.deferred = weeklyRetryKeys.length;
    }
  }
  addSyncRunStage(syncRun, {
    key: "weekly-auto",
    label: "변경된 Weekly 자동 갱신",
    status: weeklyStageError
      ? "failed"
      : weeklyResult.processed === 0
        ? "skipped"
        : weeklyResult.sourceErrors > 0 || weeklyResult.mergeErrors > 0
          ? "failed"
          : "success",
    durationMs: Date.now() - weeklyStageStartedAt,
    counts: weeklyResult,
    error: weeklyStageError,
  });

  const failedFilterCount = filterSyncResult?.failedFilters ?? 0;
  const hasPartialFailure = errors.length > 0
    || failedFilterCount > 0
    || weeklyResult.sourceErrors > 0
    || weeklyResult.mergeErrors > 0;
  const runStatus = hasPartialFailure
    ? (customResult.refreshed > 0 || (filterSyncResult?.syncedFilters ?? 0) > 0 ? "partial" : "failed")
    : "success";
  completeSyncRun(syncRun, runStatus, {
    counts: {
      refreshedTickets: customResult.refreshed,
      syncedFilters: filterSyncResult?.syncedFilters ?? 0,
      failedFilters: failedFilterCount,
      newTickets: filterSyncResult?.totalNewTickets ?? 0,
      managedTickets: metadataResult.managed,
      metadataChanged: metadataResult.changed,
      weeklyProcessed: weeklyResult.processed,
      weeklyApplied: weeklyResult.applied,
      weeklyDeferred: weeklyResult.deferred,
    },
    error: errors.length > 0 ? errors.join(" | ") : undefined,
  });
  await saveSyncRun(syncRun).catch(error => {
    console.warn("[daily-refresh] 완료 기록 저장 실패", error);
  });

  // ── 최종 응답 ─────────────────────────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    // 단계 1: cc-custom-keys refresh
    ...customResult,
    snapshotSaved,
    // 단계 3: Jira Filter sync
    filterSync: filterSyncResult
      ? {
          syncedFilters: filterSyncResult.syncedFilters,
          failedFilters: filterSyncResult.failedFilters,
          skippedFilters: filterSyncResult.skippedFilters,
          totalNewTickets: filterSyncResult.totalNewTickets,
          results: filterSyncResult.results.map(r => ({
            filterId: r.filterId,
            filterName: r.filterName,
            ok: r.ok,
            ticketCount: r.ticketCount,
            overlapCount: r.overlapCount,
            ...(r.error ? { error: r.error } : {}),
          })),
        }
      : null,
    metadataSync: metadataResult,
    weeklySync: weeklyResult,
    errors: errors.length > 0 ? errors : undefined,
    refreshedAt,
    syncRunId: syncRun.id,
  });
}
