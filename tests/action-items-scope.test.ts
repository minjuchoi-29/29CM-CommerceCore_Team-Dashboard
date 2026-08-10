import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Ticket } from "../app/jira-tickets/TicketBoard";
import {
  getActionItems,
  getActionItemsForScope,
  getActionItemsForScopeWhenReady,
  getLaunchReadiness,
} from "../lib/action-items";

const ticket = {
  key: "TM-TEST",
  summary: "테스트 티켓",
  status: "개발중",
  eta: "2099-12-31",
} as Ticket;

describe("action item scope", () => {
  it("Weekly 화면에는 일정 운영 신호만 반환", () => {
    const weekly = getActionItemsForScope(ticket, { reviewNeeded: true }, [], undefined, "weekly");

    assert.deepEqual(weekly.map(item => item.id), ["no-schedule"]);
  });

  it("플래닝과 데이터 정리 신호를 별도 scope로 분리", () => {
    const all = getActionItems(ticket, { reviewNeeded: true }, [], undefined);

    assert.deepEqual(all.filter(item => item.scope === "planning").map(item => item.id), ["review-needed"]);
    assert.deepEqual(all.filter(item => item.scope === "data").map(item => item.id), ["no-source", "no-docs"]);
  });

  it("KV hydrate 전에는 빈 일정을 근거로 거짓 주의 신호를 노출하지 않음", () => {
    const beforeHydration = getActionItemsForScopeWhenReady(
      false,
      ticket,
      undefined,
      [],
      undefined,
      "weekly",
    );
    const afterHydration = getActionItemsForScopeWhenReady(
      true,
      ticket,
      undefined,
      [],
      undefined,
      "weekly",
    );

    assert.deepEqual(beforeHydration, []);
    assert.deepEqual(afterHydration.map(item => item.id), ["no-schedule"]);
  });
});

describe("launch readiness", () => {
  const today = "2026-08-10";

  it("Jira 기한이 있으면 별도 Launch row가 없어도 거짓 경고를 만들지 않음", () => {
    const result = getLaunchReadiness(
      { eta: "2026-09-30" },
      [],
      "32주차 Weekly 공유사항\nPM: 기획 진행 중",
      today,
    );

    assert.deepEqual(result, {
      targetDate: "2026-09-30",
      source: "jira_due",
      confidence: "target",
      attention: "none",
    });
  });

  it("TM-2759형: 최신 Weekly에 론치일이 있고 Jira 기한과 맞으면 정상", () => {
    const result = getLaunchReadiness(
      { eta: "2026-09-02" },
      [],
      "* 론치 date\n  * 9/2",
      today,
    );

    assert.equal(result.attention, "none");
    assert.equal(result.source, "weekly");
  });

  it("TM-3264형: 월말 배포 ETA도 명시된 목표일로 인정", () => {
    const result = getLaunchReadiness(
      { eta: "2026-09-30" },
      [],
      "6. 배포 ETA: 9월말",
      today,
    );

    assert.equal(result.attention, "none");
    assert.equal(result.source, "weekly");
  });

  it("TM-2922형: 기한이 있어도 Weekly가 론치 ETA 변경 필요를 명시하면 주의", () => {
    const result = getLaunchReadiness(
      { eta: "2026-08-31" },
      [],
      "* QA 일정에 따라 배포 및 론치 ETA 변경 필요",
      today,
    );

    assert.equal(result.attention, "warning");
    assert.equal(result.reason, "change_needed");
    assert.equal(result.label, "론치 일정 재확인 · 기준 8/31");
  });

  it("먼 미래의 Jira 기한이 있으면 초기 단계의 TBD만으로 즉시 경고하지 않음", () => {
    const result = getLaunchReadiness(
      { eta: "2027-01-29" },
      [],
      "* 배포/론치 : TBD",
      today,
    );

    assert.equal(result.attention, "none");
    assert.equal(result.source, "jira_due");
  });

  it("기한이 4주 안으로 다가왔는데 최신 Weekly도 TBD면 확인 대상으로 전환", () => {
    const result = getLaunchReadiness(
      { eta: "2026-08-31" },
      [],
      "* 배포/론치 : TBD",
      today,
    );

    assert.equal(result.attention, "warning");
    assert.equal(result.reason, "near_tbd");
  });

  it("QA 종료가 Jira 기한을 넘으면 일정 충돌로 판정", () => {
    const result = getLaunchReadiness(
      { eta: "2026-08-31" },
      [{ role: "QA", phase: "QA", start: "2026-08-28", end: "2026-09-02", status: "예정" }],
      undefined,
      today,
    );

    assert.equal(result.attention, "critical");
    assert.equal(result.reason, "schedule_conflict");
  });

  it("최신 Weekly의 명시 론치일이 Jira 기한보다 늦으면 일정 충돌로 판정", () => {
    const result = getLaunchReadiness(
      { eta: "2026-09-02" },
      [],
      "* 론치 date\n  * 9/4",
      today,
    );

    assert.equal(result.attention, "critical");
    assert.equal(result.reason, "schedule_conflict");
    assert.equal(result.label, "기한 이후 일정 확인 · 기준 9/2");
  });

  it("Jira 기한과 명시 일정이 모두 없을 때만 목표일 확인 경고", () => {
    const result = getLaunchReadiness({ eta: "-" }, [], undefined, today);

    assert.equal(result.attention, "warning");
    assert.equal(result.reason, "missing");
    assert.equal(result.label, "론치 목표일 확인 필요");
  });
});
