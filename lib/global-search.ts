/**
 * Global Search — Dashboard 통합 검색 helpers.
 *
 * 검색 대상 unification:
 *   - 전체 과제 현황 ticket (key 가 ETR-* 아님) → location="전체 과제 현황", kind="ticket"
 *   - ETR 검토 ticket   (key 가 ETR-*)            → location="ETR 검토",       kind="etr"
 * 동일 ticket 소스 1개 (/api/jira-tickets) 에서 split.
 *
 * Routing:
 *   - ticket → /jira-tickets?q=<q>&ticket=<key>
 *   - etr    → /etr-review?q=<q>&key=<key>
 */

export type GlobalSearchSourceTicket = {
  key: string;
  summary?: string;
  status?: string;
  assignee?: string;
  reporter?: string;
  project?: string;
  priority?: string;
  requestPriority?: string;
  eta?: string;
};

export type GlobalSearchKind = "ticket" | "etr";
export type GlobalSearchLocation = "전체 과제 현황" | "ETR 검토";

export type GlobalSearchResult = {
  kind: GlobalSearchKind;
  key: string;
  summary: string;
  status: string;
  assignee: string;
  location: GlobalSearchLocation;
  destination: string;
};

const norm = (s: string | undefined | null): string => (s ?? "").toLowerCase();

export function getSearchDestination(
  kind: GlobalSearchKind,
  key: string,
  query: string,
): string {
  const q = encodeURIComponent(query);
  const k = encodeURIComponent(key);
  return kind === "etr"
    ? `/etr-review?q=${q}&key=${k}`
    : `/jira-tickets?q=${q}&ticket=${k}`;
}

/**
 * 통합 검색 — case-insensitive substring 매칭.
 * 매칭 field 우선순위 (관련성 점수 단순화):
 *   - key 정확 매칭 → 0 (최우선)
 *   - key prefix       → 1
 *   - key contains     → 2
 *   - summary contains → 3
 *   - assignee/reporter → 4
 *   - 그 외 (status/project/priority/eta) → 5
 * 같은 key 의 중복은 1건만 유지 (먼저 발견된 결과 사용).
 */
export function buildGlobalSearchResults(
  query: string,
  sourceTickets: GlobalSearchSourceTicket[],
  opts?: { limit?: number },
): GlobalSearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const limit = opts?.limit ?? 30;
  const ql = q.toLowerCase();

  type Scored = { result: GlobalSearchResult; score: number };
  const scored: Scored[] = [];
  const seen = new Set<string>();

  for (const t of sourceTickets) {
    if (!t.key) continue;
    if (seen.has(t.key)) continue;
    const keyL = t.key.toLowerCase();
    const summaryL = norm(t.summary);
    const assigneeL = norm(t.assignee);
    const reporterL = norm(t.reporter);
    const projectL = norm(t.project);
    const statusL = norm(t.status);
    const priorityL = norm(t.priority || t.requestPriority);
    const etaL = norm(t.eta);

    let score = -1;
    if (keyL === ql)               score = 0;
    else if (keyL.startsWith(ql))  score = 1;
    else if (keyL.includes(ql))    score = 2;
    else if (summaryL.includes(ql))score = 3;
    else if (assigneeL.includes(ql) || reporterL.includes(ql)) score = 4;
    else if (
      projectL.includes(ql)  ||
      statusL.includes(ql)   ||
      priorityL.includes(ql) ||
      etaL.includes(ql)
    ) score = 5;
    if (score < 0) continue;

    const isEtr = t.key.startsWith("ETR-");
    const result: GlobalSearchResult = {
      kind: isEtr ? "etr" : "ticket",
      key: t.key,
      summary: t.summary ?? "",
      status: t.status ?? "",
      assignee: t.assignee ?? "",
      location: isEtr ? "ETR 검토" : "전체 과제 현황",
      destination: getSearchDestination(isEtr ? "etr" : "ticket", t.key, q),
    };
    scored.push({ result, score });
    seen.add(t.key);
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.result.key.localeCompare(b.result.key);
  });

  return scored.slice(0, limit).map(s => s.result);
}
