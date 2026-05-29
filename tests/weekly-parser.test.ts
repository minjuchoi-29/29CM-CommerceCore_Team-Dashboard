/**
 * weekly-parser.ts unit tests (production-grade migration regression check).
 *
 * Validates against fixture (TM-2727 / TM-2756 / TM-2853 실제 JIRA cf_10625 snapshot):
 *
 *   1. AST 통합 후에도 기존 운영 contract(ParsedWeekly schema)가 그대로 유지된다.
 *   2. parseScheduleLineWithCtx의 Hybrid 정책(Option D) — milestone은 line semantic 우선,
 *      그 외는 parent inheritance 우선 — 이 정확히 동작.
 *   3. TM-2727 QA inheritance: 자식 4건 모두 phase=QA로 추정되어야 함 (schedule 자격은
 *      별개 — 기존 status 검증 정책에 따라 일부는 candidate 박탈됨, 회귀 아님).
 *   4. TM-2756 기획/디자인/개발 phase 추정 정상.
 *   5. TM-2853 partial update foundation: QA + Launch candidate가 정확히 추출.
 *
 * 정책 노트:
 *   - "CEE 피처플래그 적용 배포" (parent='잔여 개발 사항'=개발, line='배포'=Release)
 *     → milestone 우선 → phase=Release, phaseSource=lineBody.
 *     이게 운영 의도(배포 activity는 어디 있어도 Release lane).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseWeekly,
  parseScheduleLineWithCtx,
  resolvePhaseWithContext,
  classifyLineWithCtx,
  MILESTONE_PHASES,
} from "../lib/weekly-parser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function loadText(key: string): string {
  return readFileSync(join(FIXTURES, `${key}.cf_10625.text.txt`), "utf-8");
}

// ─── resolvePhaseWithContext — Hybrid policy unit ────────────

describe("resolvePhaseWithContext (Hybrid policy / Option D)", () => {
  test("milestone phase from lineBody overrides parent (CEE 피처플래그 case)", () => {
    const r = resolvePhaseWithContext(
      "",                                  // roleRaw 없음
      "2026-05-20 CEE 피처플래그 적용 배포",
      "개발",                              // parent=개발
    );
    assert.equal(r.phase, "Release");
    assert.equal(r.phaseSource, "lineBody");
  });

  test("non-milestone phase from lineBody is overridden by parent (parent inheritance)", () => {
    const r = resolvePhaseWithContext(
      "",
      "2026-05-18 테스트브리프 진행",      // "테스트" → QA(non-milestone)
      "QA",
    );
    assert.equal(r.phase, "QA");
    assert.equal(r.phaseSource, "parentInheritance");
  });

  test("roleRaw + non-milestone + parent → parent wins", () => {
    const r = resolvePhaseWithContext(
      "QA",   // roleRaw=QA (non-milestone)
      "QA: 5/19 ...",
      "QA",   // parent=QA (같은 phase여도 정책상 parent 우선이 기록됨)
    );
    assert.equal(r.phase, "QA");
    assert.equal(r.phaseSource, "parentInheritance");
  });

  test("roleRaw milestone + parent → roleRaw wins", () => {
    const r = resolvePhaseWithContext(
      "Release",          // roleRaw=Release (milestone)
      "Release: 5/20 ...",
      "개발",
    );
    assert.equal(r.phase, "Release");
    assert.equal(r.phaseSource, "roleRaw");
  });

  test("no parent + no line match + no role match → 기타", () => {
    const r = resolvePhaseWithContext("", "5/19 작업 진행", undefined);
    assert.equal(r.phase, "기타");
  });

  test("no parent + non-milestone roleRaw → roleRaw wins (no inheritance to override)", () => {
    const r = resolvePhaseWithContext(
      "기획",
      "기획 : 5/21 리뷰 예정",
      undefined,
    );
    assert.equal(r.phase, "기획");
    assert.equal(r.phaseSource, "roleRaw");
  });

  test("MILESTONE_PHASES set is exactly Release/Launch/Kick-Off", () => {
    assert.equal(MILESTONE_PHASES.has("Release"), true);
    assert.equal(MILESTONE_PHASES.has("Launch"), true);
    assert.equal(MILESTONE_PHASES.has("Kick-Off"), true);
    assert.equal(MILESTONE_PHASES.has("QA"), false);
    assert.equal(MILESTONE_PHASES.has("개발"), false);
  });
});

// ─── parseScheduleLineWithCtx — context awareness ────────────

describe("parseScheduleLineWithCtx", () => {
  test("inherits parent phase when self-match fails", () => {
    const item = parseScheduleLineWithCtx(
      "2026-05-18 테스트브리프 진행",
      { parentPhase: "QA", parentText: "QA" },
    );
    assert.ok(item);
    assert.equal(item!.phase, "QA");
    assert.equal(item!.phaseSource, "parentInheritance");
    assert.equal(item!.inheritedFromParentText, "QA");
  });

  test("milestone line takes precedence over parent (Release wins over 개발 parent)", () => {
    const item = parseScheduleLineWithCtx(
      "2026-05-20 CEE 피처플래그 적용 배포",
      { parentPhase: "개발", parentText: "잔여 개발 사항" },
    );
    assert.ok(item);
    assert.equal(item!.phase, "Release");
    assert.equal(item!.phaseSource, "lineBody");
    assert.equal(item!.startDate, "2026-05-20");
  });

  test("backward compat — ctx undefined behaves like classic parseScheduleLine", () => {
    const item = parseScheduleLineWithCtx("기획 : 5/21(목) 리뷰 예정", undefined);
    assert.ok(item);
    assert.equal(item!.phase, "기획");
    assert.equal(item!.phaseSource, "roleRaw");
    assert.equal(item!.startDate, `${new Date().getFullYear()}-05-21`);
  });
});

// ─── parseWeekly — full integration (fixture) ────────────────

describe("parseWeekly — TM-2853 (section markers <진행상황>/<일정>)", () => {
  const result = parseWeekly(loadText("TM-2853"), "TM-2853");

  test("hasAnyMarker = true; progress + schedule sections detected", () => {
    const debug = result.debug as Record<string, unknown>;
    assert.equal(debug.hasAnyMarker, true);
    assert.deepEqual(result.debug?.sectionsFound, ["progress", "schedule"]);
  });

  test("scheduleItems: 2 candidates (QA + Launch)", () => {
    assert.equal(result.scheduleItems.length, 2);
    const qa = result.scheduleItems.find(s => s.phase === "QA");
    const launch = result.scheduleItems.find(s => s.phase === "Launch");
    assert.ok(qa, "QA candidate present");
    assert.ok(launch, "Launch candidate present");
    assert.equal(qa!.startDate, "2026-05-15");
    assert.equal(qa!.status, "완료");
    assert.equal(qa!.resourceTeam, "O SKU 통합");
    assert.equal(launch!.startDate, "2026-05-20");
    assert.equal(launch!.status, "예정");
  });

  test("phaseSource records explainability metadata", () => {
    for (const s of result.scheduleItems) {
      assert.ok(s.phaseSource, "every schedule item has phaseSource");
    }
  });
});

describe("parseWeekly — TM-2727 (nested QA bulletList, no section markers)", () => {
  const result = parseWeekly(loadText("TM-2727"), "TM-2727");

  test("hasAnyMarker = false (cf_10625 has no [일정]/<진행상황> markers)", () => {
    const debug = result.debug as Record<string, unknown>;
    assert.equal(debug.hasAnyMarker, false);
  });

  test("classifiedLines contains all 4 QA children with phase=QA via inheritance", () => {
    // classifyLineWithCtx 결과는 ParsedWeekly.classifiedLines에 저장됨 (no-marker fallback path).
    // 각 QA 자식의 schedule(parsed) 안의 phase가 QA여야 함 (schedule candidate 자격과 무관).
    const qaChildren = result.classifiedLines!.filter(c =>
      c.content.includes("테스트브리프") ||
      c.content.includes("파트너 어드민 QA") ||
      c.content.includes("유저단 QA") ||
      c.content.includes("통합 QA"),
    );
    assert.equal(qaChildren.length, 4, `expected 4 QA children, got ${qaChildren.length}`);
    for (const c of qaChildren) {
      assert.ok(c.schedule, `QA child "${c.content.slice(0, 30)}" has schedule meta`);
      assert.equal(c.schedule!.phase, "QA",
        `QA child should have phase=QA, got ${c.schedule!.phase} for "${c.content.slice(0, 40)}"`);
    }
  });

  test("CEE 피처플래그 적용 배포 → phase=Release via lineBody (milestone wins)", () => {
    const cee = result.classifiedLines!.find(c => c.content.includes("CEE 피처플래그"));
    assert.ok(cee);
    assert.ok(cee!.schedule);
    assert.equal(cee!.schedule!.phase, "Release");
    assert.equal(cee!.schedule!.phaseSource, "lineBody");
  });

  test("scheduleItems contains the Release candidates from the tree", () => {
    // 기존 운영 status-executable 검증 정책 유지 — Release line은 "배포 완료"/"sign-off 후 배포 목표"
    // 등으로 통과하므로 schedule candidate에 포함되어야 함.
    const releases = result.scheduleItems.filter(s => s.phase === "Release");
    assert.ok(releases.length >= 2, `expected >=2 Release candidates, got ${releases.length}`);
  });

  test("phaseSource counts include both lineBody and parentInheritance", () => {
    const debug = result.debug as Record<string, unknown>;
    const counts = debug.phaseSourceCounts as Record<string, number>;
    assert.ok(counts.lineBody && counts.lineBody > 0, "should have lineBody source");
    // 운영 정책상 status가 없는 QA 자식은 schedule 박탈되어 scheduleItems에 안 들어감 (회귀 아님).
    // 단, 유저단 QA(완료)는 status 매칭 → schedule candidate로 들어가며 parentInheritance.
    assert.ok(counts.parentInheritance && counts.parentInheritance > 0, "should have parentInheritance source");
  });
});

describe("parseWeekly — TM-2756 (flat paragraphs, role-prefixed lines)", () => {
  const result = parseWeekly(loadText("TM-2756"), "TM-2756");

  test("scheduleItems contains 기획 line", () => {
    const planning = result.scheduleItems.find(s => s.phase === "기획");
    assert.ok(planning, "기획 schedule candidate present");
    assert.equal(planning!.phaseSource, "roleRaw");
    assert.equal(planning!.status, "예정");
    assert.ok(planning!.startDate);
  });

  test("디자인 line classified but NOT in scheduleItems (no date, 확인필요 status)", () => {
    // 디자인 : CBP, 29CM 일정 확인 필요 → date 없음 → schedule 박탈
    const designSched = result.scheduleItems.find(s => s.phase === "디자인");
    assert.equal(designSched, undefined, "디자인 should NOT be in scheduleItems (no date)");
    // classifyLineWithCtx로는 처리되어 nextActions 또는 note로 분류됨
    const designAction = result.nextActions.find(a => a.content.includes("디자인"));
    assert.ok(designAction, "디자인 line should be classified as action");
  });

  test("개발 line classified but NOT in scheduleItems", () => {
    const devSched = result.scheduleItems.find(s => s.phase === "개발");
    assert.equal(devSched, undefined, "개발 should NOT be in scheduleItems (no date)");
  });

  test("PTG plan paragraph is NOT lifted to schedule (non_schedule_indicator policy)", () => {
    // PTG plan은 NON_SCHEDULE_INDICATORS 매칭으로 note 처리됨 → scheduleItems에 없음
    const ptg = result.scheduleItems.find(s => s.rawText.includes("PTG plan"));
    assert.equal(ptg, undefined);
  });
});

// ─── ParsedWeekly schema regression ──────────────────────────

describe("ParsedWeekly schema (regression check — output contract maintained)", () => {
  test("all 3 fixtures return objects with required fields", () => {
    for (const k of ["TM-2727", "TM-2756", "TM-2853"]) {
      const r = parseWeekly(loadText(k), k);
      assert.equal(r.ticketKey, k);
      assert.equal(typeof r.sourceWeek, "string");
      assert.equal(typeof r.sourceText, "string");
      assert.equal(typeof r.parsedAt, "string");
      assert.ok(Array.isArray(r.progressItems));
      assert.ok(Array.isArray(r.scheduleItems));
      assert.ok(Array.isArray(r.risks));
      assert.ok(Array.isArray(r.nextActions));
      assert.equal(typeof r.noIssues, "boolean");
      assert.ok(r.debug);
      assert.ok(Array.isArray(r.debug.sectionsFound));
      assert.ok(Array.isArray(r.debug.ignoredLines));
      assert.ok(Array.isArray(r.debug.warnings));
    }
  });

  test("debug.astTree included as string (new field, backward-compat ok)", () => {
    for (const k of ["TM-2727", "TM-2756", "TM-2853"]) {
      const r = parseWeekly(loadText(k), k);
      const debug = r.debug as Record<string, unknown>;
      assert.equal(typeof debug.astTree, "string");
      assert.ok((debug.astTree as string).length > 0);
    }
  });
});

// ─── classifyLineWithCtx — direct unit ───────────────────────

describe("classifyLineWithCtx", () => {
  test("inherits parent QA phase when child line has no own match (date but no status)", () => {
    const cls = classifyLineWithCtx(
      "2026-05-19 파트너 어드민 QA",
      { parentPhase: "QA", parentText: "QA" },
    );
    // 신규 정책: 날짜가 있고 status keyword가 없으면 status="예정" 기본값 적용 → schedule 분류 (Bug 1,2 fix)
    assert.equal(cls.type, "schedule", "날짜 있는 라인은 status 없어도 schedule로 분류");
    assert.ok(cls.schedule, "schedule meta 존재");
    assert.equal(cls.schedule!.phase, "QA");
    assert.equal(cls.schedule!.phaseSource, "parentInheritance");
    assert.equal(cls.schedule!.inheritedFromParentText, "QA");
    assert.equal(cls.schedule!.startDate, "2026-05-19");
    assert.equal(cls.schedule!.status, "예정", "status 기본값 예정");
  });

  test("nonSchedule indicator → no schedule meta (PTG plan case)", () => {
    const cls = classifyLineWithCtx(
      "PTG plan : 기획 리뷰 완료 및 ...",
      { parentPhase: undefined, parentText: undefined },
    );
    assert.equal(cls.type, "note");
    // non_schedule_indicator 매칭이면 parseScheduleLineWithCtx를 호출하지 않으므로 schedule undefined
    assert.equal(cls.schedule, undefined);
  });
});
