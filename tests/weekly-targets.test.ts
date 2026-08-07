import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectWeeklySyncTargets } from "../lib/weekly-targets";

const NOW = new Date("2026-08-07T00:00:00.000Z");

describe("Weekly Sync 대상 — 완료 후 보고 유예기간", () => {
  const tickets = [
    { key: "TM-ACTIVE", status: "개발중" },
    { key: "TM-DONE-NEW", status: "완료", resolutionDate: "2026-08-01T09:00:00.000+09:00" },
    { key: "TM-DONE-BOUNDARY", status: "론치완료", resolutionDate: "2026-07-24T00:00:00.000Z" },
    { key: "TM-DONE-OLD", status: "배포완료", resolutionDate: "2026-07-23T23:59:59.000Z" },
    { key: "TM-DONE-FALLBACK", status: "개발완료", updatedAt: "2026-08-06T00:00:00.000Z" },
    { key: "TM-DONE-UNKNOWN", status: "완료" },
  ];

  it("활성 과제와 완료 후 14일 이내 과제를 포함", () => {
    const result = selectWeeklySyncTargets(tickets, new Set(), NOW);
    assert.deepEqual(result.targets.map(t => t.key), [
      "TM-ACTIVE",
      "TM-DONE-NEW",
      "TM-DONE-BOUNDARY",
      "TM-DONE-FALLBACK",
    ]);
    assert.equal(result.recentlyCompletedCount, 3);
  });

  it("완료일이 없거나 14일을 지난 완료 과제는 제외", () => {
    const result = selectWeeklySyncTargets(tickets, new Set(), NOW);
    assert.deepEqual(result.excludedCompletedKeys, ["TM-DONE-OLD", "TM-DONE-UNKNOWN"]);
  });

  it("숨김 과제는 상태와 무관하게 제외", () => {
    const result = selectWeeklySyncTargets(
      tickets,
      new Set(["TM-ACTIVE", "TM-DONE-NEW"]),
      NOW,
    );
    assert.deepEqual(result.targets.map(t => t.key), ["TM-DONE-BOUNDARY", "TM-DONE-FALLBACK"]);
    assert.equal(result.skippedHidden, 2);
  });
});
