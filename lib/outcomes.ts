/**
 * Ticket Outcome — Done state metadata.
 *
 * Phase β-1 (Backend / Data contract).
 * Detail UI 통합은 β-2, Owner Dashboard 통합은 β-3 별도 PR.
 *
 * 저장: KV `cc-ticket-outcomes` — `Record<ticketKey, TicketOutcome>`.
 * 단일 객체 per ticket (cc-weekly-notes 처럼 array 아님).
 *
 * 정책 문서: docs/policies/done-ticket-ia.md
 */

/**
 * Done ticket 의 운영 / 회고 메타데이터.
 *
 * 모든 필드 optional — Done 처리 자체는 outcome 입력 강제하지 않음 (warn-only).
 *
 * Backward compatibility:
 *  - 기존 ticket 데이터 영향 없음 (신규 KV, optional fields)
 *  - 정책: completedAt 미입력 시 Jira resolutionDate 자동 fallback (getCompletedAt 헬퍼)
 */
export type TicketOutcome = {
  /** ISO 8601 date — 사용자 수동 입력. 미입력 시 Jira resolutionDate fallback. */
  completedAt?: string;
  /** 짧은 1-2줄 결과 요약 (Hybrid 의 short 부분). */
  outcomeSummary?: string;
  /** Optional markdown detail (Hybrid 의 long 부분). 다중 줄 / list / link 지원. */
  outcomeDetail?: string;
  /** 비즈니스 임팩트 (정량 / 정성). */
  impact?: string;
  /** cc-weekly-notes 의 sourceWeek 문자열 (예: "21주차"). 자동 매칭 또는 사용자 변경. */
  weeklyLink?: string;
  /** ISO timestamp — KV write 메타 (자동 갱신). */
  updatedAt: string;
  /** 사용자명 (TicketBoard userName prop 에서). */
  updatedBy?: string;
};

export type TicketOutcomesMap = Record<string, TicketOutcome>;

// ─── Completion Date 헬퍼 ───────────────────────────────────────────────────

/**
 * Completion date 우선순위:
 *   1. outcome.completedAt (사용자 수동 입력)
 *   2. ticket.resolutionDate (Jira fallback)
 *   3. undefined
 *
 * `??` nullish coalescing 사용 — 빈 문자열 ("") 도 그대로 반환 (의도된 동작).
 */
export function getCompletedAt(
  outcome: TicketOutcome | undefined,
  ticket: { resolutionDate?: string } | undefined,
): string | undefined {
  return outcome?.completedAt ?? ticket?.resolutionDate ?? undefined;
}

/**
 * Completion date 의 source — UI 라벨 ("(Jira)" / "(직접 입력)") 분기용.
 *
 *   "manual" — outcome.completedAt 사용 중 (수동 입력 우선)
 *   "jira"   — outcome.completedAt 없고 ticket.resolutionDate 사용 중
 *   "none"   — 둘 다 없음
 */
export type CompletedAtSource = "manual" | "jira" | "none";

export function getCompletedAtSource(
  outcome: TicketOutcome | undefined,
  ticket: { resolutionDate?: string } | undefined,
): CompletedAtSource {
  if (outcome?.completedAt) return "manual";
  if (ticket?.resolutionDate) return "jira";
  return "none";
}

// ─── Outcome Status 헬퍼 ────────────────────────────────────────────────────

/**
 * Outcome 입력 상태 — Done section warn badge / fill indicator 분기.
 *
 *   "empty"        — outcome 자체 없음, 또는 모든 텍스트 필드가 비어있음/whitespace
 *   "summary-only" — outcomeSummary 만 입력
 *   "filled"       — outcomeSummary + (outcomeDetail 또는 impact) 모두 입력
 */
export type OutcomeStatus = "filled" | "summary-only" | "empty";

export function getOutcomeStatus(outcome: TicketOutcome | undefined): OutcomeStatus {
  if (!outcome) return "empty";
  const hasSummary = !!outcome.outcomeSummary?.trim();
  const hasDetail = !!outcome.outcomeDetail?.trim();
  const hasImpact = !!outcome.impact?.trim();
  if (hasSummary && (hasDetail || hasImpact)) return "filled";
  if (hasSummary) return "summary-only";
  return "empty";
}

// ─── Weekly Link Suggestion ────────────────────────────────────────────────

/**
 * Weekly link 자동 매칭 — cc-weekly-notes[ticketKey] 의 가장 최신 sourceWeek 반환.
 *
 * 정렬 규칙:
 *  1. sourceWeek desc (lexicographic) — "22주차" > "21주차"
 *  2. 같은 sourceWeek 면 lastSeenAt desc — 가장 최근 sync 우선
 *
 * type ("progress" / "risk" / "next_action") 은 무시 — type-agnostic.
 */
export function getWeeklyLinkSuggestion(
  ticketKey: string,
  weeklyNotes: Record<string, Array<{ sourceWeek: string; lastSeenAt?: string }>>,
): string | undefined {
  const notes = weeklyNotes[ticketKey] ?? [];
  if (notes.length === 0) return undefined;
  const sorted = [...notes].sort((a, b) => {
    const w = b.sourceWeek.localeCompare(a.sourceWeek);
    if (w !== 0) return w;
    return (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "");
  });
  return sorted[0].sourceWeek;
}
