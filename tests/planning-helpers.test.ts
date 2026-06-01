/**
 * planning-helpers.ts — single source of truth contract tests.
 *
 * TicketBoard(간략/집중보기), q2-initiative, roadmap이 같은 Planning KV 값을 보고
 * **반드시 같은 결과**로 해석해야 한다는 invariant을 보호한다.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateDevState,
  getPlanningView,
  getPlanningStateSummary,
  planningViewsMatch,
} from "../lib/planning-helpers";

describe("aggregateDevState — 보수적 정책", () => {
  it("빈 입력 → 대기중", () => {
    assert.equal(aggregateDevState({}), "대기중");
  });
  it("전부 대상아님 → 대상아님", () => {
    assert.equal(aggregateDevState({ SP: "대상아님", PP: "대상아님" }), "대상아님");
  });
  it("active 하나라도 대기중 → 대기중 (가장 보수적)", () => {
    assert.equal(aggregateDevState({ SP: "완료", PP: "대기중", CFE: "검토중" }), "대기중");
  });
  it("active 중 대기중 없이 검토중 있으면 → 검토중", () => {
    assert.equal(aggregateDevState({ SP: "완료", PP: "검토중", CFE: "대상아님" }), "검토중");
  });
  it("모든 active 완료 → 완료", () => {
    assert.equal(aggregateDevState({ SP: "완료", PP: "완료", CFE: "대상아님" }), "완료");
  });
});

describe("getPlanningView — devTracks 우선 정책 (silent loss 방지)", () => {
  it("devTracks가 비어있으면 v.dev 그대로 사용 (legacy)", () => {
    const view = getPlanningView({ design: "검토중", dev: "완료" });
    assert.equal(view.design, "검토중");
    assert.equal(view.dev, "완료");
    assert.deepEqual(view.devTracks, {});
  });

  it("devTracks가 있으면 aggregateDevState(devTracks)로 자동 계산 — v.dev 무시", () => {
    // TM-2745 시나리오: v.dev="완료"로 저장되어 있지만 devTracks에 대기중이 섞여있는 경우
    const view = getPlanningView({
      design: "완료",
      dev: "완료",
      devTracks: { SP: "완료", PP: "대기중" },
    });
    assert.equal(view.dev, "대기중", "보수적 집계 — 하나라도 대기중이면 전체 대기중");
  });

  it("null / 문자열 / undefined 값 → 모두 default (대기중)", () => {
    for (const v of [null, undefined, "", "anything"]) {
      const view = getPlanningView(v);
      assert.equal(view.design, "대기중");
      assert.equal(view.dev, "대기중");
      assert.deepEqual(view.devTracks, {});
      assert.equal(view.reviewNeeded, false);
    }
  });

  it("reviewNeeded 플래그 보존", () => {
    const view = getPlanningView({ design: "완료", dev: "완료", reviewNeeded: true });
    assert.equal(view.reviewNeeded, true);
  });
});

describe("getPlanningStateSummary — PlanningBadge 표시 상태", () => {
  it("reviewNeeded → 확인필요 (최우선)", () => {
    assert.equal(
      getPlanningStateSummary({ design: "완료", dev: "완료", reviewNeeded: true }),
      "확인필요",
    );
  });
  it("design+dev 모두 대상아님 → 대상아님", () => {
    assert.equal(getPlanningStateSummary({ design: "대상아님", dev: "대상아님" }), "대상아님");
  });
  it("design 완료 + dev 대상아님 → 플래닝 완료 (대상아님은 done 취급)", () => {
    assert.equal(getPlanningStateSummary({ design: "완료", dev: "대상아님" }), "플래닝 완료");
  });
  it("하나라도 검토중 → 검토중", () => {
    assert.equal(getPlanningStateSummary({ design: "검토중", dev: "대기중" }), "검토중");
  });
  it("기본 → 대기중", () => {
    assert.equal(getPlanningStateSummary({ design: "대기중", dev: "대기중" }), "대기중");
  });
});

describe("cross-view consistency — TicketBoard / Q2 / Roadmap 결과 일치", () => {
  it("같은 KV 값 → 모든 화면에서 같은 view (invariant)", () => {
    // 시나리오: TM-2745 같은 KV 값을 3 페이지가 각자 해석할 때
    const kvValue = {
      design: "완료",
      dev: "완료", // legacy 값 (mismatch 대상)
      devTracks: { SP: "완료", PP: "대기중", CFE: "검토중" },
    };
    const fromBoard = getPlanningView(kvValue);
    const fromQ2 = getPlanningView(kvValue);
    const fromRoadmap = getPlanningView(kvValue);

    // dev는 aggregate 정책으로 통일 — v.dev="완료" 무시
    assert.equal(fromBoard.dev, "대기중");
    assert.equal(fromQ2.dev, "대기중");
    assert.equal(fromRoadmap.dev, "대기중");

    // 세 view가 완전히 동일해야 한다
    assert.deepEqual(planningViewsMatch(fromBoard, fromQ2), { match: true });
    assert.deepEqual(planningViewsMatch(fromQ2, fromRoadmap), { match: true });
  });

  it("planningViewsMatch — 다른 design이면 reason 포함", () => {
    const a = getPlanningView({ design: "완료", dev: "대기중" });
    const b = getPlanningView({ design: "검토중", dev: "대기중" });
    const r = planningViewsMatch(a, b);
    assert.equal(r.match, false);
    assert.match(r.reason ?? "", /design/);
  });
});
