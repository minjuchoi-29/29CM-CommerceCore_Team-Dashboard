/**
 * DELETE /api/jira-filters/[id]  — 필터 삭제 (KV에서 제거, 티켓 소스 정리)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { adminApiGuard } from "@/lib/auth/admin";
import { redis } from "@/lib/redis";
import type {
  FilterTicketsStore,
  JiraFiltersStore,
  TicketSourcesStore,
} from "@/lib/filter-types";

export const dynamic = "force-dynamic";

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
