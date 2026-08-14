import assert from "node:assert/strict";
import test from "node:test";
import type { JiraFilter } from "../lib/filter-types";
import {
  buildEffectiveFilterJql,
  extractTeamParticipantAccountIds,
  inferJiraFilterKind,
  inferJiraFilterTargetArea,
} from "../lib/filter-policy";

function filter(overrides: Partial<JiraFilter> = {}): JiraFilter {
  return {
    id: "source-1",
    jiraFilterId: "27769",
    name: "29CM Commerce Core_Assignee",
    jql: "created >= -30d AND assignee IN (currentUser(), account-1) AND project NOT IN (DAC) ORDER BY created DESC",
    createdAt: "2026-05-29T00:00:00.000Z",
    lastSyncAt: null,
    lastSyncCount: null,
    lastSyncError: null,
    ...overrides,
  };
}

test("기존 데이터 소스 목적을 이름과 JQL에서 추론", () => {
  assert.equal(inferJiraFilterKind(filter()), "assignee");
  assert.equal(inferJiraFilterKind(filter({ name: "29CM_ETR", jql: "project = ETR" })), "etr");
  assert.equal(inferJiraFilterKind(filter({ name: "29CM_OKR", jql: "issuetype = Initiative" })), "initiative");
});

test("OKR 소스에 담당자 조건이 있어도 initiative 목적을 우선한다", () => {
  const okrFilter = filter({
    id: "okr-with-assignee",
    jiraFilterId: "28385",
    name: "29CM 커머스코어 OKR_Q3",
    jql: "issuetype = Initiative AND assignee = currentUser() ORDER BY updated DESC",
  });

  assert.equal(inferJiraFilterKind(okrFilter), "initiative");
  assert.equal(buildEffectiveFilterJql(okrFilter), "filter = 28385");
});

test("ETR은 ETR 검토, 나머지는 전체 과제 영역으로 기본 분류", () => {
  assert.equal(inferJiraFilterTargetArea(filter({ name: "29CM_ETR", jql: "project = ETR" })), "etr");
  assert.equal(inferJiraFilterTargetArea(filter()), "tickets");
});

test("팀 참여 소스는 담당·보고·참조 관계와 최근 완료를 수집", () => {
  const jql = buildEffectiveFilterJql(filter());
  assert.equal(jql.includes("created >= -30d"), false);
  assert.match(jql, /assignee IN \(currentUser\(\), account-1\)/);
  assert.match(jql, /reporter IN \(currentUser\(\), account-1\)/);
  assert.match(jql, /watcher IN \(currentUser\(\), account-1\)/);
  assert.match(jql, /statusCategory != Done OR resolved >= -14d/);
  assert.match(jql, /ORDER BY updated DESC$/);
});

test("팀 참여자 accountId는 currentUser 함수를 제외하고 추출", () => {
  assert.deepEqual(extractTeamParticipantAccountIds(filter()), ["account-1"]);
  assert.deepEqual(
    extractTeamParticipantAccountIds(filter({ jql: 'assignee IN ("account-a", \'account-b\')' })),
    ["account-a", "account-b"],
  );
});

test("단일 담당자 조건도 보고자와 참조자로 확장", () => {
  const jql = buildEffectiveFilterJql(filter({
    jql: "assignee = account-1 ORDER BY updated DESC",
  }));
  assert.match(jql, /assignee = account-1 OR reporter = account-1 OR watcher = account-1/);
});

test("일반 소스와 명시한 syncJql은 임의 변경하지 않음", () => {
  assert.equal(
    buildEffectiveFilterJql(filter({ kind: "general" })),
    "filter = 27769",
  );
  assert.equal(
    buildEffectiveFilterJql(filter({ syncJql: "project = TM ORDER BY updated DESC" })),
    "project = TM ORDER BY updated DESC",
  );
});
