/**
 * Phase Order — overdue suppression invariants.
 *
 * Schedule Reconciliation Phase 1 contract:
 *   isTicketPastRolePhase(ticketStatus, rolePhase)
 *     → true:  role overdue UI 에서 suppress
 *     → false: 정상 표시
 *
 * 정책:
 *   - Done 상태 (배포완료 등) → 모든 role suppress
 *   - Pre-planning (HOLD / SUGGESTED 등) → suppress 안 함
 *   - 동일 phase → suppress 안 함 (아직 그 단계)
 *   - Unknown ticket status / 기타 phase → suppress 안 함
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  inferPhaseOrderFromStatus,
  getRolePhaseOrder,
  isTicketPastRolePhase,
} from "../lib/derived/phase-order";

describe("inferPhaseOrderFromStatus — Jira status → order", () => {
  test("Pre-planning statuses → -1", () => {
    assert.equal(inferPhaseOrderFromStatus("SUGGESTED"), -1);
    assert.equal(inferPhaseOrderFromStatus("Backlog"), -1);
    assert.equal(inferPhaseOrderFromStatus("HOLD"), -1);
    assert.equal(inferPhaseOrderFromStatus("Postponed"), -1);
    assert.equal(inferPhaseOrderFromStatus("검토대기"), -1);
  });
  test("기획중 → 1", () => assert.equal(inferPhaseOrderFromStatus("기획중"), 1));
  test("기획완료 / 디자인중 → 2", () => {
    assert.equal(inferPhaseOrderFromStatus("기획완료"), 2);
    assert.equal(inferPhaseOrderFromStatus("디자인중"), 2);
  });
  test("디자인완료 / 준비중 → 3", () => {
    assert.equal(inferPhaseOrderFromStatus("디자인완료"), 3);
    assert.equal(inferPhaseOrderFromStatus("준비중"), 3);
  });
  test("개발중 / In Progress → 4", () => {
    assert.equal(inferPhaseOrderFromStatus("개발중"), 4);
    assert.equal(inferPhaseOrderFromStatus("In Progress"), 4);
  });
  test("QA중 → 5", () => assert.equal(inferPhaseOrderFromStatus("QA중"), 5));
  test("Done statuses → 100", () => {
    assert.equal(inferPhaseOrderFromStatus("배포완료"), 100);
    assert.equal(inferPhaseOrderFromStatus("론치완료"), 100);
    assert.equal(inferPhaseOrderFromStatus("완료"), 100);
    assert.equal(inferPhaseOrderFromStatus("개발완료"), 100);
  });
  test("Unknown status → -100 (suppress 안 함 signal)", () => {
    assert.equal(inferPhaseOrderFromStatus("UNKNOWN_XYZ"), -100);
    assert.equal(inferPhaseOrderFromStatus(""), -100);
  });
});

describe("getRolePhaseOrder — role phase → order", () => {
  test("Kick-Off → 0", () => assert.equal(getRolePhaseOrder("Kick-Off"), 0));
  test("기획 → 1", () => assert.equal(getRolePhaseOrder("기획"), 1));
  test("디자인 → 2", () => assert.equal(getRolePhaseOrder("디자인"), 2));
  test("개발 → 4", () => assert.equal(getRolePhaseOrder("개발"), 4));
  test("QA → 5", () => assert.equal(getRolePhaseOrder("QA"), 5));
  test("Release / Launch → 6", () => {
    assert.equal(getRolePhaseOrder("Release"), 6);
    assert.equal(getRolePhaseOrder("Launch"), 6);
  });
  test("기타 → -100", () => assert.equal(getRolePhaseOrder("기타"), -100));
  test("Unknown phase → -100", () => {
    assert.equal(getRolePhaseOrder("UNKNOWN"), -100);
  });
});

describe("isTicketPastRolePhase — 사용자 요구 케이스", () => {
  // ── 후속 phase (suppress = true) ────────────────────────────────
  test("QA중 ticket + Dev role → true", () => {
    assert.equal(isTicketPastRolePhase("QA중", "개발"), true);
  });
  test("QA중 ticket + Design role → true", () => {
    assert.equal(isTicketPastRolePhase("QA중", "디자인"), true);
  });
  test("QA중 ticket + 기획 role → true", () => {
    assert.equal(isTicketPastRolePhase("QA중", "기획"), true);
  });
  test("준비중 ticket + Design role → true", () => {
    assert.equal(isTicketPastRolePhase("준비중", "디자인"), true);
  });
  test("개발중 ticket + Design role → true", () => {
    assert.equal(isTicketPastRolePhase("개발중", "디자인"), true);
  });

  // ── 이전 / 동일 phase (suppress = false) ────────────────────────
  test("개발중 ticket + QA role → false (QA 아직 안 옴)", () => {
    assert.equal(isTicketPastRolePhase("개발중", "QA"), false);
  });
  test("기획중 ticket + Dev role → false (한참 전)", () => {
    assert.equal(isTicketPastRolePhase("기획중", "개발"), false);
  });
  test("개발중 ticket + Dev role → false (동일 phase — 아직 그 단계 안)", () => {
    assert.equal(isTicketPastRolePhase("개발중", "개발"), false);
  });
  test("QA중 ticket + QA role → false (동일 phase)", () => {
    assert.equal(isTicketPastRolePhase("QA중", "QA"), false);
  });

  // ── Done → 모든 role suppress ───────────────────────────────────
  test("완료 ticket + 모든 role → true", () => {
    assert.equal(isTicketPastRolePhase("완료", "기획"), true);
    assert.equal(isTicketPastRolePhase("완료", "디자인"), true);
    assert.equal(isTicketPastRolePhase("완료", "개발"), true);
    assert.equal(isTicketPastRolePhase("완료", "QA"), true);
    assert.equal(isTicketPastRolePhase("완료", "Release"), true);
    assert.equal(isTicketPastRolePhase("완료", "Launch"), true);
  });
  test("배포완료 ticket + Launch role → true", () => {
    assert.equal(isTicketPastRolePhase("배포완료", "Launch"), true);
  });
  test("론치완료 ticket + Release role → true", () => {
    assert.equal(isTicketPastRolePhase("론치완료", "Release"), true);
  });
  test("개발완료 ticket + 모든 role → true (Done category)", () => {
    assert.equal(isTicketPastRolePhase("개발완료", "디자인"), true);
    assert.equal(isTicketPastRolePhase("개발완료", "QA"), true);
  });

  // ── Pre-planning / HOLD → suppress 안 함 ────────────────────────
  test("HOLD ticket + Dev role → false", () => {
    assert.equal(isTicketPastRolePhase("HOLD", "개발"), false);
  });
  test("SUGGESTED ticket + Design role → false", () => {
    assert.equal(isTicketPastRolePhase("SUGGESTED", "디자인"), false);
  });
  test("Backlog ticket + 기획 role → false", () => {
    assert.equal(isTicketPastRolePhase("Backlog", "기획"), false);
  });
  test("Postponed ticket + QA role → false", () => {
    assert.equal(isTicketPastRolePhase("Postponed", "QA"), false);
  });

  // ── Unknown / 기타 → suppress 안 함 (안전 default) ──────────────
  test("Unknown status + Dev role → false", () => {
    assert.equal(isTicketPastRolePhase("UNKNOWN_STATUS", "개발"), false);
  });
  test("QA중 ticket + 기타 phase → false", () => {
    assert.equal(isTicketPastRolePhase("QA중", "기타"), false);
  });
  test("QA중 ticket + UNKNOWN phase → false", () => {
    assert.equal(isTicketPastRolePhase("QA중", "UNKNOWN_PHASE"), false);
  });

  // ── 실제 시나리오 (3 ticket) ────────────────────────────────────
  test("TM-2746 scenario: status=QA중 + Design/Dev role overdue 의도 suppress", () => {
    assert.equal(isTicketPastRolePhase("QA중", "디자인"), true);
    assert.equal(isTicketPastRolePhase("QA중", "개발"), true);
    // 단 QA / Launch 는 아직 미래 → suppress 안 함
    assert.equal(isTicketPastRolePhase("QA중", "QA"), false);
    assert.equal(isTicketPastRolePhase("QA중", "Launch"), false);
  });
  test("배포완료 후 retrospective 시: 모든 role suppress (Done)", () => {
    const allRoles = ["Kick-Off", "기획", "디자인", "개발", "QA", "Release", "Launch"];
    for (const role of allRoles) {
      assert.equal(isTicketPastRolePhase("배포완료", role), true, `role=${role}`);
    }
  });
});
