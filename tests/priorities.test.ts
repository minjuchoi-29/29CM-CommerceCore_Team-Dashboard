/**
 * lib/priorities.ts contract tests.
 *
 * 보호 invariants:
 *  - planning/execution 분리 + execution → planning fallback (backward compat)
 *  - priorityNumOf: 정렬용 numeric 변환 안정성 ("완료"/미설정/non-numeric → Infinity)
 *  - duplicate count 정확성 (per-map + resolved execution)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getPlanningPriority,
  getExecutionPriority,
  priorityNumOf,
  countNumericDuplicates,
  countResolvedExecutionDuplicates,
  type PriorityMap,
} from "../lib/priorities";

describe("getPlanningPriority — 직접 조회", () => {
  it("planning map 의 값 그대로 반환", () => {
    const planning: PriorityMap = { "CMALL-1": "1", "CMALL-2": "2" };
    assert.equal(getPlanningPriority(planning, "CMALL-1"), "1");
    assert.equal(getPlanningPriority(planning, "CMALL-2"), "2");
  });

  it("미설정 key → undefined", () => {
    assert.equal(getPlanningPriority({}, "CMALL-9"), undefined);
  });

  it("완료 마커도 그대로 반환 (해석 layer 는 정렬에서만)", () => {
    assert.equal(getPlanningPriority({ "X-1": "완료" }, "X-1"), "완료");
  });
});

describe("getExecutionPriority — fallback 의미", () => {
  it("Case A — execution 미설정 → planning fallback", () => {
    const planning: PriorityMap = { "CMALL-1": "1" };
    const execution: PriorityMap = {};
    assert.equal(getExecutionPriority(planning, execution, "CMALL-1"), "1");
  });

  it("Case B — execution 설정됨 → execution 사용 (planning 무시)", () => {
    const planning: PriorityMap = { "CMALL-1": "1" };
    const execution: PriorityMap = { "CMALL-1": "3" };
    assert.equal(getExecutionPriority(planning, execution, "CMALL-1"), "3");
  });

  it("둘 다 미설정 → undefined", () => {
    assert.equal(getExecutionPriority({}, {}, "X-9"), undefined);
  });

  it("execution 빈 문자열 → fallback 동작 (빈 문자열도 truthy 아님)", () => {
    // ?? 는 nullish 만 fallback → "" 는 빈 문자열로 반환됨
    const planning: PriorityMap = { "X-1": "5" };
    const execution: PriorityMap = { "X-1": "" };
    // 빈 문자열은 falsy 이지만 nullish 아니므로 그대로 반환됨.
    // 이는 의도 — UI 가 setExecutionPriority(key, "") 시 항목 삭제하므로 빈 값 저장 안 됨.
    assert.equal(getExecutionPriority(planning, execution, "X-1"), "");
  });

  it("execution 의 완료 마커 → 그대로 (planning 무시)", () => {
    const planning: PriorityMap = { "X-1": "1" };
    const execution: PriorityMap = { "X-1": "완료" };
    assert.equal(getExecutionPriority(planning, execution, "X-1"), "완료");
  });
});

describe("priorityNumOf — 정렬용 numeric 변환", () => {
  it("'1', '2', '10' → 숫자", () => {
    assert.equal(priorityNumOf("1"), 1);
    assert.equal(priorityNumOf("2"), 2);
    assert.equal(priorityNumOf("10"), 10);
    assert.equal(priorityNumOf("999"), 999);
  });

  it("미설정 / undefined → Infinity", () => {
    assert.equal(priorityNumOf(undefined), Infinity);
    assert.equal(priorityNumOf(""), Infinity);
  });

  it("완료 마커 → Infinity", () => {
    assert.equal(priorityNumOf("완료"), Infinity);
  });

  it("non-numeric → Infinity", () => {
    assert.equal(priorityNumOf("abc"), Infinity);
    assert.equal(priorityNumOf("P1"), Infinity);
  });

  it("0 이하 → Infinity (의미 없는 priority)", () => {
    assert.equal(priorityNumOf("0"), Infinity);
    assert.equal(priorityNumOf("-1"), Infinity);
  });
});

describe("countNumericDuplicates — per-map 중복 카운트", () => {
  it("숫자 값만 카운트, 같은 값 카운트", () => {
    const map: PriorityMap = {
      "A": "1", "B": "1", "C": "2", "D": "3",
    };
    const dup = countNumericDuplicates(map);
    assert.deepEqual(dup, { "1": 2, "2": 1, "3": 1 });
  });

  it("'완료' / 빈값 / non-numeric → 카운트 안 함", () => {
    const map: PriorityMap = {
      "A": "1", "B": "완료", "C": "", "D": "abc",
    };
    const dup = countNumericDuplicates(map);
    assert.deepEqual(dup, { "1": 1 });
  });

  it("빈 map → 빈 객체", () => {
    assert.deepEqual(countNumericDuplicates({}), {});
  });
});

describe("countResolvedExecutionDuplicates — fallback 포함 중복 카운트", () => {
  it("Case A (execution 미설정) → planning fallback 값으로 카운트", () => {
    const planning: PriorityMap = { "A": "1", "B": "1" };
    const execution: PriorityMap = {};
    const dup = countResolvedExecutionDuplicates(["A", "B"], planning, execution);
    assert.deepEqual(dup, { "1": 2 });
  });

  it("Case B (planning + execution mixed) — execution 우선", () => {
    const planning: PriorityMap = { "A": "1", "B": "1" };
    const execution: PriorityMap = { "A": "3" };
    // A → execution=3 / B → planning=1 (fallback)
    const dup = countResolvedExecutionDuplicates(["A", "B"], planning, execution);
    assert.deepEqual(dup, { "1": 1, "3": 1 });
  });

  it("ticket 목록에 없는 key 는 카운트 안 함", () => {
    const planning: PriorityMap = { "A": "1", "B": "1", "C": "1" };
    const execution: PriorityMap = {};
    const dup = countResolvedExecutionDuplicates(["A", "B"], planning, execution);
    assert.deepEqual(dup, { "1": 2 });
  });

  it("완료 / 미설정 → 카운트 안 함", () => {
    const planning: PriorityMap = { "A": "완료" };
    const execution: PriorityMap = {};
    const dup = countResolvedExecutionDuplicates(["A", "B"], planning, execution);
    assert.deepEqual(dup, {});
  });
});

describe("통합 시나리오 — 사용자 요구사항 Case A / Case B", () => {
  it("Case A — planningPriority=P1, executionPriority 없음 → 두 view 모두 P1", () => {
    const planning: PriorityMap = { "T-1": "1" };
    const execution: PriorityMap = {};

    // Planning view
    assert.equal(getPlanningPriority(planning, "T-1"), "1");
    // Execution view (fallback)
    assert.equal(getExecutionPriority(planning, execution, "T-1"), "1");

    // 정렬에서도 동일 numeric 값
    assert.equal(priorityNumOf(getPlanningPriority(planning, "T-1")), 1);
    assert.equal(priorityNumOf(getExecutionPriority(planning, execution, "T-1")), 1);
  });

  it("Case B — planningPriority=P1, executionPriority=P3 → 다른 view", () => {
    const planning: PriorityMap = { "T-1": "1" };
    const execution: PriorityMap = { "T-1": "3" };

    // Planning view → P1
    assert.equal(getPlanningPriority(planning, "T-1"), "1");
    assert.equal(priorityNumOf(getPlanningPriority(planning, "T-1")), 1);

    // Execution view → P3
    assert.equal(getExecutionPriority(planning, execution, "T-1"), "3");
    assert.equal(priorityNumOf(getExecutionPriority(planning, execution, "T-1")), 3);
  });
});
