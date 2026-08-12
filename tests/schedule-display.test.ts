import assert from "node:assert/strict";
import test from "node:test";

import {
  compactSchedulesForDisplay,
  isActionableScheduleConfirmation,
  isPrimaryScheduleRange,
  isMeaningfulScheduleHistoryRow,
  isStaleAutomaticSchedule,
  partitionRedundantLegacyMilestones,
  type ScheduleDisplayRow,
} from "../lib/schedule-display";

const futureNow = new Date("2026-07-27T12:00:00+09:00").getTime();
const beforeReleaseNow = new Date("2026-07-19T12:00:00+09:00").getTime();

test("Weekly 배포 마일스톤은 최신 주차만 현재 일정에 남긴다", () => {
  const rows: ScheduleDisplayRow[] = [
    { role: "배포일", phase: "Release", start: "2026-07-20", end: "2026-07-20", status: "예정", source: "jira_weekly", sourceWeek: "29주차" },
    { role: "배포일", phase: "Release", start: "2026-07-21", end: "2026-07-21", status: "예정", source: "jira_weekly", sourceWeek: "30주차" },
  ];

  const result = compactSchedulesForDisplay(rows, beforeReleaseNow);

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

  assert.deepEqual(result.current.map(row => row.source), ["manual"]);
  assert.deepEqual(result.history.map(row => row.source), ["jira_weekly"]);
  assert.equal(result.staleCount, 1);
});

test("TM-2771 날짜가 확정된 Release가 있으면 정보 없는 수동 미정 틀은 중복 노출하지 않는다", () => {
  const rows: ScheduleDisplayRow[] = [
    {
      role: "배포일", phase: "Release", detail: "Release",
      start: "2026-08-25", end: "2026-08-26", status: "예정",
      source: "jira_weekly", sourceWeek: "33주차",
    },
    {
      role: "Release", phase: "Release", status: "미정", source: "manual",
    },
  ];

  const result = compactSchedulesForDisplay(
    rows,
    new Date("2026-08-11T12:00:00+09:00").getTime(),
  );

  assert.deepEqual(result.current.map(row => row.source), ["jira_weekly"]);
  assert.equal(result.history.length, 0);
  assert.equal(result.redundantPlaceholderCount, 1);
  assert.equal(rows.length, 2, "저장 원본은 삭제하거나 변경하지 않는다");
});

test("날짜가 없더라도 담당자·설명이 있는 수동 마일스톤과 단독 미정 틀은 보호한다", () => {
  const datedWeekly: ScheduleDisplayRow = {
    role: "배포일", phase: "Release", detail: "Release",
    start: "2026-08-25", end: "2026-08-26", status: "예정",
    source: "jira_weekly", sourceWeek: "33주차",
  };
  const manualWithContext: ScheduleDisplayRow = {
    role: "Release", phase: "Release", detail: "운영 승인 후 점진 배포",
    person: "담당 PM", status: "미정", source: "manual",
  };
  const standalonePlaceholder: ScheduleDisplayRow = {
    role: "Launch", phase: "Launch", status: "미정", source: "manual",
  };

  const result = compactSchedulesForDisplay(
    [datedWeekly, manualWithContext, standalonePlaceholder],
    new Date("2026-08-11T12:00:00+09:00").getTime(),
  );

  assert.deepEqual(result.current, [datedWeekly, manualWithContext, standalonePlaceholder]);
  assert.equal(result.redundantPlaceholderCount, 0);
});

test("TM-2215 같은 날짜의 기본 수동 Release보다 Weekly Launch를 우선 표시한다", () => {
  const manualRelease: ScheduleDisplayRow = {
    role: "Release", phase: "Release", detail: "Release", person: "-",
    start: "2026-08-27", end: "2026-08-27", status: "예정", source: "manual",
  };
  const weeklyLaunch: ScheduleDisplayRow = {
    role: "Launch", phase: "Launch", detail: "Launch", person: "-",
    start: "2026-08-27", end: "2026-08-27", status: "예정",
    source: "jira_weekly", sourceWeek: "33주차",
  };

  const rows = [manualRelease, weeklyLaunch];
  const result = compactSchedulesForDisplay(
    rows,
    new Date("2026-08-11T12:00:00+09:00").getTime(),
  );

  assert.deepEqual(result.current, [weeklyLaunch]);
  assert.equal(result.redundantMilestoneCount, 1);
  assert.equal(rows.length, 2, "수동 저장 원본은 삭제하지 않는다");

  const afterLaunch = compactSchedulesForDisplay(
    rows,
    new Date("2026-09-01T12:00:00+09:00").getTime(),
  );
  assert.deepEqual(afterLaunch.current, [], "Weekly Launch가 이력화된 뒤에도 기본 Release가 다시 나타나지 않는다");
  assert.deepEqual(afterLaunch.history, [weeklyLaunch]);
});

test("편집용 분리는 중복 수동 Release를 숨기되 원본 행을 별도로 보존한다", () => {
  const manualRelease: ScheduleDisplayRow = {
    role: "Release", phase: "Release", detail: "Release", person: "-",
    start: "2026-08-27", end: "2026-08-27", status: "예정", source: "manual",
  };
  const weeklyLaunch: ScheduleDisplayRow = {
    role: "Launch", phase: "Launch", detail: "Launch", person: "-",
    start: "2026-08-27", end: "2026-08-27", status: "예정", source: "jira_weekly", sourceWeek: "33주차",
  };

  const result = partitionRedundantLegacyMilestones([manualRelease, weeklyLaunch]);

  assert.deepEqual(result.visible, [weeklyLaunch]);
  assert.deepEqual(result.preserved, [manualRelease]);
});

test("같은 날짜라도 설명이 있는 수동 Release는 Weekly Launch와 함께 보호한다", () => {
  const manualRelease: ScheduleDisplayRow = {
    role: "Release", phase: "Release", detail: "운영 승인 후 점진 배포", person: "담당 PM",
    start: "2026-08-27", end: "2026-08-27", status: "예정", source: "manual",
  };
  const weeklyLaunch: ScheduleDisplayRow = {
    role: "Launch", phase: "Launch", detail: "대고객 런칭",
    start: "2026-08-27", end: "2026-08-27", status: "예정",
    source: "jira_weekly", sourceWeek: "33주차",
  };

  const result = compactSchedulesForDisplay(
    [manualRelease, weeklyLaunch],
    new Date("2026-08-11T12:00:00+09:00").getTime(),
  );

  assert.deepEqual(result.current, [manualRelease, weeklyLaunch]);
  assert.equal(result.redundantMilestoneCount, 0);
});

test("확인 필요 집계는 일반 실행 일정만 포함하고 미정·Release·Launch는 제외한다", () => {
  assert.equal(isActionableScheduleConfirmation({
    role: "QA", phase: "QA", status: "확인필요",
  }), true);
  assert.equal(isActionableScheduleConfirmation({
    role: "개발", phase: "개발", status: "진행중",
  }), true);
  assert.equal(isActionableScheduleConfirmation({
    role: "개발", phase: "개발", status: "미정",
  }), false);
  assert.equal(isActionableScheduleConfirmation({
    role: "Release", phase: "Release", status: "확인필요",
  }), false);
  assert.equal(isActionableScheduleConfirmation({
    role: "Launch", phase: "Launch", status: "예정",
  }), false);
});

test("TM-2771 과거 자동 예정·오래된 진행 일정은 현재가 아니라 이력으로 분리한다", () => {
  const now = new Date("2026-08-11T12:00:00+09:00").getTime();
  const rows: ScheduleDisplayRow[] = [
    {
      role: "QA", phase: "QA", detail: "29CM 투입",
      start: "2026-05-26", end: "2026-05-26", status: "예정",
      source: "jira_weekly", sourceWeek: "21주차", lastSeenAt: "2026-05-22T06:00:00+09:00",
    },
    {
      role: "QA", phase: "QA", detail: "운영 자체 진행",
      start: "2026-05-26", end: "2026-06-02", status: "진행중",
      source: "jira_weekly", sourceWeek: "22주차", lastSeenAt: "2026-05-29T06:00:00+09:00",
    },
    {
      role: "QA", phase: "QA", detail: "통합 QA/UAT",
      start: "2026-08-18", end: "2026-08-21", status: "예정",
      source: "jira_weekly", sourceWeek: "33주차", lastSeenAt: "2026-08-11T06:00:00+09:00",
    },
    {
      role: "수동 확인", phase: "QA", detail: "수동으로 관리하는 과거 일정",
      start: "2026-05-20", end: "2026-05-20", status: "예정", source: "manual",
    },
  ];

  const result = compactSchedulesForDisplay(rows, now);

  assert.deepEqual(result.current.map(row => row.detail), ["통합 QA/UAT", "수동으로 관리하는 과거 일정"]);
  assert.deepEqual(result.history.map(row => row.detail), ["29CM 투입", "운영 자체 진행"]);
  assert.equal(result.staleCount, 2);
  assert.equal(isStaleAutomaticSchedule(rows[0], now), true);
  assert.equal(isStaleAutomaticSchedule(rows[1], now), true);
  assert.equal(isStaleAutomaticSchedule(rows[2], now), false);
  assert.equal(isStaleAutomaticSchedule(rows[3], now), false);
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

test("잘못된 연도 또는 종료일이 시작일보다 빠른 자동 일정은 현재 화면에서 제외한다", () => {
  const rows: ScheduleDisplayRow[] = [
    { role: "BE", phase: "개발", start: "0026-06-28", end: "2026-07-01", status: "진행중", source: "jira_weekly" },
    { role: "QA", phase: "QA", start: "2026-08-10", end: "2026-08-01", status: "예정", source: "jira_weekly" },
    { role: "기획", phase: "기획", start: "2026-07-01", end: "2026-07-31", status: "진행중", source: "jira_weekly" },
  ];

  const result = compactSchedulesForDisplay(rows, futureNow);

  assert.deepEqual(result.current.map(row => row.role), ["기획"]);
  assert.deepEqual(result.history.map(row => row.role), ["BE", "QA"]);
  assert.equal(result.invalidCount, 2);
});

test("과거에 저장된 논의·Sync 자동 행은 현재 화면에서 제외하되 수동 행은 보호한다", () => {
  const rows: ScheduleDisplayRow[] = [
    { role: "개발", detail: "PRD 리뷰 및 개발 논의 진행", phase: "개발", start: "2026-06-26", end: "2026-06-26", status: "진행중", source: "jira_weekly" },
    { role: "QA", detail: "통합 성과 지표 논의 예정", phase: "QA", start: "2026-07-09", end: "2026-07-09", status: "예정", source: "jira_weekly" },
    { role: "QA", detail: "통합검수 정책 플로우 정리중", phase: "QA", start: "2026-06-18", end: "2026-06-18", status: "진행중", source: "jira_weekly" },
    { role: "개발", detail: "개발팀 Sync", phase: "개발", start: "2026-07-01", end: "2026-07-01", status: "예정", source: "manual" },
  ];

  const result = compactSchedulesForDisplay(rows, futureNow);

  assert.deepEqual(result.current.map(row => row.source), ["manual"]);
  assert.equal(result.noiseCount, 3);
});

test("재파싱에서 이력화된 자동 행은 현재 일정에서 제외한다", () => {
  const rows: ScheduleDisplayRow[] = [
    { role: "BE", phase: "개발", start: "2026-07-10", end: "2026-07-10", status: "예정", source: "jira_weekly", archivedAt: "2026-07-28T00:00:00Z" },
    { role: "MSS BE", phase: "개발", start: "2026-07-20", end: "2026-07-31", status: "진행중", source: "jira_weekly" },
  ];

  const result = compactSchedulesForDisplay(rows, futureNow);

  assert.deepEqual(result.current.map(row => row.role), ["MSS BE"]);
  assert.deepEqual(result.history.map(row => row.role), ["BE"]);
});

test("TM-2901 유사 QA 일정은 최신 Weekly만 남기고 단독 괄호 조각은 노이즈로 이력화한다", () => {
  const rows: ScheduleDisplayRow[] = [
    {
      role: "QA",
      phase: "QA",
      resourceTeam: "성능, 통합 및 대응 (1MD) 예정",
      detail: "성능, 통합 및 대응 (1MD) 예정",
      start: "2026-08-07",
      end: "2026-08-07",
      status: "예정",
      source: "jira_weekly",
      sourceWeek: "31주차",
      lastSeenAt: "2026-08-01T00:00:00Z",
    },
    {
      role: "QA",
      phase: "QA",
      resourceTeam: "성능, 통합 및 대응",
      detail: "성능, 통합 및 대응",
      start: "2026-08-02",
      end: "2026-08-02",
      status: "예정",
      source: "jira_weekly",
      sourceWeek: "33주차",
      lastSeenAt: "2026-08-11T00:00:00Z",
    },
    {
      role: "개발",
      phase: "개발",
      resourceTeam: "radar TF 위클리 - 후속 일정 확인 완료",
      detail: "EOD까지 모니터링 후 29CM RADAR s3 OPS 수기 작업 중단",
      start: "2026-08-11",
      end: "2026-08-11",
      status: "진행중",
      source: "jira_weekly",
      sourceWeek: "33주차",
      lastSeenAt: "2026-08-11T00:00:00Z",
    },
    {
      role: "개발",
      phase: "개발",
      resourceTeam: "radar TF 위클리 - 후속 일정 확인 완료",
      detail: ")",
      start: "2026-08-12",
      end: "2026-08-12",
      status: "예정",
      source: "jira_weekly",
      sourceWeek: "33주차",
      lastSeenAt: "2026-08-11T00:00:01Z",
    },
  ];

  const result = compactSchedulesForDisplay(rows, new Date("2026-08-11T12:00:00+09:00").getTime());

  assert.deepEqual(result.current.map(row => row.detail), [
    "EOD까지 모니터링 후 29CM RADAR s3 OPS 수기 작업 중단",
  ]);
  assert.equal(result.supersededCount, 1);
  assert.equal(result.staleCount, 1);
  assert.equal(result.noiseCount, 1);
});

test("이력 펼침에서는 자동 파서의 단독 문장부호만 숨기고 수동 일정은 보호한다", () => {
  assert.equal(isMeaningfulScheduleHistoryRow({
    role: "개발",
    detail: ")",
    source: "jira_weekly",
  }), false);
  assert.equal(isMeaningfulScheduleHistoryRow({
    role: "개발",
    detail: "EOD까지 모니터링",
    source: "jira_weekly",
  }), true);
  assert.equal(isMeaningfulScheduleHistoryRow({
    role: "수동 메모",
    detail: ")",
    source: "manual",
  }), true);
  assert.equal(isMeaningfulScheduleHistoryRow({
    role: "BE",
    phase: "개발",
    detail: ")",
    start: "2026-06-29",
    end: "2026-08-02",
    status: "완료",
    source: "jira_weekly",
  }), true);
  assert.equal(isPrimaryScheduleRange({
    role: "BE",
    phase: "개발",
    detail: ")",
    start: "2026-06-29",
    end: "2026-08-02",
    status: "완료",
    source: "jira_weekly",
  }), true);
  assert.equal(isPrimaryScheduleRange({
    role: "기획",
    phase: "기획",
    detail: "요구사항 리뷰 일정",
    start: "2026-06-29",
    end: "2026-08-02",
    status: "완료",
    source: "jira_weekly",
  }), false);
  assert.equal(isPrimaryScheduleRange({
    role: "BE",
    phase: "개발",
    detail: "개발 기간",
    start: "2026-08-10",
    end: "2026-08-01",
    status: "완료",
    source: "jira_weekly",
  }), false);
  assert.equal(isPrimaryScheduleRange({
    role: "QA",
    phase: "QA",
    detail: "과거 QA 계획",
    start: "2026-05-26",
    end: "2026-06-02",
    status: "예정",
    source: "jira_weekly",
  }), false);
});
