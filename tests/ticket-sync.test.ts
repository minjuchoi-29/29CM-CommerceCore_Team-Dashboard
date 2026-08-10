import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlanningRefreshKeys,
  buildTicketRefreshPlan,
  findMissingSharedTicketKeys,
  mergeRefreshedTickets,
} from "../lib/ticket-sync";

const NOW = new Date("2026-08-10T00:00:00.000Z");

describe("buildTicketRefreshPlan", () => {
  it("미완료·최근 완료·다른 브라우저 신규 티켓만 선택", () => {
    const tickets = [
      { key: "TM-ACTIVE", status: "개발중" },
      { key: "TM-PLANNING", status: "SUGGESTED" },
      { key: "TM-RECENT", status: "완료", resolutionDate: "2026-08-03T00:00:00.000Z" },
      { key: "TM-OLD", status: "론치완료", resolutionDate: "2026-07-01T00:00:00.000Z" },
    ];

    const result = buildTicketRefreshPlan(
      tickets,
      ["TM-ACTIVE", "M29CMOD-7120"],
      new Set(),
      NOW,
    );

    assert.deepEqual(result.keys, ["TM-ACTIVE", "TM-RECENT", "M29CMOD-7120"]);
    assert.equal(result.activeOrRecentCount, 2);
    assert.equal(result.missingCustomCount, 1);
  });

  it("숨긴 티켓은 공용 신규 키여도 제외", () => {
    const result = buildTicketRefreshPlan(
      [{ key: "TM-ACTIVE", status: "개발중" }],
      ["TM-HIDDEN"],
      new Set(["TM-ACTIVE", "TM-HIDDEN"]),
      NOW,
    );
    assert.deepEqual(result.keys, []);
  });
});

describe("buildPlanningRefreshKeys", () => {
  it("실행·완료·종료 상태를 제외하고 플래닝 상태만 선택", () => {
    assert.deepEqual(
      buildPlanningRefreshKeys(
        [
          { key: "TM-READY", status: "SUGGESTED", statusCategory: "new" },
          { key: "TM-HOLD", status: "HOLD", statusCategory: "indeterminate" },
          { key: "TM-ACTIVE", status: "개발중", statusCategory: "indeterminate" },
          { key: "TM-DEPLOYING", status: "배포완료", statusCategory: "indeterminate" },
          { key: "TM-DONE", status: "완료", statusCategory: "done" },
          { key: "TM-DROPPED", status: "Dropped", statusCategory: "done" },
          { key: "TM-HIDDEN", status: "Backlog", statusCategory: "new" },
        ],
        new Set(["TM-HIDDEN"]),
      ),
      ["TM-READY", "TM-HOLD"],
    );
  });
});

describe("mergeRefreshedTickets", () => {
  it("기존 순서를 유지하고 갱신 및 신규 추가", () => {
    const merged = mergeRefreshedTickets(
      [
        { key: "TM-1", status: "기획중" },
        { key: "TM-2", status: "완료" },
      ],
      [
        { key: "TM-1", status: "개발중" },
        { key: "TM-3", status: "SUGGESTED" },
      ],
    );

    assert.deepEqual(merged, [
      { key: "TM-1", status: "개발중" },
      { key: "TM-2", status: "완료" },
      { key: "TM-3", status: "SUGGESTED" },
    ]);
  });

  it("같은 신규 키가 중복 조회되어도 한 번만 추가", () => {
    assert.deepEqual(
      mergeRefreshedTickets(
        [{ key: "TM-1", status: "기획중" }],
        [
          { key: "TM-2", status: "개발중" },
          { key: "TM-2", status: "개발중" },
        ],
      ),
      [
        { key: "TM-1", status: "기획중" },
        { key: "TM-2", status: "개발중" },
      ],
    );
  });
});

describe("findMissingSharedTicketKeys", () => {
  it("현재 브라우저에 없고 숨김도 아닌 공용 티켓만 반환", () => {
    assert.deepEqual(
      findMissingSharedTicketKeys(
        [{ key: "TM-1" }],
        ["TM-1", "TM-2", "TM-3"],
        new Set(["TM-3"]),
      ),
      ["TM-2"],
    );
  });
});
