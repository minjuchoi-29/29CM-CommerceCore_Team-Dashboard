import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import type { Ticket } from "@/app/jira-tickets/TicketBoard";
import type { StoredSnapshots, SnapshotSet } from "@/lib/transitions";
import { buildTicketSnapshot, snapshotLabel, MAX_SNAPSHOTS } from "@/lib/transitions";

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

// Vercel Cron이 호출하는 핸들러 (매일 09:00 KST)
// KV의 cc-custom-keys를 읽어 JIRA 재조회 → cc-custom-tickets KV 갱신
// ⚠️ SAFE-MERGE: fetch 실패 티켓은 기존 KV 데이터를 그대로 보존 (덮어쓰기 금지)
export async function GET(request: Request) {
  // Vercel Cron 인증: 프로덕션에서는 CRON_SECRET 환경변수로 보호
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

  try {
    // 1. KV에서 커스텀 키 목록 읽기
    const customKeys = await redis.get<string[]>("cc-custom-keys");
    if (!customKeys || customKeys.length === 0) {
      return NextResponse.json({ ok: true, message: "커스텀 티켓 없음", refreshed: 0 });
    }

    // ─── SAFE-MERGE: 기존 KV 데이터를 먼저 읽어 Map으로 색인 ───────────────
    // fetch 실패 시 기존 데이터를 보존하기 위해 반드시 먼저 읽어야 함
    const existingTickets = await redis.get<Ticket[]>("cc-custom-tickets") ?? [];
    const existingByKey = new Map(existingTickets.map(t => [t.key, t]));
    console.log(`[daily-refresh] 기존 KV 티켓: ${existingTickets.length}개, cc-custom-keys: ${customKeys.length}개`);

    // 2. JIRA에서 커스텀 티켓 재조회 (병렬 처리)
    const auth = Buffer.from(`${email}:${token}`).toString("base64");
    const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };
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
          if (!res.ok) {
            failedKeys.push(key);
            return;
          }
          const data = await res.json();
          if (!data.issues || (data.issues as unknown[]).length === 0) {
            failedKeys.push(key);
            return;
          }
          const issue = (data.issues as Array<Record<string, unknown>>)[0];
          const f = issue.fields as Record<string, unknown>;
          const status = f.status as Record<string, unknown>;
          const assignee = f.assignee as Record<string, unknown> | null;
          const issuetype = f.issuetype as Record<string, unknown>;
          const project = f.project as Record<string, unknown>;
          const parent = f.parent as Record<string, unknown> | null;
          const priority = f.priority as Record<string, unknown> | null;
          const healthCheck = f.customfield_10071 as Record<string, unknown> | null;
          const requestDept = f.customfield_14402 as Record<string, unknown> | null;
          freshByKey.set(key, {
            key: issue.key as string,
            summary: f.summary as string,
            status: status.name as string,
            assignee: ((assignee?.displayName as string | undefined) ?? "-").split("/")[0].trim() || "-",
            eta: (f.duedate as string | undefined) ?? "-",
            type: issuetype.name as string,
            project: project.key as string,
            startDate: (f.customfield_10015 as string | undefined) ?? undefined,
            storyPoints: (f.customfield_10036 as number | undefined) ?? undefined,
            twoPagerUrl: extractUrl(f.customfield_10070),
            healthCheck: healthCheck?.value as string | undefined,
            requestDept: requestDept?.value as string | undefined,
            requestPriority: priority?.name as string | undefined,
            parent: parent?.key as string | undefined,
          });
        } catch (err) {
          console.warn(`[daily-refresh] ${key} fetch 실패:`, err);
          failedKeys.push(key);
        }
      })
    );

    // ─── SAFE-MERGE: 성공한 티켓은 새 데이터, 실패한 티켓은 기존 데이터 유지 ──
    // 순서는 cc-custom-keys 기준으로 정렬
    const mergedTickets: Ticket[] = customKeys
      .map(key => freshByKey.get(key) ?? existingByKey.get(key))
      .filter((t): t is Ticket => t !== undefined);

    const refreshedCount = freshByKey.size;
    const preservedCount = failedKeys.filter(k => existingByKey.has(k)).length;
    const lostCount = failedKeys.filter(k => !existingByKey.has(k)).length;

    console.log(`[daily-refresh] 갱신: ${refreshedCount}개, 기존보존: ${preservedCount}개, 유실: ${lostCount}개`);

    // 3. KV 갱신 (SAFE-MERGE 결과만 저장 — 절대 부분 덮어쓰기 금지)
    if (mergedTickets.length > 0) {
      await redis.set("cc-custom-tickets", mergedTickets);
      console.log(`[daily-refresh] cc-custom-tickets 갱신 완료: ${mergedTickets.length}개`);
    } else {
      console.warn("[daily-refresh] mergedTickets가 비어있어 KV 쓰기 생략");
    }

    // 4. Transition Snapshot 저장 (하루 1회 — 오늘 이미 있으면 스킵)
    try {
      const now      = new Date().toISOString();
      const todayStr = now.slice(0, 10);
      const stored   = (await redis.get<StoredSnapshots>("cc-transition-snapshots")) ?? { snapshots: [] };
      const alreadyToday = stored.snapshots.find(s => s.takenAt.startsWith(todayStr));

      if (!alreadyToday && mergedTickets.length > 0) {
        // planning 데이터는 cc-planning에서 조회
        const planningData = await redis.get<Record<string, unknown>>("cc-planning") ?? {};
        const snapshotTickets: SnapshotSet["tickets"] = {};
        for (const t of mergedTickets) {
          snapshotTickets[t.key] = buildTicketSnapshot(t.key, t.status, t.eta, planningData[t.key]);
        }
        const newSnap: SnapshotSet = {
          takenAt: now,
          label:   snapshotLabel(now),
          tickets: snapshotTickets,
        };
        const snapshots = [...stored.snapshots, newSnap].slice(-MAX_SNAPSHOTS);
        await redis.set("cc-transition-snapshots", { snapshots });
        console.log(`[daily-refresh] Transition snapshot 저장: ${Object.keys(snapshotTickets).length}개 티켓`);
      }
    } catch (snapErr) {
      // 스냅샷 저장 실패는 cron 전체를 실패시키지 않음
      console.warn("[daily-refresh] Transition snapshot 저장 실패:", snapErr);
    }

    return NextResponse.json({
      ok: true,
      refreshed: refreshedCount,
      preserved: preservedCount,
      lost: lostCount,
      total: customKeys.length,
      merged: mergedTickets.length,
      failedKeys: failedKeys.length > 0 ? failedKeys : undefined,
      refreshedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[daily-refresh]", e);
    return NextResponse.json({ error: "갱신 실패" }, { status: 500 });
  }
}
