/**
 * PATCH  /api/jira-filters/[id] — 필터 사용 중지/재개
 * DELETE /api/jira-filters/[id] — 필터 삭제 (KV에서 제거, 티켓 소스 정리)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { adminApiGuard } from "@/lib/auth/admin";
import { redis } from "@/lib/redis";
import type {
  FilterTicketsStore,
  JiraFilter,
  JiraFiltersStore,
  TicketSourcesStore,
} from "@/lib/filter-types";
import { withRedisLock } from "@/lib/redis-lock";

export const dynamic = "force-dynamic";
const FILTER_SYNC_LOCK_KEY = "lock:cc-jira-filter-sync";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const block = adminApiGuard(session?.user?.email);
  if (block) return block;

  let body: { enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled 값은 boolean이어야 합니다." }, { status: 400 });
  }

  const { id } = await params;
  try {
    const updated = await withRedisLock(redis, FILTER_SYNC_LOCK_KEY, async () => {
      const store = (await redis.get<JiraFiltersStore>("cc-jira-filters")) ?? {};
      const current = store[id];
      if (!current) return null;
      const next: JiraFilter = { ...current, enabled: body.enabled as boolean };
      store[id] = next;
      await redis.set("cc-jira-filters", store);
      return next;
    }, { ttlMs: 10_000, waitTimeoutMs: 10_000, retryMs: 75 });

    if (!updated) {
      return NextResponse.json({ error: "필터를 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json({ filter: updated });
  } catch (error) {
    console.error("[jira-filters PATCH]", error);
    return NextResponse.json({ error: "데이터 소스 상태를 저장하지 못했습니다." }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const block = adminApiGuard(session?.user?.email);
  if (block) return block;

  const { id } = await params;

  // 필터 레지스트리에서 제거
  const store = (await redis.get<JiraFiltersStore>("cc-jira-filters")) ?? {};
  if (!store[id]) {
    return NextResponse.json({ error: "필터를 찾을 수 없습니다." }, { status: 404 });
  }
  delete store[id];
  await redis.set("cc-jira-filters", store);

  // cc-filter-tickets에서 해당 filterId 제거
  const filterTickets = (await redis.get<FilterTicketsStore>("cc-filter-tickets")) ?? {};
  delete filterTickets[id];
  await redis.set("cc-filter-tickets", filterTickets);

  // cc-ticket-sources에서 해당 filterId 엔트리 제거
  const ticketSources = (await redis.get<TicketSourcesStore>("cc-ticket-sources")) ?? {};
  let changed = false;
  for (const key of Object.keys(ticketSources)) {
    const before = ticketSources[key].length;
    ticketSources[key] = ticketSources[key].filter((e) => e.filterId !== id);
    if (ticketSources[key].length !== before) changed = true;
    // 더 이상 소속 필터가 없으면 키 자체를 삭제
    if (ticketSources[key].length === 0) delete ticketSources[key];
  }
  if (changed) await redis.set("cc-ticket-sources", ticketSources);

  return NextResponse.json({ ok: true });
}
