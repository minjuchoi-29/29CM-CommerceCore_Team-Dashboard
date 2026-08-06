import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Ticket } from "../app/jira-tickets/TicketBoard";
import { getActionItems, getActionItemsForScope } from "../lib/action-items";

const ticket = {
  key: "TM-TEST",
  summary: "테스트 티켓",
  status: "개발중",
  eta: "2099-12-31",
} as Ticket;

describe("action item scope", () => {
  it("Weekly 화면에는 일정 운영 신호만 반환", () => {
    const weekly = getActionItemsForScope(ticket, { reviewNeeded: true }, [], undefined, "weekly");

    assert.deepEqual(weekly.map(item => item.id), ["no-schedule", "no-launch"]);
  });

  it("플래닝과 데이터 정리 신호를 별도 scope로 분리", () => {
    const all = getActionItems(ticket, { reviewNeeded: true }, [], undefined);

    assert.deepEqual(all.filter(item => item.scope === "planning").map(item => item.id), ["review-needed"]);
    assert.deepEqual(all.filter(item => item.scope === "data").map(item => item.id), ["no-source", "no-docs"]);
  });
});
