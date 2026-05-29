import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import type { Ticket } from "@/app/jira-tickets/TicketBoard";
import type { StoredSnapshots, SnapshotSet } from "@/lib/transitions";
import { buildTicketSnapshot, snapshotLabel, MAX_SNAPSHOTS } from "@/lib/transitions";
import { syncAllJiraFilters } from "@/lib/filter-sync";
import { TICKET_KEYS } from "@/app/jira-tickets/tickets-data";

export const dynamic = "force-dynamic";

const JIRA_HOST = "https://musinsa-oneteam.atlassian.net";
const FETCH_TIMEOUT_MS = 20_000;

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

/**
 * Vercel Cron 핸들러 (매일 09:00 KST)
 *
 * 단계:
 *   1. cc-custom-keys 기반 커스텀 티켓 갱신 (legacy, 비어있으면 스킵)
 *   2. Transition Snapshot 저장 (하루 1회)
 *   3. Jira Filter 일괄 sync (cc-jira-filters에 등록된 모든 필터)
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

  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) {
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

  // ══════════════════════════════════════════════════════════════════════════
  // 단계 1: cc-custom-keys 기반 커스텀 티켓 갱신 (legacy)
  // SAFE-MERGE: fetch 실패 티켓은 기존 KV 데이터를 그대로 보존
  // ══════════════════════════════════════════════════════════════════════════
  try {
    const customKeys = await redis.get<string[]>("cc-custom-keys");

    if (customKeys && customKeys.length > 0) {
      // 기존 KV 데이터 먼저 읽기 (실패 시 보존용)
      const existingTickets = await redis.get<Ticket[]>("cc-custom-tickets") ?? [];
      const existingByKey = new Map(existingTickets.map(t => [t.key, t]));
      console.log(`[daily-refresh] cc-custom-keys: ${customKeys.length}개`);

      const authBase64 = Buffer.from(`${email}:${token}`).toString("base64");
      const headers = { Authorization: `Basic ${authBase64}`, Accept: "application/json" };
      const FIELDS = [
        "summary", "status", "assignee", "issuetype", "project", "duedate",
        "priority", "parent",
        "customfield_10015",
        "customfield_10036",
        "customfield_10070",
        "customfield_10071",
        "customfield_14402",
      ].join(",");

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
              assignee:      (((f.assignee as Record<string, unknown> | null)?.displayName as string) ?? "-").split("/")[0].trim() || "-",
              eta:           (f.duedate as string | undefined) ?? "-",
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
        errors.push(`snapshot: ${snapErr instanceof Error ? snapErr.message : String(snapErr)}`);
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
    errors.push(`custom-keys: ${msg}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 단계 3: Jira Filter 일괄 sync
  //
  // 보호 정책:
  //   - TICKET_KEYS(수동 등록 티켓) 변경 금지 — manualKeySet은 overlapCount 계산에만 사용
  //   - cc-hidden-keys 읽기/쓰기 없음
  //   - 개별 필터 실패는 lastSyncError 기록 후 계속 진행
  //   - 필터에서 빠진 티켓 자동 삭제 없음 (cc-filter-tickets 키만 교체)
  // ══════════════════════════════════════════════════════════════════════════
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
    errors.push(`filter-sync: ${msg}`);
  }

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
    errors: errors.length > 0 ? errors : undefined,
    refreshedAt,
  });
}
