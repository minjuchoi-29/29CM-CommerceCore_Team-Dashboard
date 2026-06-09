/**
 * lib/jira-remotelinks.ts unit tests.
 *
 * Jira API 응답의 다양한 정상/이상 케이스에서 정규화가 안정적인지 보호.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeRemoteLinks } from "../lib/jira-remotelinks";

describe("normalizeRemoteLinks — 정상 응답", () => {
  it("표준 Jira remotelink 응답을 정규화", () => {
    const raw = [
      {
        id: 10001,
        self: "https://x/.../remotelink/10001",
        object: {
          url: "https://oneteam.atlassian.net/wiki/spaces/A/pages/1",
          title: "[Decision] 핀페이 종료 및 무신사페이 전환 전략",
        },
      },
    ];
    const out = normalizeRemoteLinks(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].url, "https://oneteam.atlassian.net/wiki/spaces/A/pages/1");
    assert.equal(out[0].title, "[Decision] 핀페이 종료 및 무신사페이 전환 전략");
  });

  it("여러 항목 모두 정규화", () => {
    const raw = [
      { object: { url: "https://a.com/1", title: "A" } },
      { object: { url: "https://b.com/2", title: "B" } },
    ];
    const out = normalizeRemoteLinks(raw);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map(l => l.title), ["A", "B"]);
  });
});

describe("normalizeRemoteLinks — object.url 누락/빈값 skip", () => {
  it("object.url 없음 → skip", () => {
    const raw = [
      { object: { title: "no url" } },
      { object: { url: "https://valid.com/x", title: "valid" } },
    ];
    const out = normalizeRemoteLinks(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, "valid");
  });

  it("object.url 빈 문자열 → skip", () => {
    const raw = [{ object: { url: "", title: "blank" } }];
    const out = normalizeRemoteLinks(raw);
    assert.equal(out.length, 0);
  });

  it("object.url 공백만 → skip", () => {
    const raw = [{ object: { url: "   ", title: "ws" } }];
    const out = normalizeRemoteLinks(raw);
    assert.equal(out.length, 0);
  });

  it("object.url 가 문자열이 아닌 타입 → skip", () => {
    const raw = [{ object: { url: 12345, title: "num" } }];
    const out = normalizeRemoteLinks(raw);
    assert.equal(out.length, 0);
  });
});

describe("normalizeRemoteLinks — title fallback", () => {
  it("title 누락 → URL path 마지막 segment fallback", () => {
    const raw = [{ object: { url: "https://example.com/docs/proposal" } }];
    const out = normalizeRemoteLinks(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, "proposal");
  });

  it("title 빈 문자열 → fallback", () => {
    const raw = [{ object: { url: "https://example.com/abc", title: "" } }];
    const out = normalizeRemoteLinks(raw);
    assert.equal(out[0].title, "abc");
  });

  it("title 공백만 → fallback", () => {
    const raw = [{ object: { url: "https://example.com/abc", title: "   " } }];
    const out = normalizeRemoteLinks(raw);
    assert.equal(out[0].title, "abc");
  });

  it("URL path 가 없으면 hostname fallback", () => {
    const raw = [{ object: { url: "https://example.com" } }];
    const out = normalizeRemoteLinks(raw);
    assert.equal(out[0].title, "example.com");
  });

  it("title 이 한국어 정상값이면 그대로 유지", () => {
    const raw = [{ object: { url: "https://x.com/a", title: "[결정] 무신사페이 전환" } }];
    const out = normalizeRemoteLinks(raw);
    assert.equal(out[0].title, "[결정] 무신사페이 전환");
  });
});

describe("normalizeRemoteLinks — URL dedupe (PR-A 내부 우선순위)", () => {
  it("같은 URL 중복 → 첫 번째 유지", () => {
    const raw = [
      { object: { url: "https://x.com/a", title: "first" } },
      { object: { url: "https://x.com/a", title: "second" } },
    ];
    const out = normalizeRemoteLinks(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, "first");
  });

  it("URL 정규화 — trailing slash 무시", () => {
    const raw = [
      { object: { url: "https://x.com/a", title: "no slash" } },
      { object: { url: "https://x.com/a/", title: "with slash" } },
    ];
    const out = normalizeRemoteLinks(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, "no slash");
  });

  it("URL 정규화 — case insensitive", () => {
    const raw = [
      { object: { url: "https://X.COM/A", title: "upper" } },
      { object: { url: "https://x.com/a", title: "lower" } },
    ];
    const out = normalizeRemoteLinks(raw);
    assert.equal(out.length, 1);
    // 첫 번째 entry 의 원본 URL 보존 (정규화는 비교용)
    assert.equal(out[0].url, "https://X.COM/A");
  });
});

describe("normalizeRemoteLinks — 비정상 입력 방어", () => {
  it("null 입력 → []", () => {
    assert.deepEqual(normalizeRemoteLinks(null), []);
  });

  it("undefined 입력 → []", () => {
    assert.deepEqual(normalizeRemoteLinks(undefined), []);
  });

  it("배열 아닌 input → []", () => {
    assert.deepEqual(normalizeRemoteLinks({ object: { url: "x" } }), []);
    assert.deepEqual(normalizeRemoteLinks("string"), []);
    assert.deepEqual(normalizeRemoteLinks(123), []);
  });

  it("object 없는 entry → skip", () => {
    const raw = [{ id: 1 }, { object: { url: "https://valid.com/x", title: "valid" } }];
    const out = normalizeRemoteLinks(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, "valid");
  });

  it("null entry → skip", () => {
    const raw = [null, { object: { url: "https://valid.com/x", title: "valid" } }];
    const out = normalizeRemoteLinks(raw);
    assert.equal(out.length, 1);
  });

  it("빈 배열 → []", () => {
    assert.deepEqual(normalizeRemoteLinks([]), []);
  });
});
