/**
 * weekly-ast.ts unit tests.
 *
 * Validates:
 *   - ADF tree (TM-2727 nested bulletList) → AST with correct nesting + level
 *   - plain text (TM-2853 markers + flat bullets) → AST with detected sections
 *   - plain text indent preservation → nested item structure
 *   - traverseAst context propagation (parentPhase 전달)
 *   - partitionBySections section grouping
 *
 * Fixtures from tests/fixtures/ (live JIRA data snapshot — 2026-05-21).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildAstFromAdf,
  buildAstFromPlainText,
  traverseAst,
  partitionBySections,
  detectSectionMarker,
  type AstNode,
} from "../lib/weekly-ast";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function loadAdf(key: string) {
  return JSON.parse(readFileSync(join(FIXTURES, `${key}.cf_10625.adf.json`), "utf-8"));
}
function loadText(key: string) {
  return readFileSync(join(FIXTURES, `${key}.cf_10625.text.txt`), "utf-8");
}

// AST에서 특정 텍스트를 가진 item을 찾는 헬퍼
function findItem(node: AstNode, predicate: (text: string) => boolean): AstNode | null {
  if (node.kind === "item" && predicate(node.text)) return node;
  for (const c of node.children) {
    const r = findItem(c, predicate);
    if (r) return r;
  }
  return null;
}

// ─── buildAstFromAdf ──────────────────────────────────────────

describe("buildAstFromAdf — TM-2727 (nested bulletList)", () => {
  const adf = loadAdf("TM-2727");
  const ast = buildAstFromAdf(adf);

  test("root is doc with multiple top-level children", () => {
    assert.equal(ast.kind, "doc");
    assert.equal(ast.level, 0);
    assert.ok(ast.children.length >= 1, "doc should have children");
  });

  test("parent item '잔여 개발 사항' has nested list with 1 child", () => {
    const item = findItem(ast, t => t.startsWith("잔여 개발"));
    assert.ok(item, "'잔여 개발 사항' item exists");
    assert.equal(item!.kind, "item");
    assert.equal(item!.level, 1);
    // 자식: nested list (kind=list) 안에 1개의 item
    const childLists = item!.children.filter(c => c.kind === "list");
    assert.equal(childLists.length, 1, "exactly one nested list under '잔여 개발 사항'");
    const childItems = childLists[0].children.filter(c => c.kind === "item");
    assert.equal(childItems.length, 1);
    assert.ok(childItems[0].text.includes("CEE 피처플래그 적용 배포"));
    assert.equal(childItems[0].level, 2);
  });

  test("parent item 'QA' has nested list with 4 children at L2", () => {
    const item = findItem(ast, t => t.trim() === "QA");
    assert.ok(item, "'QA' item exists");
    assert.equal(item!.kind, "item");
    assert.equal(item!.level, 1);
    const childLists = item!.children.filter(c => c.kind === "list");
    assert.equal(childLists.length, 1);
    const childItems = childLists[0].children.filter(c => c.kind === "item");
    assert.equal(childItems.length, 4, "QA should have 4 nested children");
    // 모든 자식이 L2여야 함
    assert.ok(childItems.every(c => c.level === 2));
    // 텍스트 순서 검증
    assert.ok(childItems[0].text.includes("테스트브리프"));
    assert.ok(childItems[1].text.includes("파트너 어드민 QA"));
    assert.ok(childItems[2].text.includes("유저단 QA"));
    assert.ok(childItems[3].text.includes("통합 QA"));
  });

  test("sibling milestone item '...sign-off 후 오후 배포 목표' is L1", () => {
    const item = findItem(ast, t => t.includes("sign-off"));
    assert.ok(item);
    assert.equal(item!.level, 1);
    // 자식 list 없음
    assert.equal(item!.children.filter(c => c.kind === "list").length, 0);
  });
});

describe("buildAstFromAdf — TM-2756 (flat paragraphs + 1 list)", () => {
  const adf = loadAdf("TM-2756");
  const ast = buildAstFromAdf(adf);

  test("contains 2 standalone paragraphs (yellow 유지, PTG plan)", () => {
    const paras = ast.children.filter(c => c.kind === "para");
    assert.ok(paras.length >= 2, `expected >=2 standalone paragraphs, got ${paras.length}`);
    const yellowPara = paras.find(p => p.text.includes("yellow 유지"));
    const ptgPara = paras.find(p => p.text.includes("PTG plan"));
    assert.ok(yellowPara);
    assert.ok(ptgPara);
  });

  test("contains 1 list with 3 items (기획/디자인/개발)", () => {
    const lists = ast.children.filter(c => c.kind === "list");
    assert.equal(lists.length, 1);
    const items = lists[0].children.filter(c => c.kind === "item");
    assert.equal(items.length, 3);
    assert.ok(items[0].text.startsWith("기획"));
    assert.ok(items[1].text.startsWith("디자인"));
    assert.ok(items[2].text.startsWith("개발"));
  });
});

// ─── buildAstFromPlainText (indent 보존 정상 nesting) ────────

describe("buildAstFromPlainText — TM-2727 (indent-preserved text round-trip)", () => {
  const text = loadText("TM-2727");
  const ast = buildAstFromPlainText(text);

  test("QA item has 4 nested children at L2 (round-trip via indented text)", () => {
    const qa = findItem(ast, t => t.trim() === "QA");
    assert.ok(qa);
    const childLists = qa!.children.filter(c => c.kind === "list");
    assert.equal(childLists.length, 1);
    const childItems = childLists[0].children.filter(c => c.kind === "item");
    assert.equal(childItems.length, 4);
    assert.ok(childItems.every(c => c.level === 2));
  });

  test("잔여 개발 사항 child '...CEE 피처플래그 적용 배포' is L2", () => {
    const parent = findItem(ast, t => t.startsWith("잔여 개발"));
    assert.ok(parent);
    const lists = parent!.children.filter(c => c.kind === "list");
    assert.equal(lists.length, 1);
    const child = lists[0].children[0];
    assert.equal(child.level, 2);
    assert.ok(child.text.includes("CEE 피처플래그"));
  });
});

describe("buildAstFromPlainText — TM-2853 (section markers + flat bullets)", () => {
  const text = loadText("TM-2853");
  const ast = buildAstFromPlainText(text);

  test("detects <진행상황> + <일정> as section markers", () => {
    const markers = ast.children.filter(c => c.kind === "marker");
    assert.equal(markers.length, 2);
    assert.equal(markers[0].section, "progress");
    assert.equal(markers[1].section, "schedule");
  });

  test("has 2 lists (one per section) with correct items", () => {
    const lists = ast.children.filter(c => c.kind === "list");
    assert.equal(lists.length, 2);
    // 진행상황 list: 1 item
    assert.equal(lists[0].children.filter(c => c.kind === "item").length, 1);
    // 일정 list: 2 items
    const scheduleItems = lists[1].children.filter(c => c.kind === "item");
    assert.equal(scheduleItems.length, 2);
    assert.ok(scheduleItems[0].text.includes("O-SKU 통합 QA"));
    assert.ok(scheduleItems[1].text.includes("Launch"));
  });
});

// ─── detectSectionMarker ──────────────────────────────────────

describe("detectSectionMarker", () => {
  test("recognizes bracket markers", () => {
    assert.equal(detectSectionMarker("[일정]")?.section, "schedule");
    assert.equal(detectSectionMarker("[진행상황]")?.section, "progress");
    assert.equal(detectSectionMarker("[이슈/리스크]")?.section, "risk");
    assert.equal(detectSectionMarker("[다음 액션]")?.section, "nextAction");
  });
  test("recognizes angle bracket markers", () => {
    assert.equal(detectSectionMarker("<진행상황>")?.section, "progress");
    assert.equal(detectSectionMarker("<일정>")?.section, "schedule");
  });
  test("rejects non-marker text", () => {
    assert.equal(detectSectionMarker("기획 : CBP 5/21 ..."), null);
    assert.equal(detectSectionMarker("[기타]"), null);  // "기타"는 our SECTION_GROUP에 없음
    assert.equal(detectSectionMarker(""), null);
  });
});

// ─── partitionBySections ──────────────────────────────────────

describe("partitionBySections — TM-2853", () => {
  const ast = buildAstFromPlainText(loadText("TM-2853"));
  const { sections, unsectioned, hasAnyMarker } = partitionBySections(ast);

  test("hasAnyMarker === true", () => {
    assert.equal(hasAnyMarker, true);
  });

  test("progress section contains 1 list", () => {
    assert.equal(sections.progress.length, 1);
  });

  test("schedule section contains 1 list with 2 items", () => {
    assert.equal(sections.schedule.length, 1);
    const items = sections.schedule[0].children.filter(c => c.kind === "item");
    assert.equal(items.length, 2);
  });

  test("unsectioned is empty (markers detected from start)", () => {
    assert.equal(unsectioned.length, 0);
  });
});

describe("partitionBySections — TM-2727 (no markers)", () => {
  const ast = buildAstFromPlainText(loadText("TM-2727"));
  const { hasAnyMarker, unsectioned } = partitionBySections(ast);

  test("hasAnyMarker === false (no [일정]/<진행상황> markers)", () => {
    assert.equal(hasAnyMarker, false);
  });

  test("all children go to unsectioned", () => {
    assert.ok(unsectioned.length > 0);
  });
});

// ─── traverseAst with context propagation ────────────────────

describe("traverseAst — context propagation", () => {
  test("parentPhase propagates from QA item to child items", () => {
    const adf = loadAdf("TM-2727");
    const ast = buildAstFromAdf(adf);
    const visits: Array<{ text: string; parentPhase: string | undefined; level: number }> = [];

    traverseAst(ast, { itemPath: [], parentPhase: undefined, parentText: undefined }, (node, ctx) => {
      visits.push({ text: node.text, parentPhase: ctx.parentPhase, level: node.level });
      // 부모 item이 "QA"이면 자식들에게 propagate
      if (node.text.trim() === "QA") return { propagatePhase: "QA" };
      return undefined;
    });

    // "QA" 자식 4개 모두 ctx.parentPhase === "QA"여야 함
    const qaChildren = visits.filter(v => v.level === 2 && (
      v.text.includes("테스트브리프") ||
      v.text.includes("파트너 어드민 QA") ||
      v.text.includes("유저단 QA") ||
      v.text.includes("통합 QA")
    ));
    assert.equal(qaChildren.length, 4, "should visit 4 QA children");
    assert.ok(qaChildren.every(v => v.parentPhase === "QA"),
      `all QA children should have parentPhase=QA. got: ${JSON.stringify(qaChildren.map(v => ({t: v.text.slice(0, 30), p: v.parentPhase})))}`);
  });

  test("itemPath builds correctly for nested children", () => {
    const adf = loadAdf("TM-2727");
    const ast = buildAstFromAdf(adf);
    let testBriefPath: string[] | null = null;
    traverseAst(ast, { itemPath: [], parentPhase: undefined, parentText: undefined }, (node, ctx) => {
      if (node.text.includes("테스트브리프")) {
        testBriefPath = ctx.itemPath;
      }
      return undefined;
    });
    assert.ok(testBriefPath !== null);
    assert.deepEqual(testBriefPath, ["QA"], "테스트브리프 itemPath should be ['QA']");
  });
});
