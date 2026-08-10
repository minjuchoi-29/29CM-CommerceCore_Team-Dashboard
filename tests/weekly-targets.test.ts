import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyTicketLifecycle, getTicketViewLifecycle, selectWeeklySyncTargets } from "../lib/weekly-targets";

const NOW = new Date("2026-08-07T00:00:00.000Z");

describe("Weekly Sync 대상 — 완료 후 보고 유예기간", () => {
  const tickets = [
    { key: "TM-ACTIVE", status: "개발중", statusCategory: "indeterminate" },
    { key: "TM-DEPLOYING", status: "배포완료", statusCategory: "indeterminate" },
    { key: "TM-DEV-DONE", status: "개발완료", statusCategory: "indeterminate" },
    { key: "TM-PLANNING", status: "SUGGESTED", statusCategory: "new" },
    { key: "TM-HOLD", status: "HOLD", statusCategory: "indeterminate" },
    { key: "TM-CANCELLED", status: "철회/반려/취소", statusCategory: "done" },
    { key: "TM-DONE-NEW", status: "완료", statusCategory: "done", resolutionDate: "2026-08-01T09:00:00.000+09:00" },
    { key: "TM-DONE-BOUNDARY", status: "론치완료", statusCategory: "done", resolutionDate: "2026-07-24T00:00:00.000Z" },
    { key: "TM-DONE-OLD", status: "론치완료", statusCategory: "done", resolutionDate: "2026-07-23T23:59:59.000Z" },
    { key: "TM-DONE-UPDATED", status: "완료", statusCategory: "done", updatedAt: "2026-08-06T00:00:00.000Z" },
    { key: "TM-DONE-UNKNOWN", status: "완료", statusCategory: "done" },
  ];

  it("활성 과제와 완료 후 14일 이내 과제를 포함", () => {
    const result = selectWeeklySyncTargets(tickets, new Set(), NOW);
    assert.deepEqual(result.targets.map(t => t.key), [
      "TM-ACTIVE",
      "TM-DEPLOYING",
      "TM-DEV-DONE",
      "TM-DONE-NEW",
      "TM-DONE-BOUNDARY",
    ]);
    assert.equal(result.recentlyCompletedCount, 2);
  });

  it("플래닝·종료 상태와 완료일이 없거나 14일을 지난 완료 과제는 제외", () => {
    const result = selectWeeklySyncTargets(tickets, new Set(), NOW);
    assert.deepEqual(result.excludedCompletedKeys, ["TM-DONE-OLD", "TM-DONE-UPDATED", "TM-DONE-UNKNOWN"]);
    assert.equal(result.targets.some(ticket => ticket.key === "TM-PLANNING"), false);
    assert.equal(result.targets.some(ticket => ticket.key === "TM-CANCELLED"), false);
  });

  it("숨김 과제는 상태와 무관하게 제외", () => {
    const result = selectWeeklySyncTargets(
      tickets,
      new Set(["TM-ACTIVE", "TM-DONE-NEW"]),
      NOW,
    );
    assert.deepEqual(result.targets.map(t => t.key), ["TM-DEPLOYING", "TM-DEV-DONE", "TM-DONE-BOUNDARY"]);
    assert.equal(result.skippedHidden, 2);
  });

  it("statusCategory와 제품 정책 예외를 함께 적용", () => {
    assert.equal(classifyTicketLifecycle({ status: "배포완료", statusCategory: "indeterminate" }), "active");
    assert.equal(classifyTicketLifecycle({ status: "개발완료", statusCategory: "indeterminate" }), "active");
    assert.equal(classifyTicketLifecycle({ status: "론치완료", statusCategory: "done" }), "done");
    assert.equal(classifyTicketLifecycle({ status: "HOLD", statusCategory: "indeterminate" }), "planning");
    assert.equal(classifyTicketLifecycle({ status: "Dropped", statusCategory: "done" }), "terminal");
  });

  it("기존 KV에 statusCategory가 없어도 배포완료·개발완료를 실행 중으로 본다", () => {
    assert.equal(classifyTicketLifecycle({ status: "배포완료" }), "active");
    assert.equal(classifyTicketLifecycle({ status: "개발완료" }), "active");
  });

  it("화면 생명주기는 완료일이 있는 14일 이내 과제만 최근 완료로 분리한다", () => {
    assert.equal(getTicketViewLifecycle(tickets[0], NOW), "active");
    assert.equal(getTicketViewLifecycle(tickets[3], NOW), "planning");
    assert.equal(getTicketViewLifecycle(tickets[5], NOW), "terminal");
    assert.equal(getTicketViewLifecycle(tickets[6], NOW), "recently_completed");
    assert.equal(getTicketViewLifecycle(tickets[8], NOW), "completed");
    assert.equal(getTicketViewLifecycle(tickets[9], NOW), "completed");
  });
});
