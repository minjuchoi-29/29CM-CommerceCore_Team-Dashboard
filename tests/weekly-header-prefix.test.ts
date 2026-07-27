/**
 * WEEKLY_HEADER_RE — description 안의 "Weekly 공유사항" 헤더 인식.
 *
 * production source helper를 직접 검증하여 route와 테스트의 drift를 막는다.
 *
 * 보호 invariants:
 *  - 기존 매칭 케이스 모두 보존 (numeric prefix / 무 prefix / 장식 chars)
 *  - v6.1 신규 prefix: "이번주" / "금주" / "this week" / "current week"
 *  - "이번주의" 처럼 prefix 뒤 조사 붙은 경우는 미매치 (모호 회피)
 *  - 본문 중간 등장은 line-start 가 아니라 미매치
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  WEEKLY_HEADER_RE,
  extractLatestWeeklySection,
} from "../lib/weekly-source";

describe("WEEKLY_HEADER_RE — 기존 매칭 케이스 (v6.1 회귀 보호)", () => {
  it("'Weekly 공유사항' (prefix 없음) 매치", () => {
    assert.ok(WEEKLY_HEADER_RE.test("Weekly 공유사항"));
  });

  it("'21주차 Weekly 공유사항' 매치", () => {
    assert.ok(WEEKLY_HEADER_RE.test("21주차 Weekly 공유사항"));
  });

  it("'24주차 Weekly 공유사항' (다른 주차) 매치", () => {
    assert.ok(WEEKLY_HEADER_RE.test("24주차 Weekly 공유사항"));
  });

  it("'🧭 21주차 Weekly 공유사항' (장식 emoji + 숫자) 매치", () => {
    assert.ok(WEEKLY_HEADER_RE.test("🧭 21주차 Weekly 공유사항"));
  });

  it("'[Weekly 공유사항]' (bracket) 매치", () => {
    assert.ok(WEEKLY_HEADER_RE.test("[Weekly 공유사항]"));
  });

  it("'*Weekly 공유사항' (* prefix) 매치", () => {
    assert.ok(WEEKLY_HEADER_RE.test("*Weekly 공유사항"));
  });

  it("'#Weekly 공유사항' (# prefix) 매치", () => {
    assert.ok(WEEKLY_HEADER_RE.test("#Weekly 공유사항"));
  });

  it("multi-line: 다른 본문 다음 newline 후 '24주차 Weekly 공유사항' 매치", () => {
    const text = "프로젝트 개요\n\n24주차 Weekly 공유사항\n- 6/8 개발";
    assert.ok(WEEKLY_HEADER_RE.test(text));
  });

  it("case-insensitive: 'weekly 공유사항' (소문자) 매치", () => {
    assert.ok(WEEKLY_HEADER_RE.test("weekly 공유사항"));
  });
});

describe("WEEKLY_HEADER_RE — v6.1 신규 prefix", () => {
  it("'이번주 Weekly 공유사항' 매치 (신규 — TM-2745/TM-2756 운영 패턴)", () => {
    assert.ok(WEEKLY_HEADER_RE.test("이번주 Weekly 공유사항"));
  });

  it("'금주 Weekly 공유사항' 매치", () => {
    assert.ok(WEEKLY_HEADER_RE.test("금주 Weekly 공유사항"));
  });

  it("'This Week Weekly 공유사항' 매치 (영문)", () => {
    assert.ok(WEEKLY_HEADER_RE.test("This Week Weekly 공유사항"));
  });

  it("'this week Weekly 공유사항' (소문자) 매치", () => {
    assert.ok(WEEKLY_HEADER_RE.test("this week Weekly 공유사항"));
  });

  it("'this  week Weekly 공유사항' (다중 공백) 매치 — \\s* 허용", () => {
    assert.ok(WEEKLY_HEADER_RE.test("this  week Weekly 공유사항"));
  });

  it("'Current Week Weekly 공유사항' 매치", () => {
    assert.ok(WEEKLY_HEADER_RE.test("Current Week Weekly 공유사항"));
  });

  it("'🧭 이번주 Weekly 공유사항' (emoji + 한글 prefix) 매치", () => {
    assert.ok(WEEKLY_HEADER_RE.test("🧭 이번주 Weekly 공유사항"));
  });

  it("multi-line: 본문 후 newline 다음 '이번주 Weekly 공유사항' 매치", () => {
    const text = "프로젝트 정보\n\n이번주 Weekly 공유사항\n- 진행 사항";
    assert.ok(WEEKLY_HEADER_RE.test(text));
  });

  it("'이번주\\nWeekly 공유사항' (prefix 와 본문 사이 줄바꿈) 매치 — \\s* 허용", () => {
    // \s 는 \n 포함
    const text = "이번주\nWeekly 공유사항";
    assert.ok(WEEKLY_HEADER_RE.test(text));
  });
});

describe("WEEKLY_HEADER_RE — 의도된 미매치 케이스", () => {
  it("'다음주 Weekly 공유사항' 미매치 — '다음주' 는 prefix 후보 아님", () => {
    // 정책: "다음주" 는 LIVE 가 아닌 예정 — schedule sync 대상 아님.
    // 단 다음주 시점에 작성되면 그때는 description "이번주" prefix 로 갱신될 것.
    assert.ok(!WEEKLY_HEADER_RE.test("다음주 Weekly 공유사항"));
  });

  it("'지난주 Weekly 공유사항' 미매치", () => {
    assert.ok(!WEEKLY_HEADER_RE.test("지난주 Weekly 공유사항"));
  });

  it("'last week Weekly 공유사항' 미매치", () => {
    assert.ok(!WEEKLY_HEADER_RE.test("last week Weekly 공유사항"));
  });

  it("'next week Weekly 공유사항' 미매치", () => {
    assert.ok(!WEEKLY_HEADER_RE.test("next week Weekly 공유사항"));
  });

  it("'주차 Weekly 공유사항' (숫자 없음) 미매치", () => {
    assert.ok(!WEEKLY_HEADER_RE.test("주차 Weekly 공유사항"));
  });

  it("일반 본문 중간 'Weekly 공유사항' 단어 등장 — 줄 시작 아님 → 미매치", () => {
    // line-start anchor 필요 — 본문 중간 단어는 매치 안 됨
    const text = "프로젝트의 Weekly 공유사항 작성 기한을 정합니다.";
    assert.ok(!WEEKLY_HEADER_RE.test(text));
  });

  it("빈 문자열 미매치", () => {
    assert.ok(!WEEKLY_HEADER_RE.test(""));
  });
});

describe("WEEKLY_HEADER_RE — TM-2745 / TM-2756 운영 시나리오 reproduction", () => {
  it("TM-2745 description '이번주 Weekly 공유사항\\n- 6/8 개발중' 매치", () => {
    const desc =
      "프로젝트 개요\n\n"
      + "이번주 Weekly 공유사항\n"
      + "- 6/8~ 개발중\n"
      + "- 6/22~7/5 QA\n"
      + "- 7/20 대고객 오픈";
    assert.ok(WEEKLY_HEADER_RE.test(desc));
  });

  it("TM-2756 description '금주 Weekly 공유사항' 매치", () => {
    const desc =
      "ProjectName\n\n"
      + "금주 Weekly 공유사항\n"
      + "- 주요 일정 : 6/10 29CM 개발 착수, 8/3 QA 착수, 8/27 론치";
    assert.ok(WEEKLY_HEADER_RE.test(desc));
  });

  it("v6.0 회귀 — '24주차 Weekly 공유사항' (Bot archive) 도 그대로 매치", () => {
    // v6.0 (PR #46) 이 comment-source 자격을 부여한 marker 와 동일 형태.
    // description 에서도 numeric prefix 그대로 매치되어야 함.
    assert.ok(WEEKLY_HEADER_RE.test("24주차 Weekly 공유사항"));
  });
});

describe("extractLatestWeeklySection — live description source", () => {
  it("여러 Weekly 블록 중 시각적으로 마지막 블록을 선택", () => {
    const result = extractLatestWeeklySection(
      "20주차 Weekly 공유사항\n"
      + "- QA: 5/10 완료\n\n"
      + "21주차 Weekly 공유사항\n"
      + "- QA: 5/17 진행중",
    );

    assert.equal(result.headerMatched, "21주차 Weekly 공유사항");
    assert.equal(result.section, "- QA: 5/17 진행중");
  });

  it("숫자 주차 헤더를 sourceText에 보존", () => {
    const result = extractLatestWeeklySection(
      "프로젝트 개요\n\n24주차 Weekly 공유사항\n- 6/8 개발중",
    );

    assert.equal(result.sourceText, "24주차 Weekly 공유사항\n- 6/8 개발중");
  });

  it("운영 stop section 이후 내용은 제외", () => {
    const result = extractLatestWeeklySection(
      "24주차 Weekly 공유사항\n- 6/8 개발중\n활동:\n- 상태 변경",
    );

    assert.equal(result.section, "- 6/8 개발중");
  });
});
