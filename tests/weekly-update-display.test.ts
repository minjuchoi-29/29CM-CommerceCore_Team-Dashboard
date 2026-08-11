import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { WeeklyNote, WeeklySourceText } from "../lib/weekly-types";
import { getWeeklyUpdateDisplay } from "../lib/weekly-update-display";

function source(overrides: Partial<WeeklySourceText> = {}): WeeklySourceText {
  return {
    ticketKey: "TM-2215",
    text: "Weekly 공유사항",
    source: "description",
    policyReason: "description-first",
    sourceWeek: "32주차",
    sourceUpdatedAt: "2026-08-10T03:00:00.000Z",
    savedAt: "2026-08-10T03:01:00.000Z",
    ...overrides,
  };
}

function note(overrides: Partial<WeeklyNote> = {}): WeeklyNote {
  return {
    id: "TM-2215::31주차::progress::1",
    ticketKey: "TM-2215",
    source: "jira_weekly",
    sourceWeek: "31주차",
    type: "progress",
    content: "개발 진행중",
    status: "open",
    createdAt: "2026-08-03T03:00:00.000Z",
    sourceUpdatedAt: "2026-08-03T03:00:00.000Z",
    lastSeenAt: "2026-08-03T03:00:00.000Z",
    ...overrides,
  };
}

describe("목록 Weekly 갱신 표시", () => {
  it("선택된 Weekly 원문의 주차와 Jira 수정일을 우선한다", () => {
    const result = getWeeklyUpdateDisplay(source(), [note()]);
    assert.equal(result.label, "32주차 · 8/10 갱신");
    assert.equal(result.hasData, true);
  });

  it("원문 KV가 없으면 가장 최근 Weekly note를 사용한다", () => {
    const result = getWeeklyUpdateDisplay(undefined, [
      note(),
      note({ id: "new", sourceWeek: "32주차", lastSeenAt: "2026-08-09T03:00:00.000Z" }),
    ]);
    assert.equal(result.label, "32주차 · 8/9 갱신");
  });

  it("Weekly 데이터가 없으면 중립적으로 표시한다", () => {
    assert.deepEqual(getWeeklyUpdateDisplay(), {
      sourceWeek: "",
      updatedAt: "",
      dateLabel: "",
      label: "Weekly 없음",
      hasData: false,
    });
  });
});
