import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { parseWeekly } from "@/lib/weekly-parser";
import { mergeWeeklySync } from "@/lib/weekly-merge";
import { fetchWeeklyTextFromJira } from "@/lib/jira-weekly-fetch";
import type {
  WeeklyNote, UpdateCandidate, WeeklySyncMeta,
} from "@/lib/weekly-types";
import type { ExtendedSchedule } from "@/lib/weekly-merge";

export const dynamic = "force-dynamic";

// 한 ticket 처리 결과 (단일 + 배치 공용)
interface SyncResult {
  ticketKey: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  source?: "description" | "comment" | "client";
  sourceWeek?: string;
  schedulesTotal?: number;
  newNotes?: number;
  newCandidates?: number;
  staleCandidates?: number;
  isIdempotent?: boolean;
  error?: string;
}

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

// ─── 한 ticket 을 sync 하는 내부 함수 ────────────────────────
// (KV는 호출부에서 한 번에 읽고/쓰도록 caches 를 받음)
interface SyncCaches {
  allSchedules: Record<string, unknown>;
  allNotes: Record<string, WeeklyNote[]>;
  allCandidates: UpdateCandidate[];
  allMeta: Record<string, WeeklySyncMeta>;
}

async function syncOneTicket(
  ticketKey: string,
  weeklyTextOverride: string | undefined,
  caches: SyncCaches,
): Promise<SyncResult> {
  // 1) weekly text 확보
  let weeklyText: string | null = weeklyTextOverride ?? null;
  let source: SyncResult["source"] = weeklyTextOverride ? "client" : undefined;
  if (!weeklyText) {
    try {
      const fetched = await fetchWeeklyTextFromJira(ticketKey);
      weeklyText = fetched.weeklyText;
      if (fetched.source !== "none") source = fetched.source;
    } catch (e) {
      return { ticketKey, ok: false, error: `jira fetch: ${String(e)}` };
    }
  }
  if (!weeklyText) {
    return { ticketKey, ok: true, skipped: true, reason: "no_weekly_marker" };
  }

  // 2) 파싱
  const parsed = parseWeekly(weeklyText, ticketKey);

  // 3) 기존 데이터 (caches 사용)
  const existingSchedules = ((caches.allSchedules[ticketKey] ?? []) as ExtendedSchedule[]);
  const existingNotes = caches.allNotes[ticketKey] ?? [];

  // 4) Merge
  const result = mergeWeeklySync(ticketKey, parsed, existingSchedules, existingNotes);

  // 5) caches 에 반영 (호출부가 한 번에 KV write)
  caches.allSchedules[ticketKey] = result.updatedSchedules;
  caches.allNotes[ticketKey] = result.newNotes;

  // candidates — id 중복 제거 (기존 보존)
  const existingCandidateIds = new Set(caches.allCandidates.map(c => c.id));
  const freshCandidates = result.updateCandidates.filter(c => !existingCandidateIds.has(c.id));
  caches.allCandidates.push(...freshCandidates);

  caches.allMeta[ticketKey] = {
    ticketKey,
    lastSyncAt: new Date().toISOString(),
    lastSourceWeek: parsed.sourceWeek,
  };

  return {
    ticketKey,
    ok: true,
    source,
    sourceWeek: parsed.sourceWeek,
    schedulesTotal: result.updatedSchedules.length,
    newNotes: result.newNotes.length - existingNotes.length,
    newCandidates: freshCandidates.length,
    staleCandidates: result.staleCandidates.length,
    isIdempotent: result.isIdempotent,
  };
}

// ─── POST: weekly sync ─────────────────────────────────────────
// Body 형태:
//   1) 단일: { ticketKey, weeklyText? }   — weeklyText 없으면 서버가 Jira에서 fetch
//   2) 배치: { ticketKeys: string[] }     — 각 티켓을 순차 처리, Jira에서 fetch
export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      ticketKey?: string;
      ticketKeys?: string[];
      weeklyText?: string;
    };

    // 처리할 ticket 목록 결정
    let targets: Array<{ key: string; text?: string }> = [];
    if (Array.isArray(body.ticketKeys) && body.ticketKeys.length > 0) {
      targets = body.ticketKeys.map(k => ({ key: k }));
    } else if (body.ticketKey) {
      targets = [{ key: body.ticketKey, text: body.weeklyText }];
    } else {
      return NextResponse.json(
        { error: "ticketKey or ticketKeys required" },
        { status: 400 }
      );
    }

    // KV 일괄 로드 (모든 ticket이 동일 KV key 공유)
    const [rawSchedules, rawNotes, rawCandidates, rawMeta] = await Promise.all([
      redis.get<Record<string, unknown>>("cc-schedules"),
      redis.get<Record<string, WeeklyNote[]>>("cc-weekly-notes"),
      redis.get<UpdateCandidate[]>("cc-update-candidates"),
      redis.get<Record<string, WeeklySyncMeta>>("cc-weekly-sync-meta"),
    ]);
    const caches: SyncCaches = {
      allSchedules: rawSchedules ?? {},
      allNotes: rawNotes ?? {},
      allCandidates: rawCandidates ?? [],
      allMeta: rawMeta ?? {},
    };

    // 순차 처리 (Jira rate-limit 회피 + caches mutation 안전)
    const results: SyncResult[] = [];
    for (const t of targets) {
      const r = await syncOneTicket(t.key, t.text, caches);
      results.push(r);
      // 서버 로그 (Vercel logs에 남음)
      if (!r.ok) {
        console.error(`[weekly-sync] ${t.key} FAIL`, r.error);
      } else if (r.skipped) {
        console.log(`[weekly-sync] ${t.key} skipped reason=${r.reason}`);
      } else {
        console.log(
          `[weekly-sync] ${t.key} src=${r.source} week=${r.sourceWeek} ` +
          `schedules=${r.schedulesTotal} newNotes=${r.newNotes} ` +
          `newCandidates=${r.newCandidates} stale=${r.staleCandidates} ` +
          `idempotent=${r.isIdempotent}`
        );
      }
    }

    // KV 일괄 저장 (실패한 ticket이 있어도 다른 ticket 결과는 보존)
    await Promise.all([
      redis.set("cc-schedules", caches.allSchedules),
      redis.set("cc-weekly-notes", caches.allNotes),
      redis.set("cc-update-candidates", caches.allCandidates),
      redis.set("cc-weekly-sync-meta", caches.allMeta),
    ]);

    // 집계
    const totals = {
      total: results.length,
      synced: results.filter(r => r.ok && !r.skipped).length,
      skipped: results.filter(r => r.skipped).length,
      failed: results.filter(r => !r.ok).length,
      newNotes: results.reduce((s, r) => s + (r.newNotes ?? 0), 0),
      newCandidates: results.reduce((s, r) => s + (r.newCandidates ?? 0), 0),
      staleCandidates: results.reduce((s, r) => s + (r.staleCandidates ?? 0), 0),
    };

    return NextResponse.json({ ok: true, totals, results });
  } catch (e) {
    console.error("[weekly-sync POST]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ─── PUT: update candidate 승인/기각 ──────────────────────────
// Body: { candidateId: string, action: "apply" | "dismiss" }
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
    const updated = allCandidates.map(c =>
      c.id === candidateId ? { ...c, resolved: true, resolvedAt: now } : c
    );
    await redis.set("cc-update-candidates", updated);

    if (action === "apply") {
      // 실제 schedule에 값 반영
      const allSchedules = await redis.get<Record<string, unknown[]>>("cc-schedules") ?? {};
      const ticketSchedules = (allSchedules[candidate.ticketKey] ?? []) as Array<Record<string, unknown>>;
      const idx = ticketSchedules.findIndex(
        (s) => (s.mergeKey as string | undefined) === candidate.mergeKey
      );
      if (idx >= 0) {
        ticketSchedules[idx] = { ...ticketSchedules[idx], [candidate.field]: candidate.newValue };
        allSchedules[candidate.ticketKey] = ticketSchedules;
        await redis.set("cc-schedules", allSchedules);
      }
    }
    return NextResponse.json({ ok: true, action, candidateId });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
