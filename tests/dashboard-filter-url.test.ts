import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseEtrDashboardUrl,
  parseTicketDashboardUrl,
  uniqueQueryValues,
  writeEtrDashboardUrl,
  writeTicketDashboardUrl,
} from "../lib/dashboard-filter-url";

describe("dashboard filter URL", () => {
  it("동일 필터의 중복값을 제거하고 서로 다른 값은 모두 보존", () => {
    const params = new URLSearchParams("project=TM&project=CMDATA&project=TM");
    assert.deepEqual(uniqueQueryValues(params, "project"), ["TM", "CMDATA"]);
  });

  it("전체 과제의 다중 필터를 반복 query로 직렬화하고 상세 query를 보존", () => {
    const parsed = parseTicketDashboardUrl(new URLSearchParams(
      "scope=active&stage=dev&check=weekly&sort=eta&project=TM&project=CMDATA&project=TM&role=assignee&role=reporter&q=RADAR&ticket=TM-2901&focus=1",
    ));
    assert.equal(parsed.canonical, true);
    assert.deepEqual(parsed.state.projects, ["TM", "CMDATA"]);
    assert.deepEqual(parsed.state.participationRoles, ["assignee", "reporter"]);

    const written = writeTicketDashboardUrl(new URLSearchParams("ticket=TM-2901&focus=1&project=OLD"), parsed.state);
    assert.equal(written.get("ticket"), "TM-2901");
    assert.equal(written.get("focus"), "1");
    assert.deepEqual(written.getAll("project"), ["CMDATA", "TM"]);
    assert.equal(written.getAll("project").filter(value => value === "TM").length, 1);
    assert.equal(written.get("scope"), "active");
    assert.equal(written.get("stage"), "dev");
  });

  it("기존 ptab 링크를 계속 해석", () => {
    const parsed = parseTicketDashboardUrl(new URLSearchParams("ptab=%EC%99%84%EB%A3%8C&q=RADAR"));
    assert.equal(parsed.canonical, false);
    assert.equal(parsed.state.planningTab, "완료");
    assert.equal(parsed.state.search, "RADAR");
  });

  it("ETR 필터·정렬·선택 티켓을 왕복하고 기존 query를 제거", () => {
    const parsed = parseEtrDashboardUrl(new URLSearchParams(
      "view=hasLinkedWork&jiraStatus=Tech+%EA%B2%80%ED%86%A0%EC%A4%91&q=%EA%B2%B0%EC%A0%9C&sort=eta&dir=desc&key=ETR-6233",
    ));
    assert.equal(parsed.canonical, true);
    assert.equal(parsed.state.filter, "hasLinkedWork");
    assert.equal(parsed.state.sort?.col, "eta");
    assert.equal(parsed.state.sort?.dir, "desc");
    assert.equal(parsed.state.selectedKey, "ETR-6233");

    const written = writeEtrDashboardUrl(new URLSearchParams("view=all&jiraStatus=OLD&unrelated=keep"), parsed.state);
    assert.equal(written.get("unrelated"), "keep");
    assert.deepEqual(written.getAll("jiraStatus"), ["Tech 검토중"]);
    assert.equal(written.get("key"), "ETR-6233");
  });
});
