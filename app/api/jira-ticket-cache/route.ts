import { NextRequest, NextResponse } from "next/server";
import { isCachedTicketNewer, readJiraTicketCache } from "@/lib/jira-ticket-cache";

export const dynamic = "force-dynamic";

/** 공용 자동 동기화 캐시에서 브라우저보다 최신인 티켓만 반환한다. */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await request.json() as {
      tickets?: Array<{ key: string; updatedAt?: string }>;
    };
    const candidates = Array.isArray(body.tickets) ? body.tickets : [];
    if (candidates.length > 1_000) {
      return NextResponse.json({ error: "한 번에 비교할 수 있는 티켓은 최대 1,000개입니다." }, { status: 400 });
    }

    const cache = await readJiraTicketCache();
    const refreshed = candidates.flatMap(candidate => {
      const cached = cache.tickets[candidate.key.trim().toUpperCase()];
      if (!cached) return [];
      return isCachedTicketNewer(cached.updatedAt, candidate.updatedAt) ? [cached] : [];
    });

    return NextResponse.json({
      tickets: refreshed,
      cacheUpdatedAt: cache.updatedAt || null,
      checkedCount: candidates.length,
      changedCount: refreshed.length,
      durationMs: Date.now() - startedAt,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[jira-ticket-cache] 공용 캐시 비교 실패:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
