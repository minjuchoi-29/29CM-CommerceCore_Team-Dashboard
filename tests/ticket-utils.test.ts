import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTicketReference } from "../lib/ticket-utils";

describe("티켓 복사 형식", () => {
  it("티켓 번호 링크와 제목을 한 줄 Markdown으로 만든다", () => {
    assert.equal(
      buildTicketReference("TM-2745", "[페이먼츠] 무신사머니 케이뱅크 제휴통장 연동"),
      "[TM-2745](https://jira.team.musinsa.com/browse/TM-2745) · [페이먼츠] 무신사머니 케이뱅크 제휴통장 연동",
    );
  });

  it("앞뒤 공백을 제거한다", () => {
    assert.equal(
      buildTicketReference(" TM-2215 ", " Weekly flash prep "),
      "[TM-2215](https://jira.team.musinsa.com/browse/TM-2215) · Weekly flash prep",
    );
  });
});
