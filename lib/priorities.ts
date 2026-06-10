/**
 * Priority Model — planning + execution split.
 *
 * Dashboard 의 user-managed priority 는 두 개념으로 분리:
 *   - planning:  과제를 언제 착수할 것인가 (Backlog / planning queue)
 *   - execution: 진행 중인 과제를 어떤 순서로 관리할 것인가
 *
 * Storage (KV):
 *   - cc-planning-priorities  (기존, 그대로 유지) → Record<ticketKey, string>
 *   - cc-execution-priorities (신규)              → Record<ticketKey, string>
 *
 * Backward compatibility:
 *   - executionPriority 미설정 시 planningPriority 값으로 fallback
 *   - 기존 priority 입력은 모두 planning 으로 보존 (마이그레이션 없음)
 *
 * 값 의미:
 *   "1" / "2" / ... / "N"  — numeric priority (1 = 최우선)
 *   "완료"                  — 완료 마커 (정렬에서 항상 마지막)
 *   undefined / 빈 문자열  — 미설정
 *
 * NOTE: Jira 의 `requestPriority` (Highest / High / Medium / Low) 는
 *   별개 시스템 — 본 모델과 무관.
 */

export type PriorityMap = Record<string, string>;

// ─── Read helpers ──────────────────────────────────────────────────────────

/** Planning priority — 직접 조회. */
export function getPlanningPriority(planning: PriorityMap, key: string): string | undefined {
  return planning[key];
}

/**
 * Execution priority — execution 우선, 없으면 planning fallback.
 *
 *   getExecutionPriority(map, key)
 *     = executionMap[key]
 *     ?? planningMap[key]
 *
 * Backward compatibility 핵심 규칙. 기존 사용자가 planning 만 입력해도
 * execution view 에서 동일 값이 노출됨.
 */
export function getExecutionPriority(
  planning: PriorityMap,
  execution: PriorityMap,
  key: string,
): string | undefined {
  return execution[key] ?? planning[key];
}

// ─── Sort helpers ──────────────────────────────────────────────────────────

/**
 * Numeric priority for sorting.
 *  - "1"..."N"               → number
 *  - "완료" / undefined / 빈 / non-numeric / 0 이하 → Infinity (정렬에서 마지막)
 */
export function priorityNumOf(raw: string | undefined): number {
  if (!raw) return Infinity;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

// ─── Duplicate counters ────────────────────────────────────────────────────

/**
 * Numeric 값 중복 카운트 (1개 map 기준).
 * planning duplicate warning 용 — planning map 만 보면 충분.
 */
export function countNumericDuplicates(map: PriorityMap): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of Object.values(map)) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) {
      const k = String(n);
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Execution priority resolved 값 (planning fallback 적용) 기준 중복 카운트.
 * Execution view 의 dup warning 은 fallback 까지 포함하여 효과적 중복 표시.
 */
export function countResolvedExecutionDuplicates(
  ticketKeys: string[],
  planning: PriorityMap,
  execution: PriorityMap,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of ticketKeys) {
    const raw = getExecutionPriority(planning, execution, key);
    if (!raw) continue;
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
      const k = String(n);
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  return counts;
}
