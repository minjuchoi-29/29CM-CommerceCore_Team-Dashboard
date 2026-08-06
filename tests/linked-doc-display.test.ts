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
    assert.deepEqual(result.hidden, []);
    assert.equal(result.omittedWeeklyCount, 2);
  });

  it("기본 6개를 넘는 문서는 펼침 목록으로 분리", () => {
    const result = organizeLinkedDocs(Array.from({ length: 9 }, (_, i) => doc(`문서 ${i + 1}`, i)), 6);
    assert.equal(result.visible.length, 6);
    assert.equal(result.hidden.length, 3);
    assert.equal(result.omittedWeeklyCount, 0);
  });

  it("펼친 목록에도 반복 Weekly 과거본을 다시 포함하지 않음", () => {
    const docs = [
      ...Array.from({ length: 8 }, (_, i) => doc(`일반 문서 ${i + 1}`, i)),
      doc("2026-07-20 Weekly flash prep", 20),
      doc("2026-07-27 Weekly flash prep", 21),
      doc("2026-08-03 Weekly flash prep", 22),
    ];
    const result = organizeLinkedDocs(docs, 6);
    const expanded = [...result.visible, ...result.hidden];

    assert.equal(expanded.filter(item => /Weekly flash prep/.test(item.title)).length, 1);
    assert.equal(expanded[0].title, "2026-08-03 Weekly flash prep");
    assert.equal(result.omittedWeeklyCount, 2);
  });

  it("TM-2215 형태의 22개 문서를 집중보기에서도 6개 + 펼침 10개로 정리", () => {
    const docs = [
      ...Array.from({ length: 15 }, (_, i) => doc(`일반 문서 ${i + 1}`, i)),
      ...["06-22", "06-29", "07-06", "07-13", "07-20", "07-27", "08-03"]
        .map((date, i) => doc(`2026-${date} Weekly flash prep`, 100 + i)),
    ];
    const result = organizeLinkedDocs(docs, 6);
    const expanded = [...result.visible, ...result.hidden];

    assert.equal(result.visible.length, 6);
    assert.equal(result.hidden.length, 10);
    assert.equal(result.omittedWeeklyCount, 6);
    assert.equal(expanded.length, 16);
    assert.equal(expanded.filter(item => /Weekly flash prep/.test(item.title)).length, 1);
  });
});
