import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterTicketsByManagedArea,
  getManagedTicketArea,
  getManagedTicketDestination,
  invalidManagedTicketKeys,
  parseManagedTicketKeys,
} from "../lib/dashboard-ticket-actions";

describe("parseManagedTicketKeys", () => {
  it("공백·쉼표 입력을 대문자 고유 키로 정리", () => {
    assert.deepEqual(
      parseManagedTicketKeys("tm-2901, ETR-12\nTM-2901 cmall-7"),
      ["TM-2901", "ETR-12", "CMALL-7"],
    );
  });

  it("유효하지 않은 키를 분리", () => {
    assert.deepEqual(invalidManagedTicketKeys(["TM-1", "BAD", "-12"]), ["BAD", "-12"]);
  });
});

describe("getManagedTicketArea", () => {
  it("ETR은 프로젝트 또는 키 기준으로 ETR 검토에 배치", () => {
    assert.equal(getManagedTicketArea({ key: "ETR-12", project: "ETR", status: "검토중" }), "etr");
  });

  it("일반 티켓은 Jira lifecycle 기준으로 배치", () => {
    assert.equal(getManagedTicketArea({ key: "TM-1", status: "SUGGESTED", statusCategory: "new" }), "planning");
    assert.equal(getManagedTicketArea({ key: "TM-2", status: "개발중", statusCategory: "indeterminate" }), "active");
    assert.equal(getManagedTicketArea({ key: "TM-3", status: "완료", statusCategory: "done" }), "done");
    assert.equal(getManagedTicketArea({ key: "TM-4", status: "Dropped", statusCategory: "done" }), "done");
  });
});

describe("getManagedTicketDestination", () => {
  it("ETR과 일반 티켓을 적절한 화면 URL로 연결", () => {
    assert.deepEqual(
      getManagedTicketDestination({ key: "ETR-12", project: "ETR", status: "검토중" }),
      { area: "etr", label: "ETR 검토", href: "/etr-review?key=ETR-12" },
    );
    assert.deepEqual(
      getManagedTicketDestination({ key: "TM-2", status: "개발중", statusCategory: "indeterminate" }),
      { area: "active", label: "진행 중", href: "/?ticket=TM-2&ptab=%EC%A7%84%ED%96%89%20%EC%A4%91" },
    );
    assert.deepEqual(
      getManagedTicketDestination({ key: "TM-3", status: "완료", statusCategory: "done" }),
      { area: "done", label: "완료", href: "/?ticket=TM-3&ptab=%EC%A0%84%EC%B2%B4" },
    );
  });
});

describe("filterTicketsByManagedArea", () => {
  it("검색 필터에서 선택한 화면 영역만 남김", () => {
    const tickets = [
      { key: "TM-1", status: "SUGGESTED", statusCategory: "new" },
      { key: "TM-2", status: "개발중", statusCategory: "indeterminate" },
      { key: "ETR-3", project: "ETR", status: "검토중" },
    ];
    assert.deepEqual(filterTicketsByManagedArea(tickets, "active").map(ticket => ticket.key), ["TM-2"]);
    assert.deepEqual(filterTicketsByManagedArea(tickets, "etr").map(ticket => ticket.key), ["ETR-3"]);
  });
});
