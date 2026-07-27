/**
 * v6 정책 검증 — comment-source 자격 (isWeeklyAutomationComment).
 *
 * production source helper를 직접 검증하여 route와 테스트의 drift를 막는다.
 *
 * 보호 invariants:
 *  - 자동 댓글 (Automation/Bot author) + "<NN>주차 Weekly 공유사항" 마커 → qualifies
 *  - 사람 작성 댓글 + 동일 마커 → not qualifies (노이즈 차단)
 *  - 자동 작성 + 마커 없음 → not qualifies
 *  - 빈 author / "-" → not qualifies
 *  - 마커는 본문 어디에 있어도 매칭 (반드시 첫 줄일 필요 없음)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  WEEKLY_COMMENT_MARKER_RE,
  isAutomationAuthor,
  isWeeklyAutomationComment,
  selectLatestQualifyingComment,
  type WeeklyCommentCandidate,
} from "../lib/weekly-source";

describe("isAutomationAuthor — 작성자 분류", () => {
  it("'Automation for Jira' → automation", () => {
    assert.equal(isAutomationAuthor("Automation for Jira"), true);
  });
  it("'automation' (lowercase) → automation", () => {
    assert.equal(isAutomationAuthor("automation"), true);
  });
  it("'Atlassian Assist' → automation", () => {
    assert.equal(isAutomationAuthor("Atlassian Assist"), true);
  });
  it("'Jira Bot' → automation", () => {
    assert.equal(isAutomationAuthor("Jira Bot"), true);
  });
  it("'자동 생성 Bot' → automation", () => {
    assert.equal(isAutomationAuthor("자동 생성 Bot"), true);
  });
  it("'자동생성' (no space) → automation", () => {
    assert.equal(isAutomationAuthor("자동생성"), true);
  });
  it("'Minju Choi' (사람 이름) → not automation", () => {
    assert.equal(isAutomationAuthor("Minju Choi"), false);
  });
  it("'박지원' (한글 이름) → not automation", () => {
    assert.equal(isAutomationAuthor("박지원"), false);
  });
  it("'robotech' (bot 부분문자열 단독 등장 X — word boundary) → not automation", () => {
    // \bbot\b 가 word boundary 적용 — "robotech" 의 "bot" 은 단어 경계 안에 있지 않음
    assert.equal(isAutomationAuthor("robotech"), false);
  });
  it("'abbot' (전체가 word char 라 \\bbot\\b 미매치) → not automation", () => {
    // 'a','b','b','o','t' 모두 word char. \b 는 word/non-word 전이 지점이라 매치 없음.
    // 운영상 false-negative 가능성이 있지만, false-positive 보다 보수적이라 선호.
    assert.equal(isAutomationAuthor("abbot"), false);
  });
  it("'release bot' (공백 + bot) → automation", () => {
    // 공백이 non-word char 라 \bbot\b 매치.
    assert.equal(isAutomationAuthor("release bot"), true);
  });
  it("'-' (Jira 응답의 누락 표시) → not automation", () => {
    assert.equal(isAutomationAuthor("-"), false);
  });
  it("빈 문자열 → not automation", () => {
    assert.equal(isAutomationAuthor(""), false);
  });
  it("undefined → not automation", () => {
    assert.equal(isAutomationAuthor(undefined), false);
  });
  it("null → not automation", () => {
    assert.equal(isAutomationAuthor(null), false);
  });
});

describe("WEEKLY_COMMENT_MARKER_RE — 마커 패턴", () => {
  it("'24주차 Weekly 공유사항' → 매치", () => {
    assert.equal(WEEKLY_COMMENT_MARKER_RE.test("24주차 Weekly 공유사항"), true);
  });
  it("'24주차Weekly공유사항' (공백 없음) → 매치 (\\s* 허용)", () => {
    assert.equal(WEEKLY_COMMENT_MARKER_RE.test("24주차Weekly공유사항"), true);
  });
  it("'24 주차 Weekly 공유사항' (앞에 공백) → 매치", () => {
    assert.equal(WEEKLY_COMMENT_MARKER_RE.test("24 주차 Weekly 공유사항"), true);
  });
  it("'24주차 WEEKLY 공유사항' (대문자) → 매치 (case-insensitive)", () => {
    assert.equal(WEEKLY_COMMENT_MARKER_RE.test("24주차 WEEKLY 공유사항"), true);
  });
  it("본문 중간에 마커 등장 → 매치", () => {
    const body = "안녕하세요\n\n24주차 Weekly 공유사항\n\n- 6/8 개발";
    assert.equal(WEEKLY_COMMENT_MARKER_RE.test(body), true);
  });
  it("'이번주 Weekly 공유사항' (\\d+ 없음) → 미매치 — 의도된 좁은 패턴", () => {
    assert.equal(WEEKLY_COMMENT_MARKER_RE.test("이번주 Weekly 공유사항"), false);
  });
  it("'Weekly 공유사항' (주차 없음) → 미매치", () => {
    assert.equal(WEEKLY_COMMENT_MARKER_RE.test("Weekly 공유사항"), false);
  });
  it("일반 댓글 ('확인 부탁드립니다') → 미매치", () => {
    assert.equal(WEEKLY_COMMENT_MARKER_RE.test("확인 부탁드립니다"), false);
  });
  it("'25주차 일정 관련' (Weekly 공유사항 부분 없음) → 미매치", () => {
    assert.equal(WEEKLY_COMMENT_MARKER_RE.test("25주차 일정 관련"), false);
  });
});

describe("isWeeklyAutomationComment — 통합 자격 판정", () => {
  it("Automation for Jira + '24주차 Weekly 공유사항' 본문 → qualifies", () => {
    assert.equal(
      isWeeklyAutomationComment("Automation for Jira", "24주차 Weekly 공유사항\n- 6/8 개발"),
      true,
    );
  });

  it("Automation for Jira + 마커 없는 본문 → not qualifies", () => {
    assert.equal(
      isWeeklyAutomationComment("Automation for Jira", "일정 변경 안내"),
      false,
    );
  });

  it("사람 작성자 + 마커 있는 본문 → not qualifies (노이즈 차단)", () => {
    assert.equal(
      isWeeklyAutomationComment("Minju Choi", "24주차 Weekly 공유사항 보고 부탁드립니다"),
      false,
    );
  });

  it("사람 작성자 + 마커 없는 본문 → not qualifies", () => {
    assert.equal(
      isWeeklyAutomationComment("Minju Choi", "확인 부탁드립니다"),
      false,
    );
  });

  it("'-' author + 마커 → not qualifies", () => {
    assert.equal(
      isWeeklyAutomationComment("-", "24주차 Weekly 공유사항"),
      false,
    );
  });

  it("Jira Bot + '15주차 Weekly 공유사항' (15주차 케이스) → qualifies", () => {
    assert.equal(
      isWeeklyAutomationComment("Jira Bot", "15주차 Weekly 공유사항\n- 4/1 착수"),
      true,
    );
  });

  it("Atlassian Assist + 본문 중간 마커 → qualifies", () => {
    const body = "Hello team,\n\n22주차 Weekly 공유사항\n- 5/25 시작\n";
    assert.equal(isWeeklyAutomationComment("Atlassian Assist", body), true);
  });

  it("Automation + '이번주 Weekly 공유사항' (numeric 없음) → not qualifies", () => {
    assert.equal(
      isWeeklyAutomationComment("Automation for Jira", "이번주 Weekly 공유사항\n- 변경 사항"),
      false,
    );
  });
});

describe("운영 사례 — TM-2745 / TM-2756 시나리오 reproduction", () => {
  it("TM-2745 (Bot + 24주차 Weekly 본문) → schedule sync 대상", () => {
    const body =
      "24주차 Weekly 공유사항\n"
      + "- 6/8~ 개발중\n"
      + "- 6/22~7/5 QA\n"
      + "- 7/6~ CBT 진행\n"
      + "- 7/20 대고객 오픈";
    assert.equal(isWeeklyAutomationComment("Automation for Jira", body), true);
  });

  it("TM-2756 (Bot + 24주차 Weekly 본문) → schedule sync 대상", () => {
    const body =
      "24주차 Weekly 공유사항\n"
      + "- 주요 일정: 6/10 29CM 개발 착수, 8/3 QA 착수, 8/27 론치";
    assert.equal(isWeeklyAutomationComment("Automation for Jira", body), true);
  });

  it("v5 → v6 회귀 보호 — 동일 본문이 v5 에선 skip 됐지만 v6 에선 통과", () => {
    // v5 정책: src.source === "comment" 면 무조건 merge skip
    // v6 정책: Automation + marker 면 merge 실행
    const body = "24주차 Weekly 공유사항\n- 변경 항목";
    const qualifies = isWeeklyAutomationComment("Automation for Jira", body);
    assert.equal(qualifies, true, "v6: schedule sync 대상");
  });
});

describe("selectLatestQualifyingComment — comment fallback", () => {
  const comment = (
    author: string,
    text: string,
    updated: string,
  ): WeeklyCommentCandidate => ({
    author,
    text,
    updated,
    created: updated,
    markers: ["주차_Weekly_공유사항"],
    qualifiesForSync: isWeeklyAutomationComment(author, text),
  });

  it("최신 marker 댓글이 사람 작성이어도 그 다음 최신 bot 댓글을 선택", () => {
    const human = comment("Minju Choi", "25주차 Weekly 공유사항", "2026-06-20");
    const bot = comment("Automation for Jira", "24주차 Weekly 공유사항", "2026-06-19");

    assert.equal(selectLatestQualifyingComment([human, bot]), bot);
  });

  it("자격 충족 bot 댓글 중 newest-first 첫 항목을 선택", () => {
    const newest = comment("Automation for Jira", "25주차 Weekly 공유사항", "2026-06-20");
    const older = comment("Jira Bot", "24주차 Weekly 공유사항", "2026-06-13");

    assert.equal(selectLatestQualifyingComment([newest, older]), newest);
  });

  it("자격 충족 댓글이 없으면 null", () => {
    const human = comment("Minju Choi", "25주차 Weekly 공유사항", "2026-06-20");
    assert.equal(selectLatestQualifyingComment([human]), null);
  });
});
