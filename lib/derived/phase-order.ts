/**
 * Phase Order — Jira ticket status 와 role phase 의 lifecycle 진행 순서.
 *
 * Schedule Reconciliation Phase 1 — overdue suppression 용.
 *
 * 핵심 사용처:
 *   role.end < today 이지만 ticket.status 가 이미 더 후속 phase 에 있으면
 *   해당 role 의 기한초과는 stale 표시 — UI 에서 suppress.
 *
 * 정책:
 *   - Done 상태 (배포완료/론치완료/완료/개발완료) 는 모든 role overdue suppress
 *   - Unknown / Pre-planning (HOLD / SUGGESTED / Backlog 등) 는 suppress 안 함
 *   - 동일 phase (예: ticket=개발중 + role=개발) 는 suppress 안 함 (아직 그 단계 안)
 */

/** Jira ticket status → phase order. 미지정 → -100 (suppress 없음). */
const STATUS_TO_ORDER: Record<string, number> = {
  // Pre-planning (-1): "후속 phase 진입 안 함" 로 취급 → suppress 비활성
  "SUGGESTED": -1,
  "Backlog":   -1,
  "HOLD":      -1,
  "Postponed": -1,
  "검토대기":   -1,

  // Planning (1) — 기획
  "기획중": 1,

  // Design (2) — 디자인
  "기획완료": 2,
  "디자인중": 2,

  // Pre-dev (3) — 디자인 완료 후 개발 진입 직전
  "디자인완료": 3,
  "준비중":     3,

  // Dev (4) — 개발
  "개발중":         4,
  "In Progress":   4,

  // QA (5)
  "QA중": 5,

  // Done (100) — 모든 role 의 overdue suppress
  "배포완료":   100,
  "론치완료":   100,
  "완료":      100,
  "개발완료":   100,
};

/** RoleSchedule phase → phase order. */
const ROLE_PHASE_TO_ORDER: Record<string, number> = {
  "Kick-Off": 0,
  "기획":     1,
  "디자인":   2,
  "개발":     4,
  "QA":      5,
  "Release": 6,
  "Launch":  6,
  // "기타" → -100 (comparable 아님, suppress 안 함)
  "기타":    -100,
};

/**
 * Jira ticket status → phase order.
 * 미지정 / 알 수 없는 status → -100 (suppress 안 함).
 */
export function inferPhaseOrderFromStatus(status: string): number {
  return STATUS_TO_ORDER[status] ?? -100;
}

/**
 * Role phase name → phase order.
 * 미지정 / 알 수 없는 phase → -100 (suppress 안 함).
 */
export function getRolePhaseOrder(phase: string): number {
  return ROLE_PHASE_TO_ORDER[phase] ?? -100;
}

/**
 * Ticket 의 현재 status 가 role 의 phase 보다 strict 하게 후속인지.
 *
 * 정책:
 *   - true   → role overdue suppress (이미 통과한 phase)
 *   - false  → role overdue 정상 표시
 *
 * Edge cases:
 *   - Unknown ticket status → false (suppress 안 함, 정보 부족)
 *   - Unknown / 기타 role phase → false (suppress 안 함, 명확하지 않음)
 *   - HOLD / SUGGESTED 등 Pre-planning → false (후속 phase 아님)
 *   - 동일 phase (ticket=개발중 + role=개발) → false (아직 그 단계)
 *   - Done (배포완료 등) → 모든 role suppress (100 > 모든 role order)
 */
export function isTicketPastRolePhase(ticketStatus: string, rolePhase: string): boolean {
  const ticketOrder = inferPhaseOrderFromStatus(ticketStatus);
  const roleOrder = getRolePhaseOrder(rolePhase);

  // Unknown / Pre-planning → suppress 안 함
  if (ticketOrder < 0) return false;
  // Unknown role phase → suppress 안 함
  if (roleOrder < 0) return false;

  // Strict greater — 동일 phase 는 suppress 안 함
  return ticketOrder > roleOrder;
}
