import assert from "node:assert/strict";
import test from "node:test";
import type { JiraFilter } from "../lib/filter-types";
import {
  buildTicketParticipationMap,
  resolveTicketReviewMode,
} from "../lib/ticket-review";

function participantFilter(): JiraFilter {
  return {
    id: "team-source",
    jiraFilterId: "27769",
    name: "29CM Commerce Core_Assignee",
    jql: "assignee IN (account-a, account-b)",
    kind: "assignee",
    createdAt: "2026-08-01T00:00:00.000Z",
    lastSyncAt: null,
    lastSyncCount: null,
    lastSyncError: null,
  };
}

test("담당·보고·참조·직접 추가 관계를 함께 분류", () => {
  const map = buildTicketParticipationMap(
    [
      { key: "TM-1", assigneeAccountId: "account-a", reporterAccountId: "account-b" },
      { key: "TM-2", assigneeAccountId: "external", reporterAccountId: "external" },
      { key: "TM-3", isManual: true },
    ],
    { "team-source": ["TM-1", "TM-2"] },
    { "team-source": participantFilter() },
  );

  assert.deepEqual(map["TM-1"], ["assignee", "reporter"]);
  assert.deepEqual(map["TM-2"], ["watcher"]);
  assert.deepEqual(map["TM-3"], ["manual"]);
});

test("팀 accountId를 확인할 수 없으면 참조 관계를 임의 추정하지 않음", () => {
  const source = participantFilter();
  source.jql = "assignee = currentUser()";
  const map = buildTicketParticipationMap(
    [{ key: "TM-1", assigneeAccountId: "unknown" }],
    { "team-source": ["TM-1"] },
    { "team-source": source },
  );

  assert.equal(map["TM-1"], undefined);
});

test("확인 방식은 위클리 체크, 모니터링, 필요 시 확인 순으로 기본 분류", () => {
  assert.equal(resolveTicketReviewMode(["assignee"]), "weekly");
  assert.equal(resolveTicketReviewMode(["manual", "watcher"]), "weekly");
  assert.equal(resolveTicketReviewMode(["reporter"]), "monitor");
  assert.equal(resolveTicketReviewMode(["watcher"]), "reference");
  assert.equal(resolveTicketReviewMode(undefined), "monitor");
});

test("사용자가 저장한 확인 방식은 자동 기본값보다 우선", () => {
  assert.equal(resolveTicketReviewMode(["assignee"], "reference"), "reference");
  assert.equal(resolveTicketReviewMode(["watcher"], "weekly"), "weekly");
});
