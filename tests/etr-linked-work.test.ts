/**
 * buildEtrReverseMapAll — Jira issue link 기반 reverse map 보강 검증.
 *
 * 보호 invariants:
 *  - inwardIssue 만 있는 link 도 LinkedWork 추가됨 (ETR-3855 실제 케이스)
 *  - outwardIssue 만 있는 link 도 추가됨
 *  - 양쪽 모두 / 중복 시 key 기준 dedupe
 *  - ETR-* prefix 는 제외 (자기 자신 / 다른 ETR)
 *  - Project key 필터 없음 (TM / CMALL / M29CMOD 등 모두 허용)
 *  - ticketByKey 의 rich metadata 가 있으면 우선, 없으면 jiraLinks 메타 사용
 *  - cc-etr 의 manual 등록과 jiraLinks 양쪽에 같은 key 존재 시 manual 우선
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildEtrReverseMapAll,
  type EtrTicketLike,
} from "../lib/etr-links";

type TicketLike = {
  key: string;
  summary: string;
  status: string;
  type: string;
  assignee?: string;
};

const mkTicketByKey = (tickets: TicketLike[]): Map<string, TicketLike> => {
  const m = new Map<string, TicketLike>();
  for (const t of tickets) m.set(t.key, t);
  return m;
};

describe("buildEtrReverseMapAll — inward / outward 모두 처리", () => {
  it("outwardIssue 만 있는 link → LinkedWork 추가", () => {
    const etrTickets: EtrTicketLike[] = [
      {
        key: "ETR-1001",
        jiraLinks: [
          { key: "TM-100", linkType: "Relates", direction: "out", summary: "out task", status: "개발중", type: "Task" },
        ],
      },
    ];
    const result = buildEtrReverseMapAll({}, mkTicketByKey([]), etrTickets);
    const lw = result.get("ETR-1001");
    assert.ok(lw, "ETR-1001 entry 존재");
    assert.equal(lw!.length, 1);
    assert.equal(lw![0].tmKey, "TM-100");
    assert.equal(lw![0].summary, "out task");
    assert.equal(lw![0].status, "개발중");
  });

  it("inwardIssue 만 있는 link → LinkedWork 추가 (ETR-3855 케이스)", () => {
    // ETR-3855 의 실제 데이터: Blocks + inwardIssue TM-3373
    const etrTickets: EtrTicketLike[] = [
      {
        key: "ETR-3855",
        jiraLinks: [
          {
            key: "TM-3373",
            linkType: "Blocks",
            direction: "in",
            summary: "[클레임] 품절취소 보상 구조 브랜드 부담으로 전환",
            status: "개발중",
            type: "Initiative",
          },
        ],
      },
    ];
    const result = buildEtrReverseMapAll({}, mkTicketByKey([]), etrTickets);
    const lw = result.get("ETR-3855");
    assert.ok(lw, "ETR-3855 LinkedWork 존재해야 함 (현재 버그: 'no linked work' 표시)");
    assert.equal(lw!.length, 1);
    assert.equal(lw![0].tmKey, "TM-3373");
    assert.equal(lw![0].summary, "[클레임] 품절취소 보상 구조 브랜드 부담으로 전환");
    assert.equal(lw![0].level, "Initiative");
  });

  it("outward + inward 둘 다 있는 link → 모두 추가", () => {
    const etrTickets: EtrTicketLike[] = [
      {
        key: "ETR-X",
        jiraLinks: [
          { key: "TM-1", linkType: "Relates", direction: "out", summary: "out" },
          { key: "TM-2", linkType: "Blocks", direction: "in", summary: "in" },
        ],
      },
    ];
    const result = buildEtrReverseMapAll({}, mkTicketByKey([]), etrTickets);
    const lw = result.get("ETR-X");
    assert.equal(lw!.length, 2);
    const keys = lw!.map(w => w.tmKey).sort();
    assert.deepEqual(keys, ["TM-1", "TM-2"]);
  });

  it("같은 key 가 양쪽 link 에 → dedupe (1건만)", () => {
    const etrTickets: EtrTicketLike[] = [
      {
        key: "ETR-X",
        jiraLinks: [
          { key: "TM-100", linkType: "Relates", direction: "out", summary: "first" },
          { key: "TM-100", linkType: "Blocks", direction: "in", summary: "duplicate" },
        ],
      },
    ];
    const result = buildEtrReverseMapAll({}, mkTicketByKey([]), etrTickets);
    const lw = result.get("ETR-X");
    assert.equal(lw!.length, 1);
    assert.equal(lw![0].tmKey, "TM-100");
    assert.equal(lw![0].summary, "first", "첫 link 의 metadata 가 우선");
  });
});

describe("buildEtrReverseMapAll — Project key 필터 없음", () => {
  it("TM 외 프로젝트도 모두 LinkedWork 로 포함 (CMALL / M29CMOD)", () => {
    const etrTickets: EtrTicketLike[] = [
      {
        key: "ETR-X",
        jiraLinks: [
          { key: "TM-1",       linkType: "Relates", direction: "out" },
          { key: "CMALL-100",  linkType: "Relates", direction: "out" },
          { key: "M29CMOD-5",  linkType: "Relates", direction: "in" },
          { key: "M29CMCT-9",  linkType: "Relates", direction: "in" },
          { key: "OPS-77",     linkType: "Relates", direction: "out" },
        ],
      },
    ];
    const result = buildEtrReverseMapAll({}, mkTicketByKey([]), etrTickets);
    const lw = result.get("ETR-X");
    assert.equal(lw!.length, 5, "Project key 필터 없음 — 모든 non-ETR linked issue 표시");
    const keys = lw!.map(w => w.tmKey).sort();
    assert.deepEqual(keys, ["CMALL-100", "M29CMCT-9", "M29CMOD-5", "OPS-77", "TM-1"]);
  });
});

describe("buildEtrReverseMapAll — ETR-* 제외", () => {
  it("ETR-* prefix link 는 LinkedWork 에 추가 안 함", () => {
    const etrTickets: EtrTicketLike[] = [
      {
        key: "ETR-1",
        jiraLinks: [
          { key: "ETR-2",  linkType: "Relates", direction: "out" }, // 다른 ETR → 제외
          { key: "ETR-1",  linkType: "Relates", direction: "in" },  // 자기 자신 → 제외
          { key: "TM-100", linkType: "Relates", direction: "in" },  // execution → 포함
        ],
      },
    ];
    const result = buildEtrReverseMapAll({}, mkTicketByKey([]), etrTickets);
    const lw = result.get("ETR-1");
    assert.equal(lw!.length, 1);
    assert.equal(lw![0].tmKey, "TM-100");
  });
});

describe("buildEtrReverseMapAll — ticketByKey rich metadata 우선", () => {
  it("ticketByKey 에 있으면 rich metadata 사용 (assignee 등)", () => {
    const etrTickets: EtrTicketLike[] = [
      {
        key: "ETR-X",
        jiraLinks: [
          { key: "TM-100", linkType: "Relates", direction: "out", summary: "stale summary from link" },
        ],
      },
    ];
    const ticketByKey = mkTicketByKey([
      { key: "TM-100", summary: "fresh summary", status: "QA중", type: "Task", assignee: "minju.choi" },
    ]);
    const result = buildEtrReverseMapAll({}, ticketByKey, etrTickets);
    const lw = result.get("ETR-X");
    assert.equal(lw!.length, 1);
    assert.equal(lw![0].summary, "fresh summary");
    assert.equal(lw![0].status, "QA중");
    assert.equal(lw![0].assignee, "minju.choi");
  });

  it("ticketByKey 에 없으면 jiraLinks 메타 fallback", () => {
    const etrTickets: EtrTicketLike[] = [
      {
        key: "ETR-X",
        jiraLinks: [
          { key: "OPS-50", linkType: "Relates", direction: "in", summary: "link-only summary", status: "Done", type: "Bug" },
        ],
      },
    ];
    const result = buildEtrReverseMapAll({}, mkTicketByKey([]), etrTickets);
    const lw = result.get("ETR-X");
    assert.equal(lw!.length, 1);
    assert.equal(lw![0].summary, "link-only summary");
    assert.equal(lw![0].status, "Done");
    assert.equal(lw![0].level, "Bug");
    assert.equal(lw![0].assignee, undefined);
  });
});

describe("buildEtrReverseMapAll — manual + jiraLinks 통합", () => {
  it("cc-etr manual 등록과 jiraLinks 중복 → manual 우선 (dedupe)", () => {
    const etrMap = {
      "TM-100": {
        source: "ETR" as const,
        etrTickets: [{ key: "ETR-X" }],
      },
    };
    const ticketByKey = mkTicketByKey([
      { key: "TM-100", summary: "manual summary", status: "개발중", type: "Task" },
    ]);
    const etrTickets: EtrTicketLike[] = [
      {
        key: "ETR-X",
        jiraLinks: [
          { key: "TM-100", linkType: "Blocks", direction: "in", summary: "from jira" },
        ],
      },
    ];
    const result = buildEtrReverseMapAll(etrMap, ticketByKey, etrTickets);
    const lw = result.get("ETR-X");
    assert.equal(lw!.length, 1, "중복 제거 — manual 우선");
    assert.equal(lw![0].summary, "manual summary");
  });

  it("manual 없이 jiraLinks 만 있을 때 → jiraLinks 흡수", () => {
    // cc-etr 비어있음 — 사용자가 manual 등록 안 한 상태
    const etrTickets: EtrTicketLike[] = [
      {
        key: "ETR-3855",
        jiraLinks: [
          { key: "TM-3373", linkType: "Blocks", direction: "in" },
        ],
      },
    ];
    const result = buildEtrReverseMapAll({}, mkTicketByKey([]), etrTickets);
    const lw = result.get("ETR-3855");
    assert.ok(lw);
    assert.equal(lw!.length, 1);
    assert.equal(lw![0].tmKey, "TM-3373");
  });
});

describe("buildEtrReverseMapAll — edge cases", () => {
  it("jiraLinks 없음 → 빈 결과 (수동 등록 없는 경우)", () => {
    const etrTickets: EtrTicketLike[] = [{ key: "ETR-X" }];
    const result = buildEtrReverseMapAll({}, mkTicketByKey([]), etrTickets);
    assert.equal(result.get("ETR-X"), undefined);
  });

  it("빈 key / null key 무시", () => {
    const etrTickets: EtrTicketLike[] = [
      {
        key: "ETR-X",
        jiraLinks: [
          { key: "",     linkType: "Relates", direction: "out" },
          { key: "   ",  linkType: "Relates", direction: "out" },
          { key: "TM-1", linkType: "Relates", direction: "out" },
        ],
      },
    ];
    const result = buildEtrReverseMapAll({}, mkTicketByKey([]), etrTickets);
    const lw = result.get("ETR-X");
    assert.equal(lw!.length, 1);
    assert.equal(lw![0].tmKey, "TM-1");
  });

  it("ETR ticket array 비어있음 → 결과도 비어있음", () => {
    const result = buildEtrReverseMapAll({}, mkTicketByKey([]), []);
    assert.equal(result.size, 0);
  });
});
