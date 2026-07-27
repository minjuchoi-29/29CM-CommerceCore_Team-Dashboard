import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { weeklyAdfToText, type WeeklyAdfNode } from "../lib/weekly-source";
import { parseWeekly } from "../lib/weekly-parser";

describe("weeklyAdfToText — Jira mention 보존", () => {
  it("mention attrs.text를 일정 원문에 보존", () => {
    const adf: WeeklyAdfNode = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "QA: 7/27 / 진행중 / " },
          { type: "mention", attrs: { id: "abc", text: "@강보민" } },
        ],
      }],
    };

    assert.equal(weeklyAdfToText(adf).trim(), "QA: 7/27 / 진행중 / @강보민");
  });

  it("mention text가 없으면 안전하게 빈 문자열", () => {
    assert.equal(weeklyAdfToText({ type: "mention", attrs: { id: "abc" } }), "");
  });

  it("ADF mention이 parser의 일정 담당자까지 전달", () => {
    const adf: WeeklyAdfNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "24주차 Weekly 공유사항" }] },
        { type: "paragraph", content: [{ type: "text", text: "[일정]" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "QA: 7/27 / 진행중 / " },
            { type: "mention", attrs: { id: "abc", text: "@강보민" } },
          ],
        },
      ],
    };

    const parsed = parseWeekly(weeklyAdfToText(adf), "TM-9999");
    assert.equal(parsed.scheduleItems[0]?.assignee, "@강보민");
  });
});
