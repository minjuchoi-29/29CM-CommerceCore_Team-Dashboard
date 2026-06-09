/**
 * lib/etr-links.ts — dedupe priority tests (PR-B 변경 검증).
 *
 * 우선순위 (PR-B 신규):
 *   self > remotelink > tm
 *
 * collectLinkedDocs 의 remoteLinks 옵션 파라미터도 함께 검증.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dedupeDocsByUrl, collectLinkedDocs, type LinkedDoc } from "../lib/etr-links";

describe("dedupeDocsByUrl — source 우선순위", () => {
  it("self > remotelink — self 가 유지됨", () => {
    const docs: LinkedDoc[] = [
      { url: "https://x.com/a", title: "from remote", type: "Other", source: { kind: "remotelink" } },
      { url: "https://x.com/a", title: "from self",   type: "Other", source: { kind: "self" } },
    ];
    const out = dedupeDocsByUrl(docs);
    assert.equal(out.length, 1);
    assert.equal(out[0].source.kind, "self");
    assert.equal(out[0].title, "from self");
  });

  it("self > tm — self 가 유지됨 (기존 동작 보존)", () => {
    const docs: LinkedDoc[] = [
      { url: "https://x.com/a", title: "from tm",   type: "Other", source: { kind: "tm", tmKey: "TM-1" } },
      { url: "https://x.com/a", title: "from self", type: "Other", source: { kind: "self" } },
    ];
    const out = dedupeDocsByUrl(docs);
    assert.equal(out.length, 1);
    assert.equal(out[0].source.kind, "self");
  });

  it("remotelink > tm — remotelink 가 유지됨", () => {
    const docs: LinkedDoc[] = [
      { url: "https://x.com/a", title: "from tm",     type: "Other", source: { kind: "tm", tmKey: "TM-1" } },
      { url: "https://x.com/a", title: "from remote", type: "Other", source: { kind: "remotelink" } },
    ];
    const out = dedupeDocsByUrl(docs);
    assert.equal(out.length, 1);
    assert.equal(out[0].source.kind, "remotelink");
  });

  it("input 순서가 우선순위에 영향 없음 (self 가 뒤에 있어도 우선)", () => {
    const docs: LinkedDoc[] = [
      { url: "https://x.com/a", title: "from tm",     type: "Other", source: { kind: "tm", tmKey: "TM-1" } },
      { url: "https://x.com/a", title: "from remote", type: "Other", source: { kind: "remotelink" } },
      { url: "https://x.com/a", title: "from self",   type: "Other", source: { kind: "self" } },
    ];
    const out = dedupeDocsByUrl(docs);
    assert.equal(out.length, 1);
    assert.equal(out[0].source.kind, "self");
  });

  it("같은 source.kind 중복은 첫 번째 유지", () => {
    const docs: LinkedDoc[] = [
      { url: "https://x.com/a", title: "first remote",  type: "Other", source: { kind: "remotelink" } },
      { url: "https://x.com/a", title: "second remote", type: "Other", source: { kind: "remotelink" } },
    ];
    const out = dedupeDocsByUrl(docs);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, "first remote");
  });

  it("URL 정규화 — trailing slash 무시", () => {
    const docs: LinkedDoc[] = [
      { url: "https://x.com/a",  title: "no slash",   type: "Other", source: { kind: "tm", tmKey: "TM-1" } },
      { url: "https://x.com/a/", title: "with slash", type: "Other", source: { kind: "self" } },
    ];
    const out = dedupeDocsByUrl(docs);
    assert.equal(out.length, 1);
    assert.equal(out[0].source.kind, "self");
  });

  it("서로 다른 URL 은 모두 유지", () => {
    const docs: LinkedDoc[] = [
      { url: "https://x.com/a", title: "a", type: "Other", source: { kind: "self" } },
      { url: "https://x.com/b", title: "b", type: "Other", source: { kind: "remotelink" } },
      { url: "https://x.com/c", title: "c", type: "Other", source: { kind: "tm", tmKey: "TM-1" } },
    ];
    const out = dedupeDocsByUrl(docs);
    assert.equal(out.length, 3);
  });
});

describe("collectLinkedDocs — remoteLinks 옵션 파라미터", () => {
  const reverseMap = new Map();
  const etrMap = {} as Record<string, { etrTickets?: { key: string }[]; wikiLinks?: { url: string; title: string }[] }>;
  const ticketByKey = new Map<string, { key: string; summary: string; status: string; type: string }>();
  ticketByKey.set("ETR-1", { key: "ETR-1", summary: "test", status: "검토중", type: "Request" });

  it("remoteLinks 미전달 → 기존 동작 (self + tm 만)", () => {
    const out = collectLinkedDocs("ETR-1", reverseMap, etrMap, ticketByKey);
    assert.deepEqual(out, []);
  });

  it("remoteLinks 전달 → source.kind=remotelink 로 편입", () => {
    const out = collectLinkedDocs("ETR-1", reverseMap, etrMap, ticketByKey, [
      { url: "https://example.com/decision", title: "[Decision] X" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].source.kind, "remotelink");
    assert.equal(out[0].title, "[Decision] X");
    assert.equal(out[0].url, "https://example.com/decision");
  });

  it("remoteLinks 빈 배열 → 결과 영향 없음", () => {
    const out = collectLinkedDocs("ETR-1", reverseMap, etrMap, ticketByKey, []);
    assert.deepEqual(out, []);
  });

  it("self twoPagerUrl 과 remoteLink 가 같은 URL → self 가 dedupe 우선", () => {
    const ticketByKeyWith2P = new Map(ticketByKey);
    ticketByKeyWith2P.set("ETR-1", {
      key: "ETR-1", summary: "x", status: "검토중", type: "Request",
      // @ts-expect-error TicketLike 의 optional field — 테스트용 캐스팅
      twoPagerUrl: "https://x.com/page",
    });
    const out = collectLinkedDocs(
      "ETR-1", reverseMap, etrMap, ticketByKeyWith2P,
      [{ url: "https://x.com/page", title: "remote title" }],
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].source.kind, "self");
  });
});
