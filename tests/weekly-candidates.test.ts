import assert from "node:assert/strict";
import test from "node:test";

import { reconcileUpdateCandidates } from "../lib/weekly-candidates";
import type { UpdateCandidate } from "../lib/weekly-types";

function candidate(
  id: string,
  sourceWeek: string,
  mergeKey: string,
  field: UpdateCandidate["field"],
  resolved = false,
): UpdateCandidate {
  return {
    id,
    ticketKey: "TM-2922",
    mergeKey,
    sourceWeek,
    field,
    oldValue: "old",
    newValue: "new",
    autoApply: false,
    resolved,
    createdAt: "2026-07-24T00:00:00Z",
  };
}

test("최신 주차 후보가 같은 행·필드의 과거 후보를 종료한다", () => {
  const old = candidate("old", "30주차", "TM-2922::개발::mss-be", "end");
  const fresh = candidate("fresh", "31주차", "TM-2922::개발::mss-be", "end");
  const result = reconcileUpdateCandidates(
    [old],
    [fresh],
    "TM-2922",
    "31주차",
    "2026-07-28T00:00:00Z",
  );

  assert.equal(result.find(item => item.id === "old")?.resolved, true);
  assert.equal(result.find(item => item.id === "fresh")?.resolved, false);
});

test("같은 주차 재파싱에서 더 이상 생성되지 않는 노이즈 후보를 종료한다", () => {
  const noise = candidate("noise", "30주차", "TM-2922::개발::be", "start");
  const otherTicket = { ...noise, id: "other", ticketKey: "TM-2901" };
  const result = reconcileUpdateCandidates(
    [noise, otherTicket],
    [],
    "TM-2922",
    "30주차",
    "2026-07-28T00:00:00Z",
  );

  assert.equal(result.find(item => item.id === "noise")?.resolved, true);
  assert.equal(result.find(item => item.id === "other")?.resolved, false);
});

test("동일 ID 후보는 최신 autoApply·resolved 결과로 교체한다", () => {
  const existing = candidate("same", "31주차", "TM-2922::QA::", "end");
  const fresh = {
    ...existing,
    autoApply: true,
    resolved: true,
    resolvedAt: "2026-07-28T00:00:00Z",
  };
  const result = reconcileUpdateCandidates(
    [existing],
    [fresh],
    "TM-2922",
    "31주차",
    "2026-07-28T00:00:00Z",
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].autoApply, true);
  assert.equal(result[0].resolved, true);
});
