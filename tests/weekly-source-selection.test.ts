import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildWeeklyReplaySources,
  versionWeeklySourceId,
  selectWeeklySource,
  weeklyFieldToText,
  type WeeklySourceCandidate,
} from "../lib/weekly-source";
import { parseWeekly } from "../lib/weekly-parser";

type Candidate = WeeklySourceCandidate & { text: string };

const candidate = (
  source: Candidate["source"],
  text: string,
): Candidate => ({ source, text });

describe("selectWeeklySource — current Weekly policy", () => {
  it("dedicated Weekly field가 있으면 description과 comment보다 우선", () => {
    const result = selectWeeklySource({
      customfield: candidate("customfield", "현재 QA 07/27~07/29"),
      description: candidate("description", "legacy description"),
      comment: candidate("comment", "30주차 archive"),
    });

    assert.equal(result?.source, "customfield");
    assert.equal(result?.text, "현재 QA 07/27~07/29");
  });

  it("Weekly field가 비면 description legacy source를 사용", () => {
    const result = selectWeeklySource({
      customfield: null,
      description: candidate("description", "description Weekly"),
      comment: candidate("comment", "30주차 archive"),
    });

    assert.equal(result?.source, "description");
  });

  it("현재 source가 모두 비면 최신 qualifying comment fallback을 사용", () => {
    const result = selectWeeklySource({
      customfield: null,
      description: null,
      comment: candidate("comment", "30주차 Weekly 공유사항"),
    });

    assert.equal(result?.source, "comment");
  });

  it("모든 후보가 없으면 null", () => {
    assert.equal(selectWeeklySource({
      customfield: null,
      description: null,
      comment: null,
    }), null);
  });

  it("TM-3375 현재 필드 형식의 QA/론치 일정을 파싱", () => {
    const currentWeekly = [
      "<진행상황>",
      "- 현재 QA 진행 중",
      "<일정>",
      "- PM : 완료",
      "- PD : 완료",
      "- BE : 완료",
      "- FE : 완료",
      "- QA : 07/27 ~ 07/29 진행 중 (QE팀 지원)",
      "- 배포/론치 : 08/06 고객 오픈 (스텝 선오픈 후)",
    ].join("\n");

    const parsed = parseWeekly(currentWeekly, "TM-3375");
    const qa = parsed.scheduleItems.find(item => item.phase === "QA");
    const launch = parsed.scheduleItems.find(item => item.phase === "Release");

    assert.equal(qa?.startDate, "2026-07-27");
    assert.equal(qa?.endDate, "2026-07-29");
    assert.equal(launch?.startDate, "2026-08-06");
  });
});

describe("weeklyFieldToText — Jira field response compatibility", () => {
  it("TM-2215 rendered HTML list를 Weekly plain text로 보존", () => {
    const text = weeklyFieldToText([
      "<ul>",
      "<li>7/22~ 개발중 (Pricing, Purchase, CMFE, CBP 정산)</li>",
      "<li>8/19 개발완료, QA</li>",
      "<li>론치리뷰 예정 (일정 PMO 확인중)</li>",
      "<li>8/27 런칭 (대상 상품 점진 확대)</li>",
      "</ul>",
    ].join(""));

    assert.match(text, /- 7\/22~ 개발중/);
    assert.match(text, /- 8\/19 개발완료, QA/);
    assert.match(text, /- 8\/27 런칭/);
  });

  it("ADF 값도 기존 indent-preserving 변환을 사용", () => {
    assert.equal(weeklyFieldToText({ type: "paragraph", content: [{ type: "text", text: "8/27 런칭" }] }), "8/27 런칭");
  });
});

describe("buildWeeklyReplaySources — archived Weekly replay", () => {
  it("Automation 댓글은 오래된 순서로, 현재 Weekly는 마지막에 둠", () => {
    const sources = buildWeeklyReplaySources(
      [
        {
          sourceId: "comment:30",
          text: "30주차",
          source: "comment",
          sourceWeek: "30주차",
          sourceUpdatedAt: "2026-07-24",
          created: "2026-07-24",
        },
        {
          sourceId: "comment:28",
          text: "28주차",
          source: "comment",
          sourceWeek: "28주차",
          sourceUpdatedAt: "2026-07-10",
          created: "2026-07-10",
        },
      ],
      {
        sourceId: "customfield:current",
        text: "현재 Weekly",
        source: "customfield",
        sourceWeek: "31주차",
        sourceUpdatedAt: "2026-07-28",
      },
    );

    assert.deepEqual(
      sources.map(source => source.sourceId),
      ["comment:28", "comment:30", "customfield:current"],
    );
  });

  it("현재 fallback이 이미 포함된 comment면 중복하지 않음", () => {
    const comment = {
      sourceId: "comment:30",
      text: "30주차",
      source: "comment" as const,
      sourceWeek: "30주차",
      sourceUpdatedAt: "2026-07-24",
      created: "2026-07-24",
    };
    assert.equal(buildWeeklyReplaySources([comment], comment).length, 1);
  });
});

it("source ID에 파서 버전을 포함해 정책 변경 시 한 번 재처리", () => {
  assert.equal(versionWeeklySourceId("comment:1119512"), "schedule-v4:comment:1119512");
});
