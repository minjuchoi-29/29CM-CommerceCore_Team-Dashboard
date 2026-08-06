import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { organizeLinkedDocs } from "../lib/linked-doc-display";
import type { LinkedDoc } from "../lib/etr-links";

const doc = (title: string, index: number): LinkedDoc => ({
  title,
  url: `https://wiki.example/${index}`,
  type: "Wiki",
  source: { kind: "remotelink" },
});

describe("organizeLinkedDocs", () => {
  it("반복 Weekly 문서는 최신본만 기본 목록 상단에 노출", () => {
    const docs = [
      doc("[2026-06-15 Weekly flash prep]", 1),
      doc("제품 정책서", 2),
      doc("[2026-06-29 Weekly flash prep]", 3),
      doc("[2026-06-22 Weekly flash prep]", 4),
    ];
    const result = organizeLinkedDocs(docs, 6);

    assert.equal(result.visible[0].title, "[2026-06-29 Weekly flash prep]");
    assert.equal(result.visible[0].isLatestWeekly, true);
    assert.deepEqual(result.hidden.map(item => item.title), [
      "[2026-06-22 Weekly flash prep]",
      "[2026-06-15 Weekly flash prep]",
    ]);
  });

  it("기본 6개를 넘는 문서는 펼침 목록으로 분리", () => {
    const result = organizeLinkedDocs(Array.from({ length: 9 }, (_, i) => doc(`문서 ${i + 1}`, i)), 6);
    assert.equal(result.visible.length, 6);
    assert.equal(result.hidden.length, 3);
  });
});
