import assert from "node:assert/strict";
import test from "node:test";

import { compactSchedulesForDisplay, type ScheduleDisplayRow } from "../lib/schedule-display";

const futureNow = new Date("2026-07-27T12:00:00+09:00").getTime();

test("Weekly 배포 마일스톤은 최신 주차만 현재 일정에 남긴다", () => {
  const rows: ScheduleDisplayRow[] = [
    { role: "배포일", phase: "Release", start: "2026-07-20", end: "2026-07-20", status: "예정", source: "jira_weekly", sourceWeek: "29주차" },
    { role: "배포일", phase: "Release", start: "2026-07-21", end: "2026-07-21", status: "예정", source: "jira_weekly", sourceWeek: "30주차" },
  ];

  const result = compactSchedulesForDisplay(rows, futureNow);

  assert.deepEqual(result.current.map(row => row.sourceWeek), ["30주차"]);
  assert.deepEqual(result.history.map(row => row.sourceWeek), ["29주차"]);
  assert.equal(result.supersededCount, 1);
});

test("연도가 바뀌면 주차 숫자보다 lastSeenAt을 우선한다", () => {
  const rows: ScheduleDisplayRow[] = [
    { role: "오픈일", phase: "Launch", start: "2026-12-30", end: "2026-12-30", status: "예정", source: "jira_weekly", sourceWeek: "52주차", lastSeenAt: "2026-12-24T06:00:00+09:00" },
    { role: "오픈일", phase: "Launch", start: "2027-01-06", end: "2027-01-06", status: "예정", source: "jira_weekly", sourceWeek: "1주차", lastSeenAt: "2027-01-02T06:00:00+09:00" },
  ];

  const result = compactSchedulesForDisplay(rows, futureNow);

  assert.deepEqual(result.current.map(row => row.sourceWeek), ["1주차"]);
});

test("서로 다른 Weekly 작업은 같은 phase여도 합치지 않는다", () => {
  const rows: ScheduleDisplayRow[] = [
    { role: "QA", phase: "QA", detail: "CSE 자체", start: "2026-07-28", end: "2026-07-28", status: "예정", source: "jira_weekly", sourceWeek: "30주차" },
    { role: "QA", phase: "QA", detail: "29CM 투입", start: "2026-07-29", end: "2026-07-29", status: "예정", source: "jira_weekly", sourceWeek: "30주차" },
  ];

  const result = compactSchedulesForDisplay(rows, futureNow);

  assert.equal(result.current.length, 2);
  assert.equal(result.history.length, 0);
});

test("수동 일정은 Weekly 일정과 관계없이 보호되어 현재 일정에 남는다", () => {
  const rows: ScheduleDisplayRow[] = [
    { role: "배포일", phase: "Release", start: "2026-07-30", end: "2026-07-30", status: "예정", source: "manual" },
    { role: "배포일", phase: "Release", start: "2026-07-21", end: "2026-07-21", status: "예정", source: "jira_weekly", sourceWeek: "30주차" },
  ];

  const result = compactSchedulesForDisplay(rows, futureNow);

  assert.equal(result.current.length, 2);
  assert.equal(result.history.length, 0);
});

test("완료된 과거 일정은 이력으로 이동한다", () => {
  const rows: ScheduleDisplayRow[] = [
    { role: "디자인", phase: "디자인", start: "2026-05-08", end: "2026-05-08", status: "완료", source: "manual" },
    { role: "QA", phase: "QA", start: "2026-07-28", end: "2026-07-29", status: "진행중", source: "manual" },
  ];

  const result = compactSchedulesForDisplay(rows, futureNow);

  assert.deepEqual(result.current.map(row => row.role), ["QA"]);
  assert.deepEqual(result.history.map(row => row.role), ["디자인"]);
  assert.equal(result.completedCount, 1);
});
