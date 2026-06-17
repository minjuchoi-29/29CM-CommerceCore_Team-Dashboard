/**
 * Parser Coverage v1.1 (2026-06-17) — no-marker fallback 의 para 처리.
 *
 * 회귀 보호 대상:
 *   - TM-2745 / TM-2756 / TM-2746 의 실제 운영 패턴 reproduction
 *     (Automation Bot comment 가 ADF paragraph 형식인 경우 — bullet 없음)
 *   - STATUS_KEYWORDS 보강: 개발중 / QA중 / 디자인중 / 기획중 / 준비중
 *   - SECTION_ALIASES 보강: 주요 일정 / 이번주 일정 / 금주 일정
 *
 * 기존 동작 회귀 보호:
 *   - bullet item 형식 ("- 6/8 개발") 은 그대로 동작
 *   - [일정] / [진행상황] marker 형식은 그대로 동작
 *   - 헤더성 line 은 schedule 로 잘못 분류되지 않음
 *   - 빈 입력 안전
 *
 * 이 테스트는 lib/weekly-parser.ts 의 parseWeekly() 통합 동작을 검증.
 * STATUS_KEYWORDS / SECTION_ALIASES / no-marker fallback 의 3 변경점을 cross-cover.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseWeekly } from "../lib/weekly-parser";

describe("TM-2745 reproduction — para-only 위클리, line 별 단일 일정", () => {
  const text =
    "24주차 Weekly 공유사항\n"
    + "6/8~ 개발중\n"
    + "6/22~7/5 QA\n"
    + "7/6~ CBT 진행\n"
    + "7/20 대고객 오픈";

  const result = parseWeekly(text, "TM-2745");

  it("scheduleItems 가 3건 생성됨 (개발 / QA / Launch)", () => {
    assert.equal(result.scheduleItems.length, 3,
      `예상 3건. 실제 ${result.scheduleItems.length}건. items=${JSON.stringify(result.scheduleItems.map(s => ({ phase: s.phase, start: s.startDate, status: s.status })))}`);
  });

  it("[0] '6/8~ 개발중' → phase=개발, start=2026-06-08, status=진행중 (STATUS_KEYWORDS v1.1)", () => {
    const item = result.scheduleItems[0];
    assert.equal(item.phase, "개발");
    assert.equal(item.startDate, "2026-06-08");
    assert.equal(item.status, "진행중", "v1.1: '개발중' → 진행중 매핑");
  });

  it("[1] '6/22~7/5 QA' → phase=QA, range", () => {
    const item = result.scheduleItems[1];
    assert.equal(item.phase, "QA");
    assert.equal(item.startDate, "2026-06-22");
    assert.equal(item.endDate, "2026-07-05");
  });

  it("[2] '7/20 대고객 오픈' → phase=Launch (milestone)", () => {
    const item = result.scheduleItems[2];
    assert.equal(item.phase, "Launch");
    assert.equal(item.startDate, "2026-07-20");
  });

  it("'7/6~ CBT 진행' 은 schedule 미생성 — phase=기타 (CBT 미등록)", () => {
    const cbtSchedule = result.scheduleItems.find(s => s.rawText?.includes("CBT"));
    assert.equal(cbtSchedule, undefined, "CBT line 은 ALLOWED_PHASES 미포함으로 schedule 자격 박탈");
    const cbtClassified = result.classifiedLines?.find(c => c.rawText.includes("CBT"));
    assert.ok(cbtClassified, "classifiedLines 에는 기록됨 (선택적 분류 가시화)");
  });

  it("sourceWeek = '24주차'", () => {
    assert.equal(result.sourceWeek, "24주차");
  });

  it("warnings 에 no_section_marker 명시 — no-marker fallback 진입 확인", () => {
    const hasFallbackWarning = (result.debug?.warnings ?? []).some(w => w.includes("no_section_marker"));
    assert.ok(hasFallbackWarning);
  });
});

describe("TM-2756 reproduction — para-only 위클리, line 별 분리", () => {
  const text =
    "24주차 Weekly 공유사항\n"
    + "6/10 개발 착수\n"
    + "8/3 QA 착수\n"
    + "8/27 런칭";

  const result = parseWeekly(text, "TM-2756");

  it("scheduleItems 3건 (개발 / QA / Launch)", () => {
    assert.equal(result.scheduleItems.length, 3);
  });

  it("'6/10 개발 착수' → phase=개발, status=진행중 (착수)", () => {
    const item = result.scheduleItems[0];
    assert.equal(item.phase, "개발");
    assert.equal(item.startDate, "2026-06-10");
    assert.equal(item.status, "진행중");
  });

  it("'8/3 QA 착수' → phase=QA, status=진행중", () => {
    const item = result.scheduleItems[1];
    assert.equal(item.phase, "QA");
    assert.equal(item.startDate, "2026-08-03");
    assert.equal(item.status, "진행중");
  });

  it("'8/27 런칭' → phase=Launch", () => {
    const item = result.scheduleItems[2];
    assert.equal(item.phase, "Launch");
    assert.equal(item.startDate, "2026-08-27");
  });
});

describe("TM-2746 reproduction — para-only 위클리, range + Launch", () => {
  const text =
    "24주차 Weekly 공유사항\n"
    + "6/9 자체 QA\n"
    + "6/15~6/28 QA팀 QA\n"
    + "6/29 대고객 런칭";

  const result = parseWeekly(text, "TM-2746");

  it("scheduleItems 3건 (QA / QA / Launch)", () => {
    assert.equal(result.scheduleItems.length, 3);
  });

  it("'6/9 자체 QA' → phase=QA, resourceTeam='자체'", () => {
    const item = result.scheduleItems[0];
    assert.equal(item.phase, "QA");
    assert.equal(item.resourceTeam, "자체");
    assert.equal(item.startDate, "2026-06-09");
  });

  it("'6/15~6/28 QA팀 QA' → phase=QA, range", () => {
    const item = result.scheduleItems[1];
    assert.equal(item.phase, "QA");
    assert.equal(item.startDate, "2026-06-15");
    assert.equal(item.endDate, "2026-06-28");
  });

  it("'6/29 대고객 런칭' → phase=Launch", () => {
    const item = result.scheduleItems[2];
    assert.equal(item.phase, "Launch");
    assert.equal(item.startDate, "2026-06-29");
  });
});

describe("STATUS_KEYWORDS v1.1 — phase+ing 결합 키워드 normalize", () => {
  it("'6/8 개발중' → status=진행중", () => {
    const r = parseWeekly("6/8 개발중", "T-1");
    assert.equal(r.scheduleItems.length, 1);
    assert.equal(r.scheduleItems[0].status, "진행중");
  });

  it("'6/22 QA중' → status=진행중", () => {
    const r = parseWeekly("6/22 QA중", "T-1");
    assert.equal(r.scheduleItems.length, 1);
    assert.equal(r.scheduleItems[0].status, "진행중");
    assert.equal(r.scheduleItems[0].phase, "QA");
  });

  it("'6/10 디자인중' → status=진행중", () => {
    const r = parseWeekly("6/10 디자인중", "T-1");
    assert.equal(r.scheduleItems.length, 1);
    assert.equal(r.scheduleItems[0].status, "진행중");
    assert.equal(r.scheduleItems[0].phase, "디자인");
  });

  it("'6/5 기획중' → status=진행중", () => {
    const r = parseWeekly("6/5 기획중", "T-1");
    assert.equal(r.scheduleItems.length, 1);
    assert.equal(r.scheduleItems[0].status, "진행중");
    assert.equal(r.scheduleItems[0].phase, "기획");
  });

  it("'6/15 기획 준비중' → status=예정 (준비 단계)", () => {
    const r = parseWeekly("6/15 기획 준비중", "T-1");
    assert.equal(r.scheduleItems.length, 1);
    assert.equal(r.scheduleItems[0].status, "예정", "v1.1: '준비중' → 예정");
    assert.equal(r.scheduleItems[0].phase, "기획");
  });

  it("기존 '진행중' / '완료' / '예정' 매핑 회귀 보호", () => {
    assert.equal(parseWeekly("6/8 개발 진행중", "T-1").scheduleItems[0].status, "진행중");
    assert.equal(parseWeekly("6/8 개발 완료", "T-1").scheduleItems[0].status, "완료");
    assert.equal(parseWeekly("6/8 개발 예정", "T-1").scheduleItems[0].status, "예정");
  });
});

describe("SECTION_ALIASES v1.1 — schedule alias 추가", () => {
  it("'주요 일정' marker 인식 → schedule section path 진입", () => {
    const text =
      "21주차 Weekly 공유사항\n"
      + "주요 일정\n"
      + "- 6/8 개발\n"
      + "- 6/15 QA";
    const r = parseWeekly(text, "T-1");
    assert.equal(r.scheduleItems.length, 2);
    assert.ok((r.debug?.sectionsFound ?? []).includes("schedule"));
  });

  it("'이번주 일정' marker 인식", () => {
    const text =
      "이번주 일정\n"
      + "- 6/8 개발\n"
      + "- 6/15 QA";
    const r = parseWeekly(text, "T-1");
    assert.equal(r.scheduleItems.length, 2);
  });

  it("'금주 일정' marker 인식", () => {
    const text =
      "금주 일정\n"
      + "- 6/8 개발";
    const r = parseWeekly(text, "T-1");
    assert.equal(r.scheduleItems.length, 1);
  });

  it("'[주요 일정]' bracket 형식 도 인식 (normalizeForMarkerMatch 가 bracket strip)", () => {
    const text =
      "[주요 일정]\n"
      + "- 6/8 개발";
    const r = parseWeekly(text, "T-1");
    assert.equal(r.scheduleItems.length, 1);
  });
});

describe("회귀 보호 — 기존 형식 무변경", () => {
  it("bullet item 형식 '- 6/8 개발 진행중' 은 그대로 동작", () => {
    const text =
      "21주차 Weekly 공유사항\n"
      + "- 6/8 개발 진행중\n"
      + "- 6/15 QA 예정\n"
      + "- 6/29 런칭";
    const r = parseWeekly(text, "T-1");
    assert.equal(r.scheduleItems.length, 3);
  });

  it("[일정] marker 형식은 본 fix 분기 미진입 — 기존 sections.schedule path", () => {
    const text =
      "21주차 Weekly 공유사항\n"
      + "\n"
      + "[일정]\n"
      + "- 6/8 개발\n"
      + "- 6/15 QA";
    const r = parseWeekly(text, "T-1");
    assert.equal(r.scheduleItems.length, 2);
    assert.ok((r.debug?.sectionsFound ?? []).includes("schedule"));
    // no_section_marker warning 없음 — hasAnyMarker=true 분기
    const hasFallbackWarning = (r.debug?.warnings ?? []).some(w => w.includes("no_section_marker"));
    assert.equal(hasFallbackWarning, false);
  });

  it("헤더성 para ('24주차 Weekly 공유사항') 는 schedule 로 잘못 분류되지 않음", () => {
    const text = "24주차 Weekly 공유사항";
    const r = parseWeekly(text, "T-1");
    assert.equal(r.scheduleItems.length, 0);
  });

  it("일반 메모 para ('논의 후 결정 예정') 는 schedule 미생성", () => {
    const text = "논의 후 결정 예정";
    const r = parseWeekly(text, "T-1");
    assert.equal(r.scheduleItems.length, 0);
  });

  it("date 없는 phase line ('개발 진행중') 는 schedule 미생성", () => {
    const r = parseWeekly("개발 진행중", "T-1");
    assert.equal(r.scheduleItems.length, 0);
  });

  it("빈 입력 안전", () => {
    const r = parseWeekly("", "T-1");
    assert.equal(r.scheduleItems.length, 0);
  });

  it("Weekly 공유사항 한 줄만 있는 경우 안전", () => {
    const r = parseWeekly("Weekly 공유사항", "T-1");
    assert.equal(r.scheduleItems.length, 0);
  });
});

describe("PR #48 trace UI 데이터 일관성 — appended outcome 확인용 메타", () => {
  it("para 처리된 scheduleItem 에 stableTaskId 가 부착됨 (mergeWeeklySync 진입 자격)", () => {
    const text =
      "24주차 Weekly 공유사항\n"
      + "6/8 개발 진행중\n"
      + "6/29 런칭";
    const r = parseWeekly(text, "TM-X");
    assert.equal(r.scheduleItems.length, 2);
    for (const item of r.scheduleItems) {
      assert.ok(item.stableTaskId, `stableTaskId 부착 필수 (mergeWeeklySync 의 scheduleMap key) — phase=${item.phase}`);
      assert.ok(item.stableTaskId.startsWith("TM-X::"), `ticketKey prefix 정상 — ${item.stableTaskId}`);
    }
  });

  it("milestone phase (Launch) 의 stableTaskId 는 startDate 가 suffix", () => {
    const text = "6/29 런칭";
    const r = parseWeekly(text, "TM-X");
    assert.equal(r.scheduleItems[0].phase, "Launch");
    assert.ok(r.scheduleItems[0].stableTaskId?.includes("2026-06-29"),
      `milestone stableTaskId 는 date suffix — ${r.scheduleItems[0].stableTaskId}`);
  });
});
