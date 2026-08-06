const TICKET_DETAIL_PARAMS = ["ticket", "focus", "source", "mode"] as const;

/**
 * 집중보기에서 목록으로 돌아갈 때 상세 화면 전용 query만 제거한다.
 * 검색어, 필터, 탭처럼 목록 문맥을 나타내는 query는 그대로 보존한다.
 */
export function buildTicketListUrl(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  for (const key of TICKET_DETAIL_PARAMS) params.delete(key);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
