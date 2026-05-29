/**
 * lib/ticket-sources.ts
 *
 * Jira Filter 기반 티켓 소스 관리 헬퍼
 *
 * TICKET_KEYS(수동 등록) + cc-filter-tickets(필터 동기화) 를
 * key 기준 dedupe하여 병합하는 서버 전용 유틸.
 *
 * 클라이언트 컴포넌트에서는 이 파일을 직접 import하지 마세요.
 * (redis import가 포함될 수 있음)
 */

import type { FilterTicketsStore, JiraFiltersStore } from "@/lib/filter-types";

/**
 * TICKET_KEYS(수동) + cc-filter-tickets(필터) 를 key 기준 merge, 중복 제거.
 *
 * @returns
 *   - allKeys: TICKET_KEYS 순서 유지 → 필터 전용 키 추가
 *   - filterOnlyKeys: TICKET_KEYS에 없는 필터 기반 키
 */
export function mergeTicketKeyLists(
  manualKeys: string[],
  filterTickets: FilterTicketsStore,
): { allKeys: string[]; filterOnlyKeys: string[] } {
  const seen = new Set<string>(manualKeys);
  const filterOnlyKeys: string[] = [];

  for (const keys of Object.values(filterTickets)) {
    for (const key of keys) {
      if (!seen.has(key)) {
        seen.add(key);
        filterOnlyKeys.push(key);
      }
    }
  }

  return {
    allKeys: [...manualKeys, ...filterOnlyKeys],
    filterOnlyKeys,
  };
}

/**
 * 각 티켓에 소속 필터 레이블 목록을 계산한다.
 *
 * cc-filter-tickets: filterId → string[] (티켓 키 목록)
 * cc-jira-filters: filterId → JiraFilter (필터 메타)
 *
 * @returns Record<ticketKey, filterLabel[]> — TICKET_KEYS 티켓은 항목 없음
 */
export function buildSourceFiltersMap(
  filterTickets: FilterTicketsStore,
  filtersStore: JiraFiltersStore,
): Record<string, string[]> {
  const map: Record<string, string[]> = {};

  for (const [filterId, keys] of Object.entries(filterTickets)) {
    const filter = filtersStore[filterId];
    if (!filter) continue; // 삭제된 필터 건너뜀
    const label = filter.label ?? filter.name;

    for (const key of keys) {
      if (!map[key]) map[key] = [];
      // 중복 방지
      if (!map[key].includes(label)) map[key].push(label);
    }
  }

  return map;
}

/**
 * 티켓 row에 표시할 source chip 텍스트를 반환.
 *
 * - 필터 1개: 필터 레이블 (16자 초과 시 말줄임)
 * - 필터 N개: "필터 N개"
 * - 없으면 null
 */
export function getSourceChipText(sourceFilters: string[] | undefined): string | null {
  if (!sourceFilters || sourceFilters.length === 0) return null;
  if (sourceFilters.length === 1) {
    const label = sourceFilters[0];
    return label.length > 16 ? label.slice(0, 14) + "…" : label;
  }
  return `필터 ${sourceFilters.length}개`;
}
