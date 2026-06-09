/**
 * lib/jira-adf.ts — ADF builder + marker finder contract tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCommentBody, findMarkerInADF } from "../lib/jira-adf";

describe("buildCommentBody", () => {
  it("단순 한 줄 → doc + paragraph", () => {
    const doc = buildCommentBody("hello");
    assert.equal(doc.type, "doc");
    assert.equal(doc.version, 1);
    assert.equal(doc.content.length, 1);
    assert.equal(doc.content[0].type, "paragraph");
    assert.equal(doc.content[0].content?.[0].text, "hello");
  });

  it("빈 줄로 paragraph 분리", () => {
    const doc = buildCommentBody("first\n\nsecond");
    assert.equal(doc.content.length, 3); // first, blank, second
    assert.equal(doc.content[0].content?.[0].text, "first");
    assert.equal(doc.content[1].content, undefined); // blank paragraph
    assert.equal(doc.content[2].content?.[0].text, "second");
  });

  it("- bullet → bulletList", () => {
    const doc = buildCommentBody("intro\n- a\n- b");
    assert.equal(doc.content.length, 2);
    assert.equal(doc.content[0].type, "paragraph");
    assert.equal(doc.content[1].type, "bulletList");
    assert.equal(doc.content[1].content?.length, 2);
    assert.equal(doc.content[1].content?.[0].type, "listItem");
    assert.equal(
      doc.content[1].content?.[0].content?.[0].content?.[0].text,
      "a",
    );
  });

  it("* bullet 도 동일 처리", () => {
    const doc = buildCommentBody("* x\n* y");
    assert.equal(doc.content[0].type, "bulletList");
    assert.equal(doc.content[0].content?.length, 2);
  });

  it("marker → 마지막 paragraph + inline code mark", () => {
    const doc = buildCommentBody("body", "MARKER-XYZ");
    const last = doc.content[doc.content.length - 1];
    assert.equal(last.type, "paragraph");
    assert.equal(last.content?.[0].text, "MARKER-XYZ");
    assert.deepEqual(last.content?.[0].marks, [{ type: "code" }]);
  });

  it("marker 없으면 부착 안 됨", () => {
    const doc = buildCommentBody("body");
    const last = doc.content[doc.content.length - 1];
    assert.equal(last.content?.[0].marks, undefined);
  });

  it("CRLF 줄바꿈도 처리", () => {
    const doc = buildCommentBody("a\r\nb");
    assert.equal(doc.content.length, 2);
    assert.equal(doc.content[0].content?.[0].text, "a");
    assert.equal(doc.content[1].content?.[0].text, "b");
  });

  it("실제 댓글 포맷 시나리오", () => {
    const text = `연결된 실행 티켓이 모두 완료 상태로 확인되었습니다.

완료된 실행 티켓:
- TM-2924
- M29CMCT-5942

ETR 상태를 최신 상태로 업데이트해주세요.`;
    const doc = buildCommentBody(text, "cc-dashboard-status-update-needed");
    // paragraph(1) + blank(2) + paragraph(3) + bulletList(4) + blank(5) + paragraph(6) + marker(7)
    assert.equal(doc.content.length, 7);
    assert.equal(doc.content[3].type, "bulletList");
    assert.equal(doc.content[3].content?.length, 2);
    const marker = doc.content[6];
    assert.equal(marker.content?.[0].text, "cc-dashboard-status-update-needed");
    assert.deepEqual(marker.content?.[0].marks, [{ type: "code" }]);
  });
});

describe("findMarkerInADF", () => {
  it("flat text 매칭", () => {
    const body = { type: "doc", content: [{ type: "text", text: "MARKER-X" }] };
    assert.equal(findMarkerInADF(body, "MARKER-X"), true);
  });

  it("nested content 재귀 탐색", () => {
    const body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "hello MARKER-Y world" }],
        },
      ],
    };
    assert.equal(findMarkerInADF(body, "MARKER-Y"), true);
  });

  it("미발견 → false", () => {
    const body = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "abc" }] }],
    };
    assert.equal(findMarkerInADF(body, "MARKER"), false);
  });

  it("null / undefined / non-object → false", () => {
    assert.equal(findMarkerInADF(null, "x"), false);
    assert.equal(findMarkerInADF(undefined, "x"), false);
    assert.equal(findMarkerInADF("string", "x"), false);
  });

  it("marker 가 빈 문자열 → false", () => {
    const body = { type: "text", text: "anything" };
    assert.equal(findMarkerInADF(body, ""), false);
  });

  it("buildCommentBody 와 round-trip — 부착한 marker 발견", () => {
    const doc = buildCommentBody("hello world", "MY-MARKER");
    assert.equal(findMarkerInADF(doc, "MY-MARKER"), true);
    assert.equal(findMarkerInADF(doc, "MISSING"), false);
  });
});
