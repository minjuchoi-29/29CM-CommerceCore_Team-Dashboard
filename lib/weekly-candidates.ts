import type { UpdateCandidate } from "./weekly-types";

function tuple(candidate: UpdateCandidate): string {
  return `${candidate.ticketKey}::${candidate.mergeKey}::${candidate.field}`;
}

/**
 * 새 파싱 결과를 기준으로 변경 후보를 정리한다.
 *
 * - 같은 ID는 최신 계산 결과로 교체한다.
 * - 같은 행/필드의 과거 미해결 후보는 최신 후보가 생기면 종료한다.
 * - 같은 sourceWeek를 재파싱했는데 더 이상 생성되지 않는 후보는 종료한다.
 * - 다른 티켓 후보는 그대로 보존한다.
 */
export function reconcileUpdateCandidates(
  allCandidates: UpdateCandidate[],
  freshCandidates: UpdateCandidate[],
  ticketKey: string,
  sourceWeek: string,
  nowIso: string,
): UpdateCandidate[] {
  const freshById = new Map(freshCandidates.map(candidate => [candidate.id, candidate]));
  const freshTuples = new Set(freshCandidates.map(tuple));

  const reconciled = allCandidates.map(candidate => {
    const exact = freshById.get(candidate.id);
    if (exact) return exact;
    if (candidate.ticketKey !== ticketKey || candidate.resolved) return candidate;

    const obsoleteSameWeek = candidate.sourceWeek === sourceWeek;
    const supersededField = freshTuples.has(tuple(candidate));
    if (!obsoleteSameWeek && !supersededField) return candidate;

    return { ...candidate, resolved: true, resolvedAt: nowIso };
  });

  const existingIds = new Set(reconciled.map(candidate => candidate.id));
  return [
    ...reconciled,
    ...freshCandidates.filter(candidate => !existingIds.has(candidate.id)),
  ];
}
