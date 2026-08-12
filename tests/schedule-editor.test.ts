import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ScheduleEditor, { type EditableScheduleRow } from "@/app/jira-tickets/ScheduleEditor";

function renderEditor(rows: EditableScheduleRow[]) {
  return renderToStaticMarkup(createElement(ScheduleEditor, {
    rows,
    editError: null,
    focusKey: null,
    saving: false,
    preservedLegacyCount: 0,
    rowRefs: { current: [] },
    makeFocusKey: () => "",
    onChangeRow: () => {},
    onRemoveRow: () => {},
    onAddWork: () => {},
    onAddMilestone: () => {},
    onSort: () => {},
    onSave: () => {},
    onCancel: () => {},
  }));
}

test("편집 화면에서 감춘 과거 중복 마일스톤 수를 데이터 보존 안내로 표시한다", () => {
  const markup = renderToStaticMarkup(createElement(ScheduleEditor, {
    rows: [],
    editError: null,
    focusKey: null,
    saving: false,
    preservedLegacyCount: 1,
    rowRefs: { current: [] },
    makeFocusKey: () => "",
    onChangeRow: () => {},
    onRemoveRow: () => {},
    onAddWork: () => {},
    onAddMilestone: () => {},
    onSort: () => {},
    onSave: () => {},
    onCancel: () => {},
  }));

  assert.match(markup, /과거 중복 마일스톤 1건/);
  assert.match(markup, /원본을 유지/);
});

test("공용 일정 편집기는 저장된 행만 열고 빈 Release/Launch 행을 자동 생성하지 않는다", () => {
  const markup = renderEditor([{
    role: "BE - Pricing",
    resourceTeam: "BE - Pricing",
    person: "담당자",
    start: "2026-08-10",
    end: "2026-08-14",
    status: "진행중",
    phase: "개발",
    source: "jira_weekly",
    sourceWeek: "33주차",
  }]);

  assert.equal((markup.match(/일정 단계/g) ?? []).length, 1);
  assert.match(markup, /Weekly · 33주차/);
  assert.doesNotMatch(markup, /2번 일정 단계/);
});

test("팀 입력은 공식 표현을 제안하면서 자유 입력 필드를 유지한다", () => {
  const markup = renderEditor([{
    role: "협업 팀",
    resourceTeam: "협업 팀",
    person: "",
    start: "",
    end: "",
    status: "미정",
    phase: "기타",
    source: "manual",
    manualLocked: true,
  }]);

  for (const team of ["PM", "Design", "BE - Pricing", "BE - Purchase", "FE - Commerce"]) {
    assert.match(markup, new RegExp(`value="${team}"`));
  }
  assert.match(markup, /list="schedule-team-suggestions"/);
  assert.match(markup, /value="협업 팀"/);
});
