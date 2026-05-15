import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import type { StoredSnapshots, SnapshotSet, TicketSnapshot } from "@/lib/transitions";
import { MAX_SNAPSHOTS, snapshotLabel, buildTicketSnapshot } from "@/lib/transitions";

export const dynamic = "force-dynamic";

const KV_KEY = "cc-transition-snapshots";

// ─── GET: 저장된 스냅샷 목록 조회 ──────────────────────────────
export async function GET() {
  try {
    const stored = await redis.get<StoredSnapshots>(KV_KEY);
    return NextResponse.json(stored ?? { snapshots: [] });
  } catch (e) {
    console.error("[transitions GET]", e);
    return NextResponse.json({ snapshots: [] });
  }
}

// ─── POST: 새 스냅샷 저장 ───────────────────────────────────────
// Body: { tickets: Record<string, { ticketKey, status, eta }>, force?: boolean }
//
// ★ 핵심 개선:
//   - planning 데이터는 클라이언트 값을 믿지 않고 서버에서 직접 KV 조회
//     → React stale closure (planning={}) 문제를 근원적으로 차단
//   - firstSeenAt: 이전 스냅샷에서 carry-over하여 신규 등록 티켓 추적
//   - force=true 이면 오늘 이미 저장된 스냅샷이 있어도 추가 저장
export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      tickets: Record<string, Pick<TicketSnapshot, "ticketKey" | "status" | "eta">>;
      force?: boolean;
    };

    const stored = (await redis.get<StoredSnapshots>(KV_KEY)) ?? { snapshots: [] };

    const now      = new Date().toISOString();
    const todayStr = now.slice(0, 10); // YYYY-MM-DD

    // 오늘 이미 저장된 스냅샷이 있으면 스킵 (force=true 이면 무시)
    if (!body.force) {
      const alreadyToday = stored.snapshots.find(s => s.takenAt.startsWith(todayStr));
      if (alreadyToday) {
        return NextResponse.json({
          status: "skipped",
          reason: "already_snapshotted_today",
          snapshot: alreadyToday,
        });
      }
    }

    // ── 서버에서 planning 직접 조회 (클라이언트 stale closure 방어) ──
    const planningData = await redis.get<Record<string, unknown>>("cc-planning") ?? {};

    // ── 이전 스냅샷에서 firstSeenAt carry-over ──────────────────────
    const latestSnap = stored.snapshots.length > 0
      ? stored.snapshots[stored.snapshots.length - 1]
      : null;

    const snapshotTickets: SnapshotSet["tickets"] = {};
    for (const [key, raw] of Object.entries(body.tickets)) {
      // 서버 planning으로 스냅샷 재구성 (클라이언트 제공 planning 무시)
      const snap = buildTicketSnapshot(key, raw.status, raw.eta, planningData[key]);

      // firstSeenAt: 이전에 있었으면 carry-over, 처음 등장이면 now
      snap.firstSeenAt = latestSnap?.tickets[key]?.firstSeenAt ?? now;

      snapshotTickets[key] = snap;
    }

    const newSnapshot: SnapshotSet = {
      takenAt: now,
      label:   snapshotLabel(now),
      tickets: snapshotTickets,
    };

    // 가장 오래된 것부터 truncate → 최신 추가
    const snapshots = [...stored.snapshots, newSnapshot].slice(-MAX_SNAPSHOTS);

    await redis.set(KV_KEY, { snapshots });

    return NextResponse.json({ status: "saved", snapshot: newSnapshot });
  } catch (e) {
    console.error("[transitions POST]", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
