/**
 * POST /api/jira-filters/[id]/sync
 *
 * 지정 필터의 Jira 이슈를 페이지네이션으로 가져와
 * cc-filter-tickets, cc-ticket-sources를 갱신합니다.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { adminApiGuard } from "@/lib/auth/admin";
import { redis } from "@/lib/redis";
import type {
  FilterSyncResult,
  FilterTicketsStore,
  JiraFiltersStore,
  TicketSourceEntry,
  TicketSourcesStore,
} from "@/lib/filter-types";
import { TICKET_KEYS } from "@/app/jira-tickets/tickets-data";
import { fetchFilterIssueKeys } from "@/lib/filter-sync";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const block = adminApiGuard(session?.user?.email);
  if (block) return block;

  const { id } = await params;

  // 필터 정보 조회
  const store = (await redis.get<JiraFiltersStore>("cc-jira-filters")) ?? {};
  const filter = store[id];
  if (!filter) {
    return NextResponse.json({ error: "필터를 찾을 수 없습니다." }, { status: 404 });
  }

  const filterLabel = filter.label ?? filter.name;
  const now = new Date().toISOString();

  let ticketKeys: string[];
  try {
    ticketKeys = await fetchFilterIssueKeys(filter.jiraFilterId);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[jira-filters sync] filterId=${id}`, errMsg);

    // 오류 상태를 필터 레코드에 기록
    store[id] = { ...filter, lastSyncAt: now, lastSyncError: errMsg };
    await redis.set("cc-jira-filters", store);

    const result: FilterSyncResult = {
      filterId: id,
      ok: false,
      ticketKeys: [],
      overlapCount: 0,
      error: errMsg,
    };
    return NextResponse.json(result, { status: 502 });
  }

  // cc-filter-tickets 업데이트
  const filterTickets = (await redis.get<FilterTicketsStore>("cc-filter-tickets")) ?? {};
  filterTickets[id] = ticketKeys;
  await redis.set("cc-filter-tickets", filterTickets);

  // cc-ticket-sources 업데이트 (append-only, 중복 dedupe)
  const ticketSources = (await redis.get<TicketSourcesStore>("cc-ticket-sources")) ?? {};
  for (const key of ticketKeys) {
    const existing = ticketSources[key] ?? [];
    const alreadyLinked = existing.some((e) => e.filterId === id);
    if (!alreadyLinked) {
      const entry: TicketSourceEntry = {
        filterId: id,
        filterLabel,
        addedAt: now,
      };
      ticketSources[key] = [...existing, entry];
    }
  }
  await redis.set("cc-ticket-sources", ticketSources);

  // TICKET_KEYS(수동 등록 티켓)과 중복 수 계산 (참고용)
  const staticSet = new Set(TICKET_KEYS);
  const overlapCount = ticketKeys.filter((k) => staticSet.has(k)).length;

  // 필터 레코드 sync 결과 업데이트
  store[id] = {
    ...filter,
    prevSyncCount: filter.lastSyncCount,
    lastSyncAt: now,
    lastSyncCount: ticketKeys.length,
    lastSyncError: null,
  };
  await redis.set("cc-jira-filters", store);

  const result: FilterSyncResult = {
    filterId: id,
    ok: true,
    ticketKeys,
    overlapCount,
  };
  return NextResponse.json(result);
}
