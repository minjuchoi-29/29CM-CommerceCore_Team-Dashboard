import assert from "node:assert/strict";
import test from "node:test";
import {
  countTicketsByJiraStage,
  getTicketJiraStage,
} from "../lib/ticket-stages";

const NOW = new Date("2026-08-14T00:00:00.000Z");

test("프로젝트별 Jira 실행 상태를 공통 단계로 정규화", () => {
  assert.equal(getTicketJiraStage({ key: "TM-1", status: "개발 진행중" }, NOW), "개발");
  assert.equal(getTicketJiraStage({ key: "TM-2", status: "In Review", statusCategory: "indeterminate" }, NOW), "개발");
  assert.equal(getTicketJiraStage({ key: "TM-3", status: "QA", statusCategory: "indeterminate" }, NOW), "QA");
  assert.equal(getTicketJiraStage({ key: "TM-4", status: "별도 실행 상태", statusCategory: "indeterminate" }, NOW), "기타");
});

test("완료 category는 상태명보다 우선해 완료 단계로 분류", () => {
  assert.equal(
    getTicketJiraStage({ key: "TM-1", status: "배포완료", statusCategory: "done" }, NOW),
    "완료",
  );
});

test("단계별 합계는 상위 필터로 좁힌 전체 티켓 수와 일치", () => {
  const tickets = [
    { key: "TM-1", status: "기획중", statusCategory: "indeterminate" },
    { key: "TM-2", status: "개발중", statusCategory: "indeterminate" },
    { key: "TM-3", status: "QA중", statusCategory: "indeterminate" },
    { key: "TM-4", status: "커스텀 진행", statusCategory: "indeterminate" },
  ];
  const counts = countTicketsByJiraStage(tickets, NOW);

  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), tickets.length);
  assert.deepEqual(counts, {
    준비중: 0,
    기획: 1,
    디자인: 0,
    개발: 1,
    QA: 1,
    완료: 0,
    기타: 1,
  });
});
