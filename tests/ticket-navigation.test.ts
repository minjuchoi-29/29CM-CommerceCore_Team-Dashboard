import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTicketListUrl } from "../lib/ticket-navigation";

describe("buildTicketListUrl", () => {
  it("상세 화면 query만 제거하고 목록 문맥은 보존", () => {
    assert.equal(
      buildTicketListUrl("/", "?ticket=TM-2215&focus=schedule&source=owner_dashboard&mode=focus&ptab=%EC%A7%84%ED%96%89+%EC%A4%91&q=RADAR"),
      "/?ptab=%EC%A7%84%ED%96%89+%EC%A4%91&q=RADAR",
    );
  });

  it("남는 query가 없으면 pathname만 반환", () => {
    assert.equal(buildTicketListUrl("/", "?ticket=TM-2215"), "/");
  });
});
