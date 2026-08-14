import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  emptyJiraTicketCache,
  isCachedTicketNewer,
  mergeJiraTicketCache,
  selectChangedJiraTicketKeys,
} from "../lib/jira-ticket-cache";

describe("selectChangedJiraTicketKeys", () => {
  it("Jira updated 값이 달라진 티켓과 캐시에 없는 티켓만 상세 조회 대상으로 고른다", () => {
    const result = selectChangedJiraTicketKeys(
      ["TM-1", "TM-2", "TM-3"],
      {
        "TM-1": { key: "TM-1", updatedAt: "2026-08-14T01:00:00.000Z" },
        "TM-2": { key: "TM-2", updatedAt: "2026-08-14T01:00:00.000Z" },
      },
      [
        { key: "TM-1", updatedAt: "2026-08-14T01:00:00.000Z" },
        { key: "TM-2", updatedAt: "2026-08-14T02:00:00.000Z" },
        { key: "TM-3", updatedAt: "2026-08-14T03:00:00.000Z" },
      ],
    );

    assert.deepEqual(result.changedKeys, ["TM-2", "TM-3"]);
    assert.deepEqual(result.unavailableKeys, []);
  });

  it("Jira에서 확인되지 않은 키는 상세 재조회 반복 대신 unavailable로 분리한다", () => {
    const result = selectChangedJiraTicketKeys(
      ["TM-1", "TM-404"],
      { "TM-1": { key: "TM-1", updatedAt: "2026-08-14T01:00:00.000Z" } },
      [{ key: "TM-1", updatedAt: "2026-08-14T01:00:00.000Z" }],
    );

    assert.deepEqual(result.changedKeys, []);
    assert.deepEqual(result.unavailableKeys, ["TM-404"]);
  });
});

describe("isCachedTicketNewer", () => {
  it("공용 캐시가 브라우저보다 실제로 최신일 때만 교체한다", () => {
    assert.equal(isCachedTicketNewer("2026-08-14T02:00:00.000Z", "2026-08-14T01:00:00.000Z"), true);
    assert.equal(isCachedTicketNewer("2026-08-14T01:00:00.000Z", "2026-08-14T02:00:00.000Z"), false);
    assert.equal(isCachedTicketNewer("2026-08-14T01:00:00.000Z", "2026-08-14T01:00:00.000Z"), false);
  });

  it("브라우저 수정시각이 없을 때만 유효한 공용 값을 보완한다", () => {
    assert.equal(isCachedTicketNewer("2026-08-14T02:00:00.000Z", undefined), true);
    assert.equal(isCachedTicketNewer(undefined, "2026-08-14T01:00:00.000Z"), false);
    assert.equal(isCachedTicketNewer("잘못된 날짜", "2026-08-14T01:00:00.000Z"), false);
  });
});

describe("mergeJiraTicketCache", () => {
  it("변경 티켓만 교체하고 관리 대상에서 빠진 캐시 데이터는 제외한다", () => {
    const current = {
      ...emptyJiraTicketCache(),
      updatedAt: "2026-08-14T00:00:00.000Z",
      tickets: {
        "TM-1": { key: "TM-1", summary: "기존", status: "기획중", assignee: "-", eta: "-", type: "Task", project: "TM" },
        "TM-OLD": { key: "TM-OLD", summary: "제외", status: "완료", assignee: "-", eta: "-", type: "Task", project: "TM" },
      },
    };

    const merged = mergeJiraTicketCache(
      current,
      [{ key: "TM-1", summary: "변경", status: "개발중", assignee: "담당자", eta: "-", type: "Task", project: "TM" }],
      ["TM-1", "TM-2"],
      "2026-08-14T04:00:00.000Z",
    );

    assert.equal(merged.tickets["TM-1"].summary, "변경");
    assert.equal(merged.tickets["TM-OLD"], undefined);
    assert.equal(merged.updatedAt, "2026-08-14T04:00:00.000Z");
  });
});
