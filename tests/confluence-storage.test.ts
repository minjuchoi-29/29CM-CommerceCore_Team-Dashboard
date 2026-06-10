/**
 * lib/confluence-storage.ts contract tests.
 *
 * 보호 invariants:
 *  - storage XML → plain text 변환 안정성
 *  - ticket key 검색 word boundary 정확성 (CMALL-78 ≠ CMALL-784)
 *  - snippet 추출 radius / ellipsis 동작
 *  - 빈 / 비정상 입력 안전 처리
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  storageToText,
  findTicketKeys,
  hasTicketKey,
  extractSnippet,
} from "../lib/confluence-storage";

describe("storageToText — XML → plain text", () => {
  it("단순 <p> 변환", () => {
    const out = storageToText("<p>hello</p>");
    assert.equal(out, "hello");
  });

  it("heading → ## marker", () => {
    const out = storageToText("<h2>제목</h2><p>본문</p>");
    assert.ok(out.includes("## 제목"));
    assert.ok(out.includes("본문"));
  });

  it("list item → bullet", () => {
    const out = storageToText("<ul><li>첫번째</li><li>두번째</li></ul>");
    assert.ok(out.includes("• 첫번째"));
    assert.ok(out.includes("• 두번째"));
  });

  it("<br> → 줄바꿈", () => {
    const out = storageToText("a<br/>b<br />c");
    assert.ok(out.includes("a"));
    assert.ok(out.includes("b"));
    assert.ok(out.includes("c"));
    assert.ok(out.includes("\n"));
  });

  it("HTML entity 디코드", () => {
    const out = storageToText("<p>A &amp; B &lt;test&gt; &quot;x&quot; &#39;y&#39; &nbsp; end</p>");
    assert.ok(out.includes("A & B"));
    assert.ok(out.includes("<test>"));
    assert.ok(out.includes('"x"'));
    assert.ok(out.includes("'y'"));
  });

  it("<ac:structured-macro> 본문 제거 — macro 내부 노이즈 안 보임", () => {
    const out = storageToText(
      "<p>before</p><ac:structured-macro ac:name=\"info\"><ac:rich-text-body><p>macro body</p></ac:rich-text-body></ac:structured-macro><p>after</p>",
    );
    assert.ok(out.includes("before"));
    assert.ok(out.includes("after"));
    assert.ok(!out.includes("macro body"));
  });

  it("3+ 연속 줄바꿈 → 2개로 축소", () => {
    const out = storageToText("<p>a</p><p></p><p></p><p></p><p>b</p>");
    assert.ok(!/\n{3,}/.test(out));
  });

  it("빈 / non-string 입력 → 빈 문자열", () => {
    assert.equal(storageToText(""), "");
    // @ts-expect-error 타입 우회 테스트
    assert.equal(storageToText(null), "");
    // @ts-expect-error 타입 우회 테스트
    assert.equal(storageToText(undefined), "");
  });

  it("실제 ELT F/U 패턴 — heading + bullet 혼합", () => {
    const xml = "<h2>2026-Q1</h2><ul><li>CMALL-784 결제 흰화면 대응</li><li>CMALL-794 핀페이 종료</li></ul>";
    const out = storageToText(xml);
    assert.ok(out.includes("## 2026-Q1"));
    assert.ok(out.includes("CMALL-784"));
    assert.ok(out.includes("CMALL-794"));
  });
});

describe("findTicketKeys — Jira key 추출", () => {
  it("단일 key 발견", () => {
    const out = findTicketKeys("작업 중: CMALL-784 결제 대응");
    assert.deepEqual(out, ["CMALL-784"]);
  });

  it("여러 project 동시 발견 + 원문 순서 유지", () => {
    const out = findTicketKeys("- TM-2924\n- CMALL-784\n- M29CMOD-101");
    assert.deepEqual(out, ["TM-2924", "CMALL-784", "M29CMOD-101"]);
  });

  it("중복 제거", () => {
    const out = findTicketKeys("CMALL-784 / CMALL-784 / CMALL-784");
    assert.deepEqual(out, ["CMALL-784"]);
  });

  it("소문자 prefix 는 무시 (Jira key 는 대문자)", () => {
    const out = findTicketKeys("cmall-784 도 있지만 CMALL-794 가 진짜");
    assert.deepEqual(out, ["CMALL-794"]);
  });

  it("숫자만 / hyphen 없음 → 매칭 안 함", () => {
    const out = findTicketKeys("just 784 or NOPATTERN here");
    assert.deepEqual(out, []);
  });

  it("빈 / non-string 입력 → []", () => {
    assert.deepEqual(findTicketKeys(""), []);
    // @ts-expect-error 타입 우회 테스트
    assert.deepEqual(findTicketKeys(null), []);
  });
});

describe("hasTicketKey — 정확한 word boundary 매칭", () => {
  it("정확 매칭", () => {
    assert.equal(hasTicketKey("관련: CMALL-784", "CMALL-784"), true);
  });

  it("CMALL-78 검색 시 CMALL-784 매칭되지 않음 (word boundary)", () => {
    assert.equal(hasTicketKey("only CMALL-784 here", "CMALL-78"), false);
  });

  it("CMALL-784 검색 시 CMALL-7840 매칭되지 않음", () => {
    assert.equal(hasTicketKey("only CMALL-7840 here", "CMALL-784"), false);
  });

  it("미존재 → false", () => {
    assert.equal(hasTicketKey("CMALL-784", "CMALL-999"), false);
  });

  it("빈 입력 → false", () => {
    assert.equal(hasTicketKey("", "CMALL-1"), false);
    assert.equal(hasTicketKey("text", ""), false);
  });

  it("RegExp metachar 안전 처리", () => {
    // ticket key 에 ".*" 같은 metachar 가 들어와도 literal 매칭
    assert.equal(hasTicketKey("CMALL-784", "CMA.*-784"), false);
  });
});

describe("extractSnippet — surrounding 텍스트 추출", () => {
  it("기본 동작 — ±200자 default", () => {
    const text = "x".repeat(300) + " CMALL-784 결제 대응 " + "y".repeat(300);
    const snippet = extractSnippet(text, "CMALL-784");
    assert.ok(snippet);
    assert.ok(snippet!.includes("CMALL-784"));
    assert.ok(snippet!.startsWith("…"));
    assert.ok(snippet!.endsWith("…"));
  });

  it("앞쪽이 짧으면 시작 ellipsis 없음", () => {
    const text = "CMALL-784 결제 대응 " + "y".repeat(300);
    const snippet = extractSnippet(text, "CMALL-784");
    assert.ok(!snippet!.startsWith("…"));
    assert.ok(snippet!.endsWith("…"));
  });

  it("뒤쪽이 짧으면 끝 ellipsis 없음", () => {
    const text = "x".repeat(300) + " CMALL-784";
    const snippet = extractSnippet(text, "CMALL-784");
    assert.ok(snippet!.startsWith("…"));
    assert.ok(!snippet!.endsWith("…"));
  });

  it("custom radius 적용", () => {
    const text = "x".repeat(50) + " CMALL-784 " + "y".repeat(50);
    const snippet = extractSnippet(text, "CMALL-784", 10);
    assert.ok(snippet!.includes("CMALL-784"));
    // radius 10 이므로 50개 x 가 다 들어오면 안 됨
    assert.ok(snippet!.length < 50);
  });

  it("미존재 → null", () => {
    const snippet = extractSnippet("only CMALL-999 here", "CMALL-784");
    assert.equal(snippet, null);
  });

  it("빈 입력 → null", () => {
    assert.equal(extractSnippet("", "CMALL-784"), null);
    assert.equal(extractSnippet("text", ""), null);
  });

  it("실제 ELT F/U 시나리오", () => {
    const text =
      "## 2026-Q1\n" +
      "• CMALL-784 결제 실패 흰화면 UX 대응 중\n" +
      "• CMALL-794 핀페이 종료 및 무신사페이 전환\n" +
      "• TM-2924 OCMP 통합 고객센터";
    const snippet = extractSnippet(text, "CMALL-784", 50);
    assert.ok(snippet!.includes("CMALL-784"));
    assert.ok(snippet!.includes("결제"));
  });
});

describe("integration — storage XML → 검색 → snippet round-trip", () => {
  it("실제 흐름", () => {
    const xml = "<h2>Backlog</h2><ul><li>CMALL-784 결제 흰화면</li><li>CMALL-794 핀페이</li></ul>";
    const text = storageToText(xml);
    const keys = findTicketKeys(text);
    assert.deepEqual(keys.sort(), ["CMALL-784", "CMALL-794"]);
    assert.equal(hasTicketKey(text, "CMALL-784"), true);
    const snippet = extractSnippet(text, "CMALL-784", 30);
    assert.ok(snippet!.includes("CMALL-784"));
    assert.ok(snippet!.includes("결제"));
  });
});
