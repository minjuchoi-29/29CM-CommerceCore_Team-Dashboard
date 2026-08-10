import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeWeeklyNotesForDisplay,
  selectOpenWeeklyNotesForDisplay,
} from "../lib/weekly-note-display";
import type { WeeklyNote } from "../lib/weekly-types";

function makeNote(overrides: Partial<WeeklyNote> = {}): WeeklyNote {
  return {
    id: "TM-2745::31주차::risk::1",
    ticketKey: "TM-2745",
    source: "jira_weekly",
    sourceWeek: "31주차",
    type: "risk",
    content: "금감원 재검토 이슈로 대고객 런칭일자 미정",
    status: "open",
    createdAt: "2026-08-03T00:00:00.000Z",
    sourceUpdatedAt: "2026-08-03T00:00:00.000Z",
    lastSeenAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("Weekly note 화면 중복 제거", () => {
  it("여러 주차에 반복된 같은 리스크는 최신 주차 한 건만 표시한다", () => {
    const notes = [
      makeNote(),
      makeNote({ id: "TM-2745::32주차::risk::1", sourceWeek: "32주차" }),
    ];

    const result = dedupeWeeklyNotesForDisplay(notes);

    assert.equal(result.length, 1);
    assert.equal(result[0].sourceWeek, "32주차");
  });

  it("공백과 선행 bullet 차이도 같은 내용으로 본다", () => {
    const notes = [
      makeNote(),
      makeNote({
        id: "TM-2745::32주차::risk::1",
        sourceWeek: "32주차",
        content: " • 금감원   재검토 이슈로 대고객 런칭일자 미정 ",
      }),
    ];

    assert.equal(dedupeWeeklyNotesForDisplay(notes).length, 1);
  });

  it("내용이 다르거나 유형이 다르면 별도 항목으로 유지한다", () => {
    const notes = [
      makeNote(),
      makeNote({ id: "risk-2", content: "QA 일정 확인 필요" }),
      makeNote({ id: "action-1", type: "next_action" }),
    ];

    assert.equal(dedupeWeeklyNotesForDisplay(notes).length, 3);
  });

  it("최신 반복 항목이 해결 상태면 열린 리스크에서 제외한다", () => {
    const notes = [
      makeNote(),
      makeNote({
        id: "TM-2745::32주차::risk::1",
        sourceWeek: "32주차",
        status: "resolved",
      }),
    ];

    assert.equal(selectOpenWeeklyNotesForDisplay(notes).length, 0);
  });
});
