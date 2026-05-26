import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { parseWeekly } from "@/lib/weekly-parser";
import { mergeWeeklySync, getRowAllKeys } from "@/lib/weekly-merge";
import type {
  WeeklyNote, UpdateCandidate, WeeklySyncMeta,
} from "@/lib/weekly-types";
import type { ExtendedSchedule } from "@/lib/weekly-merge";

export const dynamic = "force-dynamic";

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

// ─── POST: weekly sync ─────────────────────────────────────────
// Body: { ticketKey: string, weeklyText: string, force?: boolean }
export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      ticketKey: string;
      weeklyText: string;
      force?: boolean;
    };
    const { ticketKey, weeklyText } = body;
    if (!ticketKey || !weeklyText) {
      return NextResponse.json({ error: "ticketKey and weeklyText required" }, { status: 400 });
    }

    // 1. 파싱
    const parsed = parseWeekly(weeklyText, ticketKey);

    // 2. 기존 데이터 읽기 (?? 는 await 후 적용해야 타입이 좁혀짐)
    const [rawSchedules, rawNotes, rawCandidates] = await Promise.all([
      redis.get<Record<string, unknown[]>>("cc-schedules"),
      redis.get<Record<string, WeeklyNote[]>>("cc-weekly-notes"),
      redis.get<UpdateCandidate[]>("cc-update-candidates"),
    ]);
    const allSchedules = rawSchedules ?? {};
    const allNotes     = rawNotes     ?? {};
    const allCandidates = rawCandidates ?? [];

    const existingSchedules = ((allSchedules as Record<string, unknown>)[ticketKey] ?? []) as ExtendedSchedule[];
    const existingNotes = (allNotes as Record<string, WeeklyNote[]>)[ticketKey] ?? [];

    // 3. Merge
    const result = mergeWeeklySync(ticketKey, parsed, existingSchedules, existingNotes);

    // 4. cc-schedules 갱신
    const updatedSchedules = { ...(allSchedules as Record<string, unknown>), [ticketKey]: result.updatedSchedules };
    await redis.set("cc-schedules", updatedSchedules);

    // 5. cc-weekly-notes 갱신
    const updatedNotes = { ...(allNotes as Record<string, WeeklyNote[]>), [ticketKey]: result.newNotes };
    await redis.set("cc-weekly-notes", updatedNotes);

    // 6. cc-update-candidates — 기존 보존 + 신규 추가 (id 중복 제거)
    const existingCandidateIds = new Set(allCandidates.map((c: UpdateCandidate) => c.id));
    const freshCandidates = result.updateCandidates.filter(c => !existingCandidateIds.has(c.id));
    const mergedCandidates = [...allCandidates, ...freshCandidates];
    await redis.set("cc-update-candidates", mergedCandidates);

    // 7. cc-weekly-sync-meta 갱신
    const allMeta = await redis.get<Record<string, WeeklySyncMeta>>("cc-weekly-sync-meta") ?? {};
    allMeta[ticketKey] = {
      ticketKey,
      lastSyncAt: new Date().toISOString(),
      lastSourceWeek: parsed.sourceWeek,
    };
    await redis.set("cc-weekly-sync-meta", allMeta);

    return NextResponse.json({
      ok: true,
      sourceWeek: parsed.sourceWeek,
      schedulesUpdated: result.updatedSchedules.length,
      notesTotal: result.newNotes.length,
      newNotesAdded: result.updateCandidates.length > 0 ? result.updateCandidates.length : 0,
      updateCandidates: result.updateCandidates.length,
      staleCandidates: result.staleCandidates,
      isIdempotent: result.isIdempotent,
    });
  } catch (e) {
    console.error("[weekly-sync POST]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
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
