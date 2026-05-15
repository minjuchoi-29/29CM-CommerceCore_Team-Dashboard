import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import type { StoredSnapshots, SnapshotSet, TicketSnapshot } from "@/lib/transitions";
import { MAX_SNAPSHOTS, snapshotLabel } from "@/lib/transitions";

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
// Body: { tickets: Record<string, TicketSnapshot>, force?: boolean }
// force=true 이면 오늘 이미 저장된 스냅샷이 있어도 추가 저장.
export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      tickets: Record<string, TicketSnapshot>;
      force?: boolean;
    };

    const stored = (await redis.get<StoredSnapshots>(KV_KEY)) ?? { snapshots: [] };

    const now     = new Date().toISOString();
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

    const newSnapshot: SnapshotSet = {
      takenAt: now,
      label:   snapshotLabel(now),
      tickets: body.tickets,
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
