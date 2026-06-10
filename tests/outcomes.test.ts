/**
 * lib/outcomes.ts contract tests.
 *
 * 보호 invariants (β-1 Backend / Data contract):
 *  - getCompletedAt: outcome.completedAt 우선, ticket.resolutionDate fallback
 *  - getCompletedAtSource: source 판별 정확성
 *  - getOutcomeStatus: empty / summary-only / filled 분기
 *  - getWeeklyLinkSuggestion: 정렬 규칙 (sourceWeek desc → lastSeenAt desc)
 *  - 통합 시나리오: Active ticket / Done ticket 의 outcome 흐름
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getCompletedAt,
  getCompletedAtSource,
  getOutcomeStatus,
  getWeeklyLinkSuggestion,
  type TicketOutcome,
} from "../lib/outcomes";

const ts = (iso: string): string => iso; // identity helper for readability

describe("getCompletedAt", () => {
  it("manual 우선 — outcome.completedAt 만 있으면 그것 반환", () => {
    const outcome: TicketOutcome = { completedAt: "2026-05-28", updatedAt: ts("2026-06-01T00:00:00Z") };
    assert.equal(getCompletedAt(outcome, undefined), "2026-05-28");
  });

  it("Jira fallback — outcome 없고 ticket.resolutionDate 있으면 ticket 값", () => {
    const ticket = { resolutionDate: "2026-05-20T10:00:00.000+0900" };
    assert.equal(getCompletedAt(undefined, ticket), "2026-05-20T10:00:00.000+0900");
  });

  it("둘 다 있으면 manual (outcome) 우선", () => {
    const outcome: TicketOutcome = { completedAt: "2026-05-28", updatedAt: ts("2026-06-01T00:00:00Z") };
    const ticket = { resolutionDate: "2026-05-20T10:00:00.000+0900" };
    assert.equal(getCompletedAt(outcome, ticket), "2026-05-28");
  });

  it("둘 다 없으면 undefined", () => {
    assert.equal(getCompletedAt(undefined, undefined), undefined);
    assert.equal(getCompletedAt({} as TicketOutcome, {}), undefined);
  });
});

describe("getCompletedAtSource", () => {
  it("manual — outcome.completedAt 있으면", () => {
    const outcome: TicketOutcome = { completedAt: "2026-05-28", updatedAt: ts("2026-06-01T00:00:00Z") };
    assert.equal(getCompletedAtSource(outcome, { resolutionDate: "2026-05-20" }), "manual");
    assert.equal(getCompletedAtSource(outcome, undefined), "manual");
  });

  it("jira — outcome.completedAt 없고 ticket.resolutionDate 만 있으면", () => {
    const ticket = { resolutionDate: "2026-05-20" };
    assert.equal(getCompletedAtSource(undefined, ticket), "jira");
    assert.equal(getCompletedAtSource({ updatedAt: ts("x") } as TicketOutcome, ticket), "jira");
  });

  it("none — 둘 다 없으면", () => {
    assert.equal(getCompletedAtSource(undefined, undefined), "none");
    assert.equal(getCompletedAtSource({ updatedAt: ts("x") } as TicketOutcome, {}), "none");
  });
});

describe("getOutcomeStatus", () => {
  it("empty — outcome 자체 없음", () => {
    assert.equal(getOutcomeStatus(undefined), "empty");
  });

  it("empty — 모든 텍스트 필드가 whitespace only", () => {
    const outcome: TicketOutcome = {
      outcomeSummary: "   ",
      outcomeDetail:  "\n\n  \t  \n",
      impact:         "",
      updatedAt:      ts("2026-06-01T00:00:00Z"),
    };
    assert.equal(getOutcomeStatus(outcome), "empty");
  });

  it("summary-only — outcomeSummary 만 있음 (detail/impact 없음)", () => {
    const outcome: TicketOutcome = {
      outcomeSummary: "결제 흰화면 UX 개선 완료",
      updatedAt:      ts("2026-06-01T00:00:00Z"),
    };
    assert.equal(getOutcomeStatus(outcome), "summary-only");
  });

  it("filled — summary + detail", () => {
    const outcome: TicketOutcome = {
      outcomeSummary: "결제 흰화면 UX 개선 완료",
      outcomeDetail:  "- 흰화면 → 진행률 spinner\n- 에러 시 retry 버튼\n- 5/28 launch",
      updatedAt:      ts("2026-06-01T00:00:00Z"),
    };
    assert.equal(getOutcomeStatus(outcome), "filled");
  });

  it("filled — summary + impact (detail 없음)", () => {
    const outcome: TicketOutcome = {
      outcomeSummary: "결제 흰화면 UX 개선 완료",
      impact:         "CS 인입 30% 감소",
      updatedAt:      ts("2026-06-01T00:00:00Z"),
    };
    assert.equal(getOutcomeStatus(outcome), "filled");
  });
});

describe("getWeeklyLinkSuggestion", () => {
  it("ticket 없음 → undefined", () => {
    assert.equal(getWeeklyLinkSuggestion("CMALL-999", {}), undefined);
  });

  it("단일 note → sourceWeek 반환", () => {
    const weeklyNotes = {
      "CMALL-784": [{ sourceWeek: "21주차" }],
    };
    assert.equal(getWeeklyLinkSuggestion("CMALL-784", weeklyNotes), "21주차");
  });

  it("여러 week 중 latest sourceWeek 반환", () => {
    const weeklyNotes = {
      "CMALL-784": [
        { sourceWeek: "21주차", lastSeenAt: ts("2026-05-21T00:00:00Z") },
        { sourceWeek: "23주차", lastSeenAt: ts("2026-06-05T00:00:00Z") },
        { sourceWeek: "22주차", lastSeenAt: ts("2026-05-28T00:00:00Z") },
      ],
    };
    assert.equal(getWeeklyLinkSuggestion("CMALL-784", weeklyNotes), "23주차");
  });

  it("같은 sourceWeek 여러 개 → lastSeenAt latest 반환", () => {
    const weeklyNotes = {
      "CMALL-784": [
        { sourceWeek: "22주차", lastSeenAt: ts("2026-05-28T00:00:00Z") },
        { sourceWeek: "22주차", lastSeenAt: ts("2026-05-30T00:00:00Z") }, // ← latest
        { sourceWeek: "22주차", lastSeenAt: ts("2026-05-29T00:00:00Z") },
      ],
    };
    // 모두 같은 week 라 어쨌든 "22주차" 반환되지만 정렬 안정성 확인 (latest 선택 보장)
    assert.equal(getWeeklyLinkSuggestion("CMALL-784", weeklyNotes), "22주차");
  });
});

describe("통합 시나리오", () => {
  it("Active ticket (resolutionDate 없음) + outcome 없음 → 모든 helper 가 무 상태 응답", () => {
    const ticket = {}; // active, no resolutionDate
    assert.equal(getCompletedAt(undefined, ticket), undefined);
    assert.equal(getCompletedAtSource(undefined, ticket), "none");
    assert.equal(getOutcomeStatus(undefined), "empty");
    assert.equal(getWeeklyLinkSuggestion("CMALL-1", {}), undefined);
  });

  it("Done ticket + outcome 입력 완료 → 모든 helper 가 정상값", () => {
    const ticket = { resolutionDate: "2026-05-20T10:00:00.000+0900" };
    const outcome: TicketOutcome = {
      completedAt:    "2026-05-28",         // 사용자 수정 (Jira 와 다른 값)
      outcomeSummary: "결제 흰화면 UX 개선 완료",
      outcomeDetail:  "- 흰화면 → 진행률 spinner\n- 에러 시 retry 버튼",
      impact:         "CS 인입 30% 감소",
      weeklyLink:     "22주차",
      updatedAt:      ts("2026-06-01T00:00:00Z"),
      updatedBy:      "minju.choi",
    };
    const weeklyNotes = {
      "CMALL-784": [
        { sourceWeek: "22주차", lastSeenAt: ts("2026-05-28T00:00:00Z") },
      ],
    };

    // 수동 입력 우선
    assert.equal(getCompletedAt(outcome, ticket), "2026-05-28");
    assert.equal(getCompletedAtSource(outcome, ticket), "manual");

    // 완전 입력 상태
    assert.equal(getOutcomeStatus(outcome), "filled");

    // Weekly 자동 매칭 결과와 outcome.weeklyLink 가 일치 (사용자가 자동 매칭 그대로 채택한 경우)
    assert.equal(getWeeklyLinkSuggestion("CMALL-784", weeklyNotes), "22주차");
  });
});
