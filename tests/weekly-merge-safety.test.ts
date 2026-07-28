/**
 * Tests for merge safety / manual guard / trace additions
 * (PR: feat/weekly-merge-safety-trace).
 *
 * 본 PR의 추가 기능만 검증:
 *   1. mergeTrace — outcome / matchedRowSource / conflictCount 기록
 *   2. canAutoApplyToRow — source별 가드 정책
 *   3. manual row guard — source=manual인 row가 weekly sync로 덮어쓰이지 않음
 *   4. getRowAllKeys — multi-key 후보 산출 (PUT handler가 사용)
 *
 * 기존 stable identity / partial update 로직은 main 구현(126c585) 그대로 활용 —
 * 본 PR은 그 위에 safety guard와 explainability를 추가하는 보강 작업.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  mergeWeeklySync, canAutoApplyToRow, getRowAllKeys, getRowKey,
  type ExtendedSchedule,
} from "../lib/weekly-merge";
import { parseWeekly } from "../lib/weekly-parser";

// ─── canAutoApplyToRow ───────────────────────────────────────

describe("canAutoApplyToRow — source별 정책", () => {
  test("source=jira_weekly → 허용", () => {
    assert.equal(canAutoApplyToRow({ source: "jira_weekly" } as ExtendedSchedule), true);
  });
  test("source=legacy → 허용", () => {
    assert.equal(canAutoApplyToRow({ source: "legacy" } as ExtendedSchedule), true);
  });
  test("source=undefined → 허용 (legacy 호환)", () => {
    assert.equal(canAutoApplyToRow({} as ExtendedSchedule), true);
  });
  test("source=manual → 금지", () => {
    assert.equal(canAutoApplyToRow({ source: "manual" } as ExtendedSchedule), false);
  });
  test("source=imported → 금지", () => {
    assert.equal(canAutoApplyToRow({ source: "imported" } as ExtendedSchedule), false);
  });
  test("source=confirmed → 금지", () => {
    assert.equal(canAutoApplyToRow({ source: "confirmed" } as ExtendedSchedule), false);
  });
});

// ─── manual row guard — merge 흐름에서 실제 적용 ──────────────

describe("manual row guard — weekly sync가 manual row를 덮어쓰지 않음", () => {
  const TICKET = "TM-9999";
  const BASE_DATE = new Date("2026-05-20T00:00:00Z");

  test("source=manual인 row → status 보존 + statusHistory 미추가 + candidate 생성", () => {
    const manualRow: ExtendedSchedule = {
      role: "QA",
      person: "강보민",
      start: "2026-04-01",
      end: "2026-04-15",
      status: "진행중",
      source: "manual",
      mergeKey: "TM-9999::QA",
      sourceWeek: "14주차",
      lastSeenAt: "2026-04-01T00:00:00Z",
    };
    const pw = parseWeekly("21주차\n[일정]\nQA: 4/15 완료", TICKET);
    const result = mergeWeeklySync(TICKET, pw, [manualRow], [], BASE_DATE);

    // 1. status는 그대로 (덮어쓰기 차단)
    assert.equal(result.updatedSchedules.length, 1);
    assert.equal(result.updatedSchedules[0].status, "진행중", "manual row status 보존");
    assert.equal(result.updatedSchedules[0].person, "강보민", "manual row person 보존");

    // 2. statusHistory 비어 있어야 함 (sync가 manual row의 history를 만들면 안 됨)
    const sh = result.updatedSchedules[0].statusHistory ?? [];
    assert.equal(sh.length, 0, "manual row statusHistory 미추가");

    // 3. candidate는 생성됨 (운영자가 명시 적용할 수 있도록)
    assert.ok(result.updateCandidates.length > 0,
      `candidate 생성되어야 함 (count=${result.updateCandidates.length})`);
    for (const c of result.updateCandidates) {
      assert.equal(c.autoApply, false, "manual row 대상 candidate는 autoApply=false");
    }

    // 4. trace outcome === "manual_guard"
    const trace = result.mergeTrace?.[0];
    assert.ok(trace);
    assert.equal(trace!.outcome, "manual_guard");
    assert.equal(trace!.matchedRowSource, "manual");
  });

  test("source=jira_weekly인 row → 정상 자동 update (회귀 검증)", () => {
    const legacyRow: ExtendedSchedule = {
      role: "QA",
      person: "",
      start: "2026-04-01",
      end: "2026-04-15",
      status: "진행중",
      source: "jira_weekly",
      sourceWeek: "20주차",
      lastSeenAt: "2026-04-15T00:00:00Z",
    };
    const pw = parseWeekly("21주차\n[일정]\nQA: 4/15 완료", TICKET);
    const result = mergeWeeklySync(TICKET, pw, [legacyRow], [], BASE_DATE);

    // jira_weekly는 자동 적용됨
    assert.equal(result.updatedSchedules[0].status, "완료", "jira_weekly row는 status update");
    assert.equal(result.mergeTrace?.[0].outcome, "updated");
  });
});

describe("P0 최신화 정책", () => {
  const TICKET = "TM-3375";
  const BASE_DATE = new Date("2026-07-28T00:00:00Z");

  test("날짜 없는 완료 신호가 기존 jira_weekly 일정의 날짜를 보존하고 상태만 완료 처리", () => {
    const existing: ExtendedSchedule = {
      role: "BE",
      person: "",
      start: "2026-07-07",
      end: "2026-07-21",
      status: "진행중",
      source: "jira_weekly",
      sourceWeek: "29주차",
      phase: "개발",
      resourceTeam: "BE",
      stableTaskId: "TM-3375::개발::be",
    };
    const parsed = parseWeekly("30주차\n[일정]\nBE: 완료", TICKET);
    const result = mergeWeeklySync(TICKET, parsed, [existing], [], BASE_DATE);

    assert.equal(result.updatedSchedules.length, 1);
    assert.equal(result.updatedSchedules[0].start, "2026-07-07");
    assert.equal(result.updatedSchedules[0].end, "2026-07-21");
    assert.equal(result.updatedSchedules[0].status, "완료");
  });

  test("jira_weekly 행의 시작·종료·상태 변경을 한 번에 자동 적용", () => {
    const existing: ExtendedSchedule = {
      role: "QA",
      person: "",
      start: "2026-08-03",
      end: "2026-08-05",
      status: "예정",
      source: "jira_weekly",
      sourceWeek: "30주차",
      phase: "QA",
      resourceTeam: null,
      stableTaskId: "TM-3375::QA::",
    };
    const parsed = parseWeekly("31주차\n[일정]\nQA: 7/27~7/29 진행중", TICKET);
    const result = mergeWeeklySync(TICKET, parsed, [existing], [], BASE_DATE);

    assert.equal(result.updatedSchedules[0].start, "2026-07-27");
    assert.equal(result.updatedSchedules[0].end, "2026-07-29");
    assert.equal(result.updatedSchedules[0].status, "진행중");
    assert.equal(result.mergeTrace?.[0].outcome, "updated");
    assert.equal(result.updateCandidates.length, 3);
    assert.ok(result.updateCandidates.every(candidate => candidate.autoApply));
    assert.ok(result.updateCandidates.every(candidate => candidate.resolved));
  });

  test("legacy 자동 일정도 다중 변경을 승인 없이 자동 적용", () => {
    const existing: ExtendedSchedule = {
      role: "QA",
      person: "",
      start: "2026-08-03",
      end: "2026-08-05",
      status: "예정",
      source: "legacy",
      sourceWeek: "30주차",
      phase: "QA",
      resourceTeam: null,
      stableTaskId: "TM-3375::QA::",
    };
    const parsed = parseWeekly("31주차\n[일정]\nQA: 7/27~7/29 진행중", TICKET);
    const result = mergeWeeklySync(TICKET, parsed, [existing], [], BASE_DATE);

    assert.equal(result.updatedSchedules[0].start, "2026-07-27");
    assert.equal(result.updatedSchedules[0].end, "2026-07-29");
    assert.equal(result.updatedSchedules[0].status, "진행중");
    assert.equal(result.updateCandidates.length, 3);
    assert.ok(result.updateCandidates.every(candidate => candidate.autoApply));
    assert.ok(result.updateCandidates.every(candidate => candidate.resolved));
  });

  test("다중 기간은 detail이 다른 두 Gantt 행으로 저장", () => {
    const parsed = parseWeekly(
      "28주차\n[일정]\nBE: 7/3~7/7 일정 산정 완료, 7/7~7/21 개발",
      TICKET,
    );
    const result = mergeWeeklySync(TICKET, parsed, [], [], BASE_DATE);

    assert.equal(result.updatedSchedules.length, 2);
    assert.deepEqual(
      result.updatedSchedules.map(row => row.detail),
      ["일정 산정", "실제 개발"],
    );
  });

  test("후속 BE 역할 단위 업데이트는 실제 개발 행을 갱신하고 중복 행을 만들지 않음", () => {
    const week28 = parseWeekly(
      "28주차\n[일정]\nBE: 7/3~7/7 일정 산정 완료, 7/7~7/21 개발",
      TICKET,
    );
    const initial = mergeWeeklySync(TICKET, week28, [], [], BASE_DATE);
    const week29 = parseWeekly(
      "29주차\n[일정]\nBE: 7/7~7/21 진행중",
      TICKET,
    );
    const updated = mergeWeeklySync(
      TICKET,
      week29,
      initial.updatedSchedules,
      [],
      BASE_DATE,
    );

    assert.equal(updated.updatedSchedules.length, 2);
    const actualDevelopment = updated.updatedSchedules.find(row => row.detail === "실제 개발");
    assert.equal(actualDevelopment?.status, "진행중");
    assert.equal(actualDevelopment?.sourceWeek, "29주차");
  });

  test("같은 주차 재파싱에서 제외된 자동 행만 이력화하고 수동 행은 보호", () => {
    const existing: ExtendedSchedule[] = [
      {
        role: "BE", detail: "일정 상세 플래닝", person: "",
        start: "2026-07-10", end: "2026-07-10", status: "예정",
        source: "jira_weekly", sourceWeek: "30주차",
        phase: "개발", resourceTeam: "BE",
        stableTaskId: "TM-3375::개발::be",
      },
      {
        role: "PM 리뷰", person: "",
        start: "2026-07-10", end: "2026-07-10", status: "예정",
        source: "manual", sourceWeek: "30주차",
      },
    ];
    const parsed = parseWeekly([
      "30주차",
      "[일정]",
      "MSS BE: 7/20~7/31 개발 진행중",
    ].join("\n"), TICKET);
    const result = mergeWeeklySync(TICKET, parsed, existing, [], BASE_DATE);

    const archived = result.updatedSchedules.find(row => row.detail === "일정 상세 플래닝");
    const manual = result.updatedSchedules.find(row => row.source === "manual");
    assert.equal(archived?.archiveReason, "parser_reclassified");
    assert.ok(archived?.archivedAt);
    assert.equal(manual?.archivedAt, undefined);
  });
});

// ─── mergeTrace outcome 검증 ─────────────────────────────────

describe("mergeTrace — 각 outcome 분기 정확히 기록", () => {
  const TICKET = "TM-2853";
  const BASE_DATE = new Date("2026-05-20T00:00:00Z");

  test("outcome=appended (신규 row)", () => {
    const pw = parseWeekly("21주차\n[일정]\nO-SKU 통합 QA: 4/27 ~ 5/15 / 진행중", TICKET);
    const result = mergeWeeklySync(TICKET, pw, [], [], BASE_DATE);
    assert.equal(result.mergeTrace?.[0].outcome, "appended");
  });

  test("outcome=updated (기존 row 자동 update)", () => {
    const pw20 = parseWeekly("20주차\n[일정]\nO-SKU 통합 QA: 4/27 ~ 5/15 / 진행중", TICKET);
    const r20 = mergeWeeklySync(TICKET, pw20, [], [], BASE_DATE);

    const pw21 = parseWeekly("21주차\n[일정]\nO-SKU 통합 QA: 5/15 완료", TICKET);
    const r21 = mergeWeeklySync(TICKET, pw21, r20.updatedSchedules, [], BASE_DATE);

    assert.equal(r21.mergeTrace?.[0].outcome, "updated");
    assert.equal(r21.mergeTrace?.[0].statusTransitionAdded, true);
  });

  test("outcome=idempotent (동일 sync 재실행)", () => {
    const pw = parseWeekly("21주차\n[일정]\nO-SKU 통합 QA: 4/27 ~ 5/15 / 진행중", TICKET);
    const r1 = mergeWeeklySync(TICKET, pw, [], [], BASE_DATE);
    const r2 = mergeWeeklySync(TICKET, pw, r1.updatedSchedules, [], BASE_DATE);
    assert.equal(r2.mergeTrace?.[0].outcome, "idempotent");
    assert.equal(r2.isIdempotent, true);
  });

  test("outcome=manual_guard (manual row 대상 — key 매칭됨)", () => {
    // manual row의 stableTaskId가 새 item과 매칭되도록 phase 명시 + role 일치
    const manualRow: ExtendedSchedule = {
      role: "QA", person: "강보민", start: "2026-04-01", end: "2026-04-15",
      status: "진행중", source: "manual", mergeKey: "TM-2853::QA",
      phase: "QA", resourceTeam: null,
    };
    // 같은 stableTaskId(TM-2853::QA::)로 수렴되도록 새 item도 단순 "QA: ..." 표기
    const pw = parseWeekly("21주차\n[일정]\nQA: 5/15 완료", TICKET);
    const result = mergeWeeklySync(TICKET, pw, [manualRow], [], BASE_DATE);
    const traceWithGuard = result.mergeTrace?.find(t => t.outcome === "manual_guard");
    assert.ok(traceWithGuard, `manual_guard outcome 존재해야 함. trace=${JSON.stringify(result.mergeTrace)}`);
    assert.equal(traceWithGuard!.matchedRowSource, "manual");
  });
});

// ─── getRowAllKeys — PUT handler multi-key lookup 보조 ────────

describe("getRowAllKeys — row의 모든 매칭 키 후보", () => {
  test("legacy row(mergeKey=undefined, role='QA') — TM-2853::QA 포함", () => {
    const row: ExtendedSchedule = {
      role: "QA", person: "", start: "", end: "", status: "확인필요",
    };
    const keys = getRowAllKeys("TM-2853", row);
    assert.ok(keys.includes("TM-2853::QA"),
      `expected TM-2853::QA in keys, got: ${JSON.stringify(keys)}`);
  });

  test("신 row (stableTaskId + mergeKey 모두 보유) — primary는 stableTaskId", () => {
    const row: ExtendedSchedule = {
      role: "O SKU 통합", person: "", start: "2026-04-27", end: "2026-05-15",
      status: "완료", mergeKey: "TM-2853::O SKU 통합",
      stableTaskId: "TM-2853::QA::o-sku-통합",
      phase: "QA", resourceTeam: "O SKU 통합",
    };
    const keys = getRowAllKeys("TM-2853", row);
    assert.equal(keys[0], "TM-2853::QA::o-sku-통합");
    assert.ok(keys.includes("TM-2853::O SKU 통합"));
  });

  test("dedupe — 같은 키 중복 없음", () => {
    const row: ExtendedSchedule = {
      role: "QA", person: "", start: "", end: "", status: "확인필요",
      mergeKey: "TM-2853::QA",
    };
    const keys = getRowAllKeys("TM-2853", row);
    const qaCount = keys.filter(k => k === "TM-2853::QA").length;
    assert.equal(qaCount, 1, `TM-2853::QA dedupe되어야 함, got count=${qaCount}`);
  });
});

// ─── getRowKey export (회귀) ────────────────────────────────

describe("getRowKey export — main과 동일 동작", () => {
  test("stableTaskId 있는 row → 그대로 반환", () => {
    const row: ExtendedSchedule = {
      role: "QA", person: "", start: "", end: "", status: "확인필요",
      stableTaskId: "TM-2853::QA::o-sku-통합",
    };
    assert.equal(getRowKey("TM-2853", row), "TM-2853::QA::o-sku-통합");
  });

  test("legacy row → role에서 phase 추론하여 stableTaskId 계산", () => {
    const row: ExtendedSchedule = {
      role: "QA", person: "", start: "", end: "", status: "확인필요",
    };
    const k = getRowKey("TM-2853", row);
    // extractPhaseAndResource("QA") → phase=QA, resourceTeam=null → stableTaskId = "TM-2853::QA::"
    assert.match(k, /^TM-2853::QA::/);
  });
});
