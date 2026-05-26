/**
 * Fixture tests — stable identity + partial update
 *
 * 실행: npx tsx lib/__tests__/weekly-stable-identity.test.ts
 */
import { strict as assert } from "assert";
import { semanticSlug, buildStableTaskId, parseWeekly } from "../weekly-parser";
import { mergeWeeklySync } from "../weekly-merge";
import type { ExtendedSchedule } from "../weekly-merge";

// ─── test harness ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

function group(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

// ─── A. semanticSlug ───────────────────────────────────────────

group("A. semanticSlug", () => {
  test("공백-하이픈 표준화: O-SKU 통합 === O SKU 통합", () => {
    assert.equal(semanticSlug("O-SKU 통합"), semanticSlug("O SKU 통합"));
  });
  test("공백-하이픈 표준화 결과값", () => {
    assert.equal(semanticSlug("O-SKU 통합"), "o-sku-통합");
  });
  test("대소문자 정규화", () => {
    assert.equal(semanticSlug("Core AI BE"), "core-ai-be");
  });
  test("한글 보존", () => {
    assert.equal(semanticSlug("파트너"), "파트너");
  });
  test("특수문자 제거", () => {
    assert.equal(semanticSlug("O-SKU(통합)"), "o-sku통합");
  });
  test("빈 문자열", () => {
    assert.equal(semanticSlug(""), "");
  });
});

// ─── B. buildStableTaskId ─────────────────────────────────────

group("B. buildStableTaskId", () => {
  test("일반 phase — resourceTeam 있음", () => {
    assert.equal(
      buildStableTaskId("TM-2853", "QA", "O-SKU 통합", null),
      "TM-2853::QA::o-sku-통합",
    );
  });

  test("일반 phase — resourceTeam null (단순 QA)", () => {
    assert.equal(
      buildStableTaskId("TM-2853", "QA", null, null),
      "TM-2853::QA::",
    );
  });

  test("milestone — startDate 있으면 date suffix", () => {
    assert.equal(
      buildStableTaskId("TM-2745", "Launch", null, "2026-07-01"),
      "TM-2745::Launch::2026-07-01",
    );
  });

  test("milestone — 다른 날짜는 다른 ID", () => {
    const id1 = buildStableTaskId("TM-2745", "Launch", null, "2026-07-01");
    const id2 = buildStableTaskId("TM-2745", "Launch", null, "2026-07-20");
    assert.notEqual(id1, id2);
  });

  test("milestone — startDate 없으면 slug fallback", () => {
    assert.equal(
      buildStableTaskId("TM-2745", "Launch", "최종 오픈", null),
      "TM-2745::Launch::최종-오픈",
    );
  });

  test("Release milestone", () => {
    assert.equal(
      buildStableTaskId("TM-2853", "Release", null, "2026-05-15"),
      "TM-2853::Release::2026-05-15",
    );
  });

  test("개발 — resourceTeam 변형 표현이 같은 ID", () => {
    const a = buildStableTaskId("TM-2727", "개발", "Core AI BE", null);
    const b = buildStableTaskId("TM-2727", "개발", "Core-AI-BE", null);  // 하이픈 표기
    assert.equal(a, b);
  });
});

// ─── C. parseWeekly → stableTaskId / dateMentioned ───────────

group("C. parseWeekly — stableTaskId & dateMentioned", () => {
  test("범위 표기: dateMentioned.start=true", () => {
    const pw = parseWeekly(
      "21주차\n[일정]\nO-SKU 통합 QA: 4/27 ~ 5/15 / 진행중",
      "TM-2853",
    );
    const item = pw.scheduleItems[0];
    assert.ok(item, "scheduleItem 없음");
    assert.equal(item.dateMentioned?.start, true);
    assert.equal(item.dateMentioned?.end, true);
  });

  test("완료+단일날짜: dateMentioned.start=false (기존 start 보존 signal)", () => {
    const pw = parseWeekly(
      "21주차\n[일정]\nO-SKU 통합 QA: 5/15 완료",
      "TM-2853",
    );
    const item = pw.scheduleItems[0];
    assert.ok(item, "scheduleItem 없음");
    assert.equal(item.dateMentioned?.start, false);
    assert.equal(item.dateMentioned?.end, true);
  });

  test("parseWeekly가 stableTaskId를 항상 포함", () => {
    const pw = parseWeekly(
      "20주차\n[일정]\n파트너 QA: 5/1 ~ 5/10 / 진행중",
      "TM-2727",
    );
    const item = pw.scheduleItems[0];
    assert.ok(item?.stableTaskId, "stableTaskId 없음");
    assert.equal(item.stableTaskId, "TM-2727::QA::파트너");
  });
});

// ─── D. TM-2853: O-SKU 통합 QA 진행중 → 완료 ─────────────────

group("D. TM-2853: 진행중 → 완료 (startDate 보존)", () => {
  const TICKET = "TM-2853";
  const BASE_DATE = new Date("2026-05-20T00:00:00Z");

  // 20주차 initial sync
  const pw20 = parseWeekly(
    "20주차\n[일정]\nO-SKU 통합 QA: 4/27 ~ 5/15 / 진행중",
    TICKET,
  );

  const result20 = mergeWeeklySync(TICKET, pw20, [], [], BASE_DATE);

  test("20주차: row 1개 생성", () => {
    assert.equal(result20.updatedSchedules.length, 1);
  });

  test("20주차: stableTaskId 설정됨", () => {
    assert.equal(result20.updatedSchedules[0].stableTaskId, "TM-2853::QA::o-sku-통합");
  });

  test("20주차: start/end 올바름", () => {
    assert.equal(result20.updatedSchedules[0].start, "2026-04-27");
    assert.equal(result20.updatedSchedules[0].end, "2026-05-15");
  });

  test("20주차: isIdempotent=false (신규)", () => {
    assert.equal(result20.isIdempotent, false);
  });

  // 21주차: 같은 row를 완료 상태로 갱신
  const pw21 = parseWeekly(
    "21주차\n[일정]\nO-SKU 통합 QA: 5/15 완료",
    TICKET,
  );

  const result21 = mergeWeeklySync(
    TICKET, pw21, result20.updatedSchedules, [], BASE_DATE,
  );

  test("21주차: 중복 row 없음 — 여전히 1개", () => {
    assert.equal(result21.updatedSchedules.length, 1);
  });

  test("21주차: startDate 4/27 보존됨", () => {
    assert.equal(result21.updatedSchedules[0].start, "2026-04-27");
  });

  test("21주차: status → 완료", () => {
    assert.equal(result21.updatedSchedules[0].status, "완료");
  });

  test("21주차: statusHistory에 진행중→완료 기록됨", () => {
    const h = result21.updatedSchedules[0].statusHistory ?? [];
    assert.equal(h.length, 1);
    assert.equal(h[0].from, "진행중");
    assert.equal(h[0].to, "완료");
    assert.equal(h[0].sourceWeek, "21주차");
  });

  test("21주차: endDate=5/15 유지", () => {
    assert.equal(result21.updatedSchedules[0].end, "2026-05-15");
  });

  // 21주차 두 번째 sync — idempotent
  const result21b = mergeWeeklySync(
    TICKET, pw21, result21.updatedSchedules, [], BASE_DATE,
  );

  test("21주차 재sync: isIdempotent=true", () => {
    assert.equal(result21b.isIdempotent, true);
  });

  test("21주차 재sync: statusHistory 길이 유지됨 (중복 추가 없음)", () => {
    assert.equal(result21b.updatedSchedules[0].statusHistory?.length ?? 0, 1);
  });
});

// ─── E. TM-2745: Launch 7/1, Launch 7/20 별도 row ────────────

group("E. TM-2745: milestone — 날짜 다르면 별도 row", () => {
  const TICKET = "TM-2745";
  const BASE_DATE = new Date("2026-05-20T00:00:00Z");

  const pw = parseWeekly(
    "21주차\n[일정]\nLaunch: 2026-07-01 / 예정\nLaunch: 2026-07-20 / 예정",
    TICKET,
  );

  const result = mergeWeeklySync(TICKET, pw, [], [], BASE_DATE);

  test("Launch 7/1, 7/20 → 2개 별도 row", () => {
    assert.equal(result.updatedSchedules.length, 2);
  });

  test("Launch 7/1 stableTaskId", () => {
    const row = result.updatedSchedules.find(r => r.start === "2026-07-01");
    assert.ok(row, "7/1 row 없음");
    assert.equal(row.stableTaskId, "TM-2745::Launch::2026-07-01");
  });

  test("Launch 7/20 stableTaskId", () => {
    const row = result.updatedSchedules.find(r => r.start === "2026-07-20");
    assert.ok(row, "7/20 row 없음");
    assert.equal(row.stableTaskId, "TM-2745::Launch::2026-07-20");
  });

  // 22주차: Launch 7/1 완료 처리 — 7/20은 그대로
  const pw22 = parseWeekly(
    "22주차\n[일정]\nLaunch: 2026-07-01 완료\nLaunch: 2026-07-20 / 예정",
    TICKET,
  );

  const result22 = mergeWeeklySync(TICKET, pw22, result.updatedSchedules, [], BASE_DATE);

  test("22주차: 여전히 2개 row (추가 없음)", () => {
    assert.equal(result22.updatedSchedules.length, 2);
  });

  test("22주차: Launch 7/1 → 완료로 업데이트", () => {
    const row = result22.updatedSchedules.find(r => r.start === "2026-07-01");
    assert.equal(row?.status, "완료");
  });

  test("22주차: Launch 7/20 → 예정 유지", () => {
    const row = result22.updatedSchedules.find(r => r.start === "2026-07-20");
    assert.equal(row?.status, "예정");
  });
});

// ─── F. TM-2727: QA 파트너/유저단/통합 stableTaskId 분리 ───────

group("F. TM-2727: QA 세부 작업 분리", () => {
  const TICKET = "TM-2727";
  const BASE_DATE = new Date("2026-05-20T00:00:00Z");

  const pw = parseWeekly(
    "20주차\n[일정]\n파트너 QA: 5/1 ~ 5/10 / 진행중\n유저단 QA: 5/5 ~ 5/15 / 진행중\n통합 QA: 5/15 ~ 5/20 / 예정",
    TICKET,
  );

  const result = mergeWeeklySync(TICKET, pw, [], [], BASE_DATE);

  test("3개 QA 작업 → 3개 row", () => {
    assert.equal(result.updatedSchedules.length, 3);
  });

  test("파트너 QA stableTaskId", () => {
    const row = result.updatedSchedules.find(r => r.stableTaskId === "TM-2727::QA::파트너");
    assert.ok(row, "파트너 QA row 없음");
    assert.equal(row.start, "2026-05-01");
  });

  test("유저단 QA stableTaskId", () => {
    const row = result.updatedSchedules.find(r => r.stableTaskId === "TM-2727::QA::유저단");
    assert.ok(row, "유저단 QA row 없음");
  });

  test("통합 QA stableTaskId", () => {
    const row = result.updatedSchedules.find(r => r.stableTaskId === "TM-2727::QA::통합");
    assert.ok(row, "통합 QA row 없음");
  });

  test("stableTaskId 3개 모두 다름", () => {
    const ids = new Set(result.updatedSchedules.map(r => r.stableTaskId));
    assert.equal(ids.size, 3);
  });

  // 21주차: 파트너 QA 완료, 유저단/통합은 계속
  const pw21 = parseWeekly(
    "21주차\n[일정]\n파트너 QA: 5/10 완료\n유저단 QA: 5/15 완료\n통합 QA: 5/15 ~ 5/20 / 진행중",
    TICKET,
  );

  const result21 = mergeWeeklySync(TICKET, pw21, result.updatedSchedules, [], BASE_DATE);

  test("21주차: 여전히 3개 row (추가 없음)", () => {
    assert.equal(result21.updatedSchedules.length, 3);
  });

  test("21주차: 파트너 QA start 5/1 보존됨", () => {
    const row = result21.updatedSchedules.find(r => r.stableTaskId === "TM-2727::QA::파트너");
    assert.equal(row?.start, "2026-05-01");
    assert.equal(row?.status, "완료");
  });

  test("21주차: 통합 QA → 진행중으로 변경됨", () => {
    const row = result21.updatedSchedules.find(r => r.stableTaskId === "TM-2727::QA::통합");
    assert.equal(row?.status, "진행중");
  });
});

// ─── G. Backward compat: phase 없는 기존 row ──────────────────

group("G. Backward compat: phase 없는 legacy row", () => {
  const TICKET = "TM-9999";
  const BASE_DATE = new Date("2026-05-20T00:00:00Z");

  // phase 필드 없는 레거시 row (구버전 cc-schedules 데이터)
  const legacyRow: ExtendedSchedule = {
    role: "QA",
    person: "",
    start: "2026-04-01",
    end: "2026-04-15",
    status: "진행중",
    mergeKey: "TM-9999::QA",
    // 원래 이 fixture는 "phase 없는 legacy row" 의도 — source는 'legacy'가 의미적으로 정확.
    // (이전 PR에서 'manual'로 작성됐으나 weekly-sync auto-update 흐름을 검증하므로 legacy가 맞음.
    //  새로 추가된 manual-guard 정책상 source='manual'은 자동 update 차단 대상이라
    //  legacy auto-update 시나리오와는 별도 case로 분리.)
    source: "legacy",
    sourceWeek: "14주차",
    lastSeenAt: "2026-04-01T00:00:00Z",
    firstSeenAt: "2026-04-01T00:00:00Z",
  };

  const pw = parseWeekly(
    "21주차\n[일정]\nQA: 4/15 완료",
    TICKET,
  );

  const result = mergeWeeklySync(TICKET, pw, [legacyRow], [], BASE_DATE);

  test("legacy row: 중복 없이 1개 유지", () => {
    assert.equal(result.updatedSchedules.length, 1);
  });

  test("legacy row: start 보존 (partial update)", () => {
    assert.equal(result.updatedSchedules[0].start, "2026-04-01");
  });

  test("legacy row: status → 완료", () => {
    assert.equal(result.updatedSchedules[0].status, "완료");
  });

  test("legacy row: stableTaskId backfill됨", () => {
    assert.ok(result.updatedSchedules[0].stableTaskId, "stableTaskId 없음");
  });
});

// ─── 결과 출력 ──────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${"─".repeat(50)}\n`);

if (failed > 0) process.exit(1);
