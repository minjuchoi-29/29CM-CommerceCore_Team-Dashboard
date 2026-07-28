import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseWeekly } from "../lib/weekly-parser";
import { mergeWeeklySync } from "../lib/weekly-merge";

describe("다른 티켓 Weekly 형식 회귀 검증", () => {
  test("TM-2901 — PM 논의/sync는 제외하고 BE·QA 실행 일정만 생성", () => {
    const parsed = parseWeekly([
      "31주차 Weekly 공유사항",
      "📅 일정",
      "- PM",
      "  - 6/30 가격/쿠폰 Sync 컨슈머 관련 추가 논의",
      "- BE",
      "  - 6/29 ~ 8/6 개발 진행중",
      "- QA",
      "  - 8/7 성능 테스트, 통합 테스트 및 QA 대응 예정",
    ].join("\n"), "TM-2901");

    assert.equal(parsed.scheduleItems.some(item => /논의|sync/i.test(item.rawText)), false);
    const be = parsed.scheduleItems.find(item => item.resourceTeam === "BE");
    const qa = parsed.scheduleItems.find(item => item.phase === "QA");
    assert.deepEqual([be?.startDate, be?.endDate, be?.status],
      ["2026-06-29", "2026-08-06", "진행중"]);
    assert.deepEqual([qa?.startDate, qa?.endDate],
      ["2026-08-07", "2026-08-07"]);
  });

  test("TM-2922 — 부모 개발팀을 상속해 MSS BE·29CM BE·29CM FE를 분리", () => {
    const parsed = parseWeekly([
      "31주차 Weekly 공유사항",
      "📅 일정",
      "- MSS BE",
      "  - 7/20~7/31 ITGG 개발 착수",
      "- 29CM BE",
      "  - 7/20~8/12 개발",
      "- 29CM FE",
      "  - 8/4~8/14 개발 예정",
      "- 디자인",
      "  - 7/27 디자인 1차 sync",
    ].join("\n"), "TM-2922");

    const devItems = parsed.scheduleItems.filter(item => item.phase === "개발");
    assert.deepEqual(
      devItems.map(item => item.resourceTeam),
      ["MSS BE", "29CM BE", "29CM FE"],
    );
    assert.equal(new Set(devItems.map(item => item.stableTaskId)).size, 3);
    assert.equal(parsed.scheduleItems.some(item => item.rawText.includes("1차 sync")), false);
  });

  test("TM-2759 — Frontend와 M/D-M/D 범위, 론치 날짜를 모두 인식", () => {
    const parsed = parseWeekly([
      "31주차 Weekly 공유사항",
      "<전체 일정>",
      "- 개발일정",
      "  - Purchase BE 6/30~8/21",
      "  - Commerce Frontend 6/30~8/21",
      "  - Mobile(안드로이드, iOS) 7/2-7/3",
      "  - QA 8/24~9/4",
      "- 론치 date",
      "  - 9/9",
    ].join("\n"), "TM-2759");

    const frontend = parsed.scheduleItems.find(item => item.resourceTeam === "Commerce Frontend");
    const mobile = parsed.scheduleItems.find(item => item.resourceTeam?.includes("Mobile"));
    const launch = parsed.scheduleItems.find(item => item.phase === "Launch");
    assert.deepEqual([frontend?.startDate, frontend?.endDate],
      ["2026-06-30", "2026-08-21"]);
    assert.deepEqual([mobile?.startDate, mobile?.endDate],
      ["2026-07-02", "2026-07-03"]);
    assert.equal(launch?.startDate, "2026-09-09");
  });

  test("TM-2756 — 한 문장의 개발완료일과 런칭일을 별도 일정으로 분리", () => {
    const parsed = parseWeekly(
      "31주차 Weekly 공유사항\n- 개발완료 9/7, 런칭 10/14 타겟",
      "TM-2756",
    );
    const development = parsed.scheduleItems.find(item => item.phase === "개발");
    const launch = parsed.scheduleItems.find(item => item.phase === "Launch");

    assert.deepEqual([development?.startDate, development?.status],
      ["2026-09-07", "완료"]);
    assert.deepEqual([launch?.startDate, launch?.status],
      ["2026-10-14", "예정"]);
  });

  test("TM-2752 — 날짜 없는 sign-off 완료는 빈 Release 신규 행을 만들지 않음", () => {
    const parsed = parseWeekly(
      "30주차 Weekly 공유사항\n- 배송정책 ADR sign-off 완료",
      "TM-2752",
    );
    const result = mergeWeeklySync(
      "TM-2752",
      parsed,
      [],
      [],
      new Date("2026-07-28T00:00:00Z"),
    );
    assert.equal(result.updatedSchedules.length, 0);
  });
});

describe("대시보드 진행중 티켓 Weekly 형식 회귀 검증", () => {
  test("TM-3145 — 산정·월 단위 미확정 표현은 제외하고 실제 착수일만 유지", () => {
    const parsed = parseWeekly([
      "📅 일정",
      "- 마일스톤 산정(~7/30)",
      "- 양측 개발 완료 시점에 합동 QA 진행 (8월 내)",
      "- 개발: 7월 마지막주~8월 첫주",
      "- BE : 08/03 착수 예정",
    ].join("\n"), "TM-3145");

    assert.deepEqual(
      parsed.scheduleItems.map(item => [
        item.phase, item.resourceTeam, item.startDate, item.status,
      ]),
      [["개발", "BE", "2026-08-03", "진행중"]],
    );
  });

  test("TM-3145 — 일정 확정 기한과 TBD는 실제 개발·배포 일정으로 생성하지 않음", () => {
    const parsed = parseWeekly([
      "30주차 Weekly 공유사항",
      "<일정>",
      "- PM : 완료 (기획 요건 더블체크 완료)",
      "- PD : TBD",
      "- BE : 금주(~07/24) 내 일정 확정 예정",
      "- FE : 금주(~07/24) 내 일정 확정 예정",
      "- QA : TBD",
      "- 배포/론치 : TBD (개발 및 QA 일정 확인 후 확정 예정)",
    ].join("\n"), "TM-3145");

    assert.equal(
      parsed.scheduleItems.some(item =>
        item.resourceTeam === "BE"
        || item.resourceTeam === "FE"
        || item.phase === "Release"
        || item.phase === "Launch"),
      false,
    );
    assert.deepEqual(
      parsed.scheduleItems.map(item => [item.phase, item.status]),
      [["기획", "완료"]],
    );
  });

  test("TM-3264 — PD를 디자인 단계의 별도 일정으로 인식", () => {
    const parsed = parseWeekly([
      "📅 일정",
      "- PD: 7/1~7/23",
      "- BE: 7/20~8/5",
      "- FE: 7/27~8/7",
      "- QA: 8/10~8/14",
    ].join("\n"), "TM-3264");

    assert.deepEqual(
      parsed.scheduleItems.map(item => [item.phase, item.resourceTeam]),
      [["디자인", null], ["개발", "BE"], ["개발", "FE"], ["QA", null]],
    );
  });

  test("TM-3269 — DFD 의사결정 날짜를 모바일 개발 일정으로 만들지 않음", () => {
    const parsed = parseWeekly("📅 일정\n- ME: DFD 7/28", "TM-3269");
    assert.equal(parsed.scheduleItems.length, 0);
  });

  test("TM-2564 — 기획서 작성중 ETA는 기획 진행 일정으로 정규화", () => {
    const parsed = parseWeekly("📅 일정\n- 기획서 작성중 (ETA 7/31)", "TM-2564");
    assert.deepEqual(
      parsed.scheduleItems.map(item => [
        item.phase, item.resourceTeam, item.startDate, item.status,
      ]),
      [["기획", null, "2026-07-31", "진행중"]],
    );
  });

  test("TM-2564 — 통합검수는 QA가 아니며 논의 문장은 일정으로 만들지 않음", () => {
    const parsed = parseWeekly([
      "31주차 Weekly 공유사항",
      "📅 일정",
      "- 통합검수 정책 플로우 정리중 (ETA 7/31)",
      "- 통합 성과 지표 논의 예정 7/31",
    ].join("\n"), "TM-2564");

    assert.equal(parsed.scheduleItems.some(item => item.phase === "QA"), false);
    assert.equal(parsed.scheduleItems.some(item => /논의/.test(item.rawText)), false);
    assert.deepEqual(
      parsed.scheduleItems.map(item => [item.phase, item.startDate, item.status]),
      [["기획", "2026-07-31", "진행중"]],
    );
  });

  test("TM-2922 — 날짜와 예정 상태가 있어도 리뷰·Sync는 일정이 아님", () => {
    const parsed = parseWeekly([
      "📅 일정",
      "- PM: 7/28 PRD 리뷰 및 ETA 산정 예정",
      "- 디자인: 7/29 1차 Sync 예정",
      "- 29CM BE: 7/20~8/12 개발 진행중",
    ].join("\n"), "TM-2922");

    assert.deepEqual(
      parsed.scheduleItems.map(item => [item.phase, item.resourceTeam]),
      [["개발", "29CM BE"]],
    );
  });

  test("TM-2922 — 일정 상세 플래닝·재산정은 제외하고 실행 기간만 유지", () => {
    const parsed = parseWeekly([
      "30주차 Weekly 공유사항",
      "📅 일정",
      "- BE",
      "  - 7/10 일정 상세 플래닝",
      "- MSS BE",
      "  - 7/20~7/31 ITGG 개발 착수",
      "- 29CM BE",
      "  - 7/20~8/12 개발",
      "- 디자인",
      "  - 7/20~8/4 디자인 가이드 발행 예정",
      "- 29CM FE",
      "  - 8/4 착수 시점 기준, 일정 재산정 필요",
      "- QA",
      "  - 8/12~8/24 QA 리소스 펀딩 요청 예정",
    ].join("\n"), "TM-2922");

    assert.equal(parsed.scheduleItems.some(item => /플래닝|재산정/.test(item.rawText)), false);
    assert.deepEqual(
      parsed.scheduleItems.map(item => [item.phase, item.resourceTeam, item.startDate, item.endDate]),
      [
        ["개발", "MSS BE", "2026-07-20", "2026-07-31"],
        ["개발", "29CM BE", "2026-07-20", "2026-08-12"],
        ["디자인", "가이드 발행 예정", "2026-07-20", "2026-08-04"],
        ["QA", "리소스 펀딩 요청 예정", "2026-08-12", "2026-08-24"],
      ],
    );
  });

  test("TM-3616 — 콜론 앞 완료 상태를 보존", () => {
    const parsed = parseWeekly("📅 일정\n- 개발 완료: 8/21", "TM-3616");
    assert.deepEqual(
      parsed.scheduleItems.map(item => [
        item.phase, item.resourceTeam, item.startDate, item.status,
      ]),
      [["개발", null, "2026-08-21", "완료"]],
    );
  });

  test("TM-3259 — 영문 계층형 Milestone에서 개발·QA 기간을 추출", () => {
    const parsed = parseWeekly([
      "- Progress Detail",
      "  - 디펜던시 팀 작업 검수 및 수정 진행중",
      "- Next Step",
      "  - 신규 배지 관련 추가 개발 진행",
      "- Milestone",
      "  - 7/15~7/22: 코어 카탈로그 신규 항목 추가, 정제상품명 개발",
      "  - 7/20~7/29: 리테일 플랫폼 BE 개발",
      "  - 7/30~8/2: QA, 신규 템플릿 매핑",
    ].join("\n"), "TM-3259");

    assert.deepEqual(
      parsed.scheduleItems.map(item => [item.phase, item.startDate, item.endDate]),
      [
        ["개발", "2026-07-15", "2026-07-22"],
        ["개발", "2026-07-20", "2026-07-29"],
        ["QA", "2026-07-30", "2026-08-02"],
      ],
    );
  });

  test("TM-2771 — 미확정 기능 테스트는 제외하고 조건부 론치만 후보로 유지", () => {
    const parsed = parseWeekly([
      "<진행상황>",
      "- 상담사 채팅 오픈을 위한 준비중",
      "<일정>",
      "- 기능 테스트: 일정 확인 필요",
      "- 론치: 8/14 예정 (확정여부 확인 필요)",
    ].join("\n"), "TM-2771");

    assert.equal(parsed.scheduleItems.length, 1);
    assert.deepEqual(
      [parsed.scheduleItems[0].phase, parsed.scheduleItems[0].startDate],
      ["Launch", "2026-08-14"],
    );
  });

  test("TM-2215 — 복수 개발팀과 개발완료·QA 단계 전환을 분리", () => {
    const parsed = parseWeekly([
      "- 7/22~ 개발중 (Pricing, Purchase, CMFE)",
      "- 8/19 개발완료, QA",
      "- 8/27 런칭",
    ].join("\n"), "TM-2215");

    const startedTeams = parsed.scheduleItems
      .filter(item => item.startDate === "2026-07-22")
      .map(item => item.resourceTeam);
    assert.deepEqual(startedTeams, ["Pricing", "Purchase", "CMFE"]);
    assert.ok(parsed.scheduleItems.some(item =>
      item.phase === "개발" && item.startDate === "2026-08-19" && item.status === "완료"));
    assert.ok(parsed.scheduleItems.some(item =>
      item.phase === "QA" && item.startDate === "2026-08-19" && item.status === "예정"));
    assert.ok(parsed.scheduleItems.some(item =>
      item.phase === "Launch" && item.startDate === "2026-08-27"));
  });

  for (const [ticketKey, releaseDate] of [
    ["TM-3380", "2026-08-13"],
    ["TM-3382", "2026-08-20"],
  ] as const) {
    test(`${ticketKey} — 팀별 완료·진행 상태와 배포일을 분리`, () => {
      const parsed = parseWeekly([
        "- Pricing, Purchase 개발완료 / Commerce FE 개발중",
        `- ${Number(releaseDate.slice(5, 7))}/${Number(releaseDate.slice(8))} 배포 예정`,
      ].join("\n"), ticketKey);

      assert.deepEqual(
        parsed.scheduleItems
          .filter(item => item.phase === "개발")
          .map(item => [item.resourceTeam, item.status]),
        [["Pricing", "완료"], ["Purchase", "완료"], ["Commerce FE", "진행중"]],
      );
      assert.ok(parsed.scheduleItems.some(item =>
        item.phase === "Release" && item.startDate === releaseDate));
    });
  }
});
