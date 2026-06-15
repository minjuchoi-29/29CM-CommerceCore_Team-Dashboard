/**
 * buildGlobalSearchResults / getSearchDestination — 통합 검색 helpers.
 *
 * 보호 invariants:
 *  - TM key 검색 → kind="ticket", location="전체 과제 현황"
 *  - ETR key 검색 → kind="etr",   location="ETR 검토"
 *  - case-insensitive
 *  - 중복 key 없음
 *  - 정확 매칭이 prefix/contains 보다 우선
 *  - empty query → empty result
 *  - destination URL 은 q + key/ticket query param 모두 포함
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildGlobalSearchResults,
  getSearchDestination,
  type GlobalSearchSourceTicket,
} from "../lib/global-search";

const tickets: GlobalSearchSourceTicket[] = [
  { key: "TM-100",   summary: "주문 확인 페이지 개편",   status: "개발중",   assignee: "minju.choi", project: "TM" },
  { key: "TM-2745",  summary: "결제 모듈 정비",          status: "기획중",   assignee: "park.lee",   project: "TM" },
  { key: "CMALL-7",  summary: "쿠폰 룰 변경",             status: "QA중",     assignee: "kim.j",      project: "CMALL" },
  { key: "ETR-3855", summary: "[클레임] 품절취소 보상", status: "검토중",   reporter: "lee.s",      project: "ETR" },
  { key: "ETR-1",    summary: "디자인 시스템 마이그",   status: "검토대기", reporter: "go.k",       project: "ETR" },
];

describe("getSearchDestination", () => {
  it("ticket → /jira-tickets?q=&ticket=&focus=1", () => {
    assert.equal(
      getSearchDestination("ticket", "TM-100", "TM-100"),
      "/jira-tickets?q=TM-100&ticket=TM-100&focus=1",
    );
  });
  it("etr → /etr-review?q=&key=", () => {
    assert.equal(
      getSearchDestination("etr", "ETR-3855", "ETR-3855"),
      "/etr-review?q=ETR-3855&key=ETR-3855",
    );
  });
  it("query 에 공백 / 한글 → encodeURIComponent", () => {
    const url = getSearchDestination("ticket", "TM-1", "주문 확인");
    assert.ok(url.includes("q=%EC%A3%BC%EB%AC%B8%20%ED%99%95%EC%9D%B8"));
  });
  it("ticket destination 은 항상 focus=1 포함 (Focus Mode 자동 진입)", () => {
    const url = getSearchDestination("ticket", "CMALL-791", "CMALL");
    assert.ok(url.endsWith("&focus=1"), "ticket 도착지는 Focus Mode 진입 보장");
  });
  it("etr destination 은 focus=1 없음 (detail panel 만 표시)", () => {
    const url = getSearchDestination("etr", "ETR-3855", "ETR");
    assert.ok(!url.includes("focus=1"), "ETR 측은 focus param 없이 자연스러운 detail open");
  });
});

describe("buildGlobalSearchResults — empty query", () => {
  it("빈 query → 빈 결과", () => {
    assert.deepEqual(buildGlobalSearchResults("", tickets), []);
    assert.deepEqual(buildGlobalSearchResults("   ", tickets), []);
  });
});

describe("buildGlobalSearchResults — kind / location 분기", () => {
  it("TM key 검색 → kind=ticket, location=전체 과제 현황", () => {
    const r = buildGlobalSearchResults("TM-100", tickets);
    assert.equal(r.length, 1);
    assert.equal(r[0].kind, "ticket");
    assert.equal(r[0].location, "전체 과제 현황");
    assert.equal(r[0].key, "TM-100");
    assert.equal(r[0].destination, "/jira-tickets?q=TM-100&ticket=TM-100&focus=1");
  });

  it("ETR key 검색 → kind=etr, location=ETR 검토", () => {
    const r = buildGlobalSearchResults("ETR-3855", tickets);
    assert.equal(r.length, 1);
    assert.equal(r[0].kind, "etr");
    assert.equal(r[0].location, "ETR 검토");
    assert.equal(r[0].destination, "/etr-review?q=ETR-3855&key=ETR-3855");
  });

  it("ETR 화면에서 TM 검색 가능 → destination=/jira-tickets", () => {
    // 화면 무관 — 통합 검색이므로 query 가 TM key 면 ticket destination
    const r = buildGlobalSearchResults("TM-2745", tickets);
    assert.equal(r.length, 1);
    assert.ok(r[0].destination.startsWith("/jira-tickets"));
  });

  it("TicketBoard 에서 ETR 검색 가능 → destination=/etr-review", () => {
    const r = buildGlobalSearchResults("ETR-3855", tickets);
    assert.equal(r.length, 1);
    assert.ok(r[0].destination.startsWith("/etr-review"));
  });
});

describe("buildGlobalSearchResults — case-insensitive", () => {
  it("소문자 query → 대문자 key 매칭", () => {
    const r = buildGlobalSearchResults("tm-100", tickets);
    assert.equal(r.length, 1);
    assert.equal(r[0].key, "TM-100");
  });
  it("대소문자 mix summary 매칭", () => {
    const r = buildGlobalSearchResults("쿠폰", tickets);
    assert.equal(r.length, 1);
    assert.equal(r[0].key, "CMALL-7");
  });
});

describe("buildGlobalSearchResults — dedupe & 우선순위", () => {
  it("중복 key 무시 — 첫 entry 만 유지", () => {
    const dup: GlobalSearchSourceTicket[] = [
      { key: "TM-1", summary: "first" },
      { key: "TM-1", summary: "duplicate" },
    ];
    const r = buildGlobalSearchResults("TM-1", dup);
    assert.equal(r.length, 1);
    assert.equal(r[0].summary, "first");
  });

  it("정확 매칭 (score 0) 이 prefix (score 1) 보다 우선", () => {
    const t: GlobalSearchSourceTicket[] = [
      { key: "TM-1234", summary: "prefix match" },
      { key: "TM-1",    summary: "exact match"  },
    ];
    const r = buildGlobalSearchResults("TM-1", t);
    assert.equal(r[0].key, "TM-1", "정확 매칭이 먼저");
    assert.equal(r[1].key, "TM-1234");
  });

  it("key prefix > summary contains", () => {
    const t: GlobalSearchSourceTicket[] = [
      { key: "TM-10",   summary: "abc kim def" },
      { key: "KIM-1",   summary: "other" },
    ];
    const r = buildGlobalSearchResults("kim", t);
    // KIM-1 prefix (score 1) < TM-10 summary contains (score 3) — KIM-1 먼저
    assert.equal(r[0].key, "KIM-1");
  });
});

describe("buildGlobalSearchResults — multi-field 매칭", () => {
  it("assignee 매칭", () => {
    const r = buildGlobalSearchResults("minju", tickets);
    assert.equal(r.length, 1);
    assert.equal(r[0].key, "TM-100");
  });
  it("reporter 매칭 (ETR)", () => {
    const r = buildGlobalSearchResults("lee.s", tickets);
    assert.equal(r.length, 1);
    assert.equal(r[0].key, "ETR-3855");
  });
  it("status 매칭", () => {
    const r = buildGlobalSearchResults("QA중", tickets);
    assert.equal(r.length, 1);
    assert.equal(r[0].key, "CMALL-7");
  });
  it("project 매칭", () => {
    const r = buildGlobalSearchResults("CMALL", tickets);
    // CMALL-7 (key prefix) 1건
    assert.equal(r.length, 1);
    assert.equal(r[0].key, "CMALL-7");
  });
});

describe("buildGlobalSearchResults — limit / no-match", () => {
  it("매칭 없음 → 빈 배열", () => {
    const r = buildGlobalSearchResults("zzzzzz", tickets);
    assert.deepEqual(r, []);
  });
  it("limit 옵션 적용", () => {
    const many: GlobalSearchSourceTicket[] = Array.from({ length: 50 }, (_, i) => ({
      key: `TM-${i + 1}`, summary: "common",
    }));
    const r = buildGlobalSearchResults("common", many, { limit: 10 });
    assert.equal(r.length, 10);
  });
});

describe("buildGlobalSearchResults — empty/누락 field 안전", () => {
  it("undefined summary / assignee 도 안전", () => {
    const t: GlobalSearchSourceTicket[] = [
      { key: "TM-1" }, // 모든 optional 누락
    ];
    const r = buildGlobalSearchResults("TM-1", t);
    assert.equal(r.length, 1);
    assert.equal(r[0].summary, "");
    assert.equal(r[0].assignee, "");
  });
  it("빈 key entry 무시", () => {
    const t: GlobalSearchSourceTicket[] = [
      { key: "", summary: "ghost" },
      { key: "TM-1", summary: "real" },
    ];
    const r = buildGlobalSearchResults("TM-1", t);
    assert.equal(r.length, 1);
    assert.equal(r[0].key, "TM-1");
  });
});
