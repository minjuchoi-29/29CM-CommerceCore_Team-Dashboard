/**
 * Weekly 공유사항 AST (Abstract Syntax Tree)
 *
 * 운영 목적:
 *   기존 line-flat parser pipeline에서 손실되던 hierarchy
 *   (ADF nested bulletList / plain text indentation / parent-child item)를
 *   structured tree로 보존해, parent phase context propagation을 가능하게 한다.
 *
 * 두 입력 경로:
 *   - ADF tree (customfield_10625 / description body): buildAstFromAdf
 *   - plain text (legacy fallback, comment archive): buildAstFromPlainText
 *
 * 정책 호환:
 *   - 기존 parseWeekly()의 output schema(ParsedWeekly)는 변경 없음.
 *   - 이 모듈은 weekly-parser.ts 내부에서만 호출되며, 외부 호출자/UI에는 영향 없음.
 *   - section marker([일정]/<진행상황> 등) 인식 + bullet hierarchy 유지가 두 핵심 책임.
 *
 * 순수 함수만 포함. KV/Redis/JIRA 호출 없음.
 */

// ─── 타입 ──────────────────────────────────────────────────────

export type AstNodeKind = "doc" | "list" | "item" | "para" | "marker";

/** Weekly 본문에 등장하는 표준 섹션 그룹. weekly-parser.SECTION_ALIASES와 1:1 대응. */
export type SectionGroup = "progress" | "schedule" | "risk" | "nextAction";

export interface AstNode {
  kind: AstNodeKind;
  /** tree depth (doc=0, top-level list/para=1, item=parent list level, nested item=parent item level + 1). */
  level: number;
  /**
   * 노드의 primary text.
   * - item: 첫 paragraph의 텍스트 (자식 list 제외)
   * - para: paragraph 텍스트
   * - marker: 원문 그대로 ("[일정]", "<진행상황>" 등)
   * - doc/list: 빈 문자열
   */
  text: string;
  /** 원문 (debug/Summary 렌더링에서 사용). */
  raw: string;
  /** kind === "list"에만 채워짐 */
  ordered?: boolean;
  /** kind === "marker"에만 채워짐 — 매핑된 표준 섹션 그룹 */
  section?: SectionGroup;
  /** kind === "marker"에만 채워짐 — 매치된 alias 원문 (debug) */
  markerAlias?: string;
  children: AstNode[];
}

// ─── ADF 처리 ──────────────────────────────────────────────────

type AdfNode = {
  type?: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
};

/** ADF subtree의 모든 text leaf를 모아 하나의 문자열로 반환. paragraph/listItem 내부의 텍스트 추출용. */
function collectInlineText(node: AdfNode | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return " ";
  if (node.type === "mention") {
    const attrs = node.attrs as Record<string, unknown> | undefined;
    return attrs?.text ? `@${attrs.text}` : "";
  }
  if (Array.isArray(node.content)) return node.content.map(collectInlineText).join("");
  return "";
}

/**
 * ADF document → AST.
 *
 * 변환 규칙:
 *   doc                 → doc(level=0)
 *   bulletList          → list(level=parent.level + 1, ordered=false)
 *   orderedList         → list(level=parent.level + 1, ordered=true)
 *   listItem            → item(level=list.level)
 *                          첫 paragraph 텍스트 = item.text
 *                          이후 paragraph = item.children에 para로
 *                          nested bulletList = item.children에 list로 (재귀)
 *   paragraph (list 밖) → para(level=parent.level + 1)
 *                          단, text가 section marker 패턴이면 marker로 변환
 *   기타 block          → text만 뽑아 para로 흡수 (codeBlock, panel 등)
 */
export function buildAstFromAdf(adfDoc: AdfNode | null | undefined): AstNode {
  const root: AstNode = { kind: "doc", level: 0, text: "", raw: "", children: [] };
  if (!adfDoc || !Array.isArray(adfDoc.content)) return root;

  function walk(node: AdfNode, parent: AstNode, parentLevel: number): void {
    const t = node.type;
    if (t === "bulletList" || t === "orderedList") {
      const list: AstNode = {
        kind: "list",
        level: parentLevel + 1,
        text: "",
        raw: "",
        ordered: t === "orderedList",
        children: [],
      };
      parent.children.push(list);
      for (const c of node.content ?? []) walk(c, list, list.level);
      return;
    }
    if (t === "listItem") {
      const item: AstNode = {
        kind: "item",
        level: parentLevel,
        text: "",
        raw: "",
        children: [],
      };
      parent.children.push(item);
      let firstParaConsumed = false;
      for (const c of node.content ?? []) {
        if (c.type === "paragraph") {
          const text = collectInlineText(c).trim();
          if (!firstParaConsumed) {
            item.text = text;
            item.raw = text;
            firstParaConsumed = true;
          } else if (text) {
            item.children.push({
              kind: "para",
              level: parentLevel + 1,
              text,
              raw: text,
              children: [],
            });
          }
        } else if (c.type === "bulletList" || c.type === "orderedList") {
          walk(c, item, parentLevel);
        } else {
          const text = collectInlineText(c).trim();
          if (text) {
            item.children.push({
              kind: "para",
              level: parentLevel + 1,
              text,
              raw: text,
              children: [],
            });
          }
        }
      }
      return;
    }
    if (t === "paragraph") {
      const text = collectInlineText(node).trim();
      if (!text) return;
      const marker = detectSectionMarker(text);
      if (marker) {
        parent.children.push({
          kind: "marker",
          level: parentLevel + 1,
          text,
          raw: text,
          section: marker.section,
          markerAlias: marker.alias,
          children: [],
        });
      } else {
        parent.children.push({
          kind: "para",
          level: parentLevel + 1,
          text,
          raw: text,
          children: [],
        });
      }
      return;
    }
    // doc, panel, expand, blockquote 등: descend
    if (Array.isArray(node.content)) {
      for (const c of node.content) walk(c, parent, parentLevel);
    }
  }

  for (const c of adfDoc.content) walk(c, root, 0);
  return root;
}

// ─── plain text 처리 ──────────────────────────────────────────

/**
 * plain text → AST.
 *
 * 입력 예 (TM-2853 cf_10625 텍스트):
 *   <진행상황>
 *   - 예정대로 5/20(수) 최종 론치 진행 예정
 *   <일정>
 *   - O-SKU 통합 QA: 5/15 완료
 *   - Launch: 5/20 예정
 *
 * 룰:
 *   - 줄 단위 분리
 *   - "[...]" / "<...>" / 줄 단독 alias → section marker 검사 → marker
 *   - 좌측 whitespace + bullet glyph(-/*\/•/·/●/○/◦) 패턴 → list item
 *     level = floor(leading-whitespace / 2) + 1 (2-space indent 단위 가정)
 *   - 그 외 → para
 *
 * 같은 level의 연속된 item은 하나의 list로 묶이고, level이 바뀌면 list가 새로 시작된다.
 * (단, 본 구현은 nested list가 plain text에서 흔하지 않다는 운영 관찰 기반의 단순화.)
 */
export function buildAstFromPlainText(text: string): AstNode {
  const root: AstNode = { kind: "doc", level: 0, text: "", raw: "", children: [] };
  if (!text) return root;
  const lines = text.split(/\r?\n/);

  // Nesting stack — top은 현재 활성 list. 깊은 indent를 만나면 마지막 item 아래에 새 list를 만들어 push.
  // 얕은 indent를 만나면 stack을 pop해서 해당 level까지 거슬러 올라간다.
  // marker / para / blank line 만나면 stack 초기화 (list 컨텍스트 종료).
  type Frame = { list: AstNode; lastItem: AstNode | null };
  const stack: Frame[] = [];

  for (const rawLine of lines) {
    if (!rawLine.trim()) {
      stack.length = 0;
      continue;
    }
    const trimmed = rawLine.trim();

    // section marker
    const marker = detectSectionMarker(trimmed);
    if (marker) {
      stack.length = 0;
      root.children.push({
        kind: "marker",
        level: 1,
        text: trimmed,
        raw: rawLine,
        section: marker.section,
        markerAlias: marker.alias,
        children: [],
      });
      continue;
    }

    // bullet
    const bm = rawLine.match(/^([ \t]*)([\-*•·●○◦])\s+(.*)$/);
    if (bm) {
      const indent = bm[1].length;
      const content = bm[3].trim();
      const level = Math.floor(indent / 2) + 1;

      // 1) 얕은 indent로 돌아간 경우: 깊은 frame 모두 pop
      while (stack.length > 0 && stack[stack.length - 1].list.level > level) {
        stack.pop();
      }

      let topFrame: Frame | undefined = stack[stack.length - 1];

      if (!topFrame || topFrame.list.level < level) {
        // 2) 이 level의 list가 없으면 새로 생성:
        //    - 위에 frame이 있고 lastItem이 있으면 그 아래에 nest
        //    - 그 외엔 root에 직접 (orphan deeper bullet — rare in real data)
        const newList: AstNode = {
          kind: "list",
          level,
          text: "",
          raw: "",
          ordered: false,
          children: [],
        };
        if (topFrame && topFrame.lastItem) {
          topFrame.lastItem.children.push(newList);
        } else {
          root.children.push(newList);
        }
        stack.push({ list: newList, lastItem: null });
        topFrame = stack[stack.length - 1];
      }

      // 3) topFrame.list.level === level 보장됨 → item push
      const item: AstNode = {
        kind: "item",
        level,
        text: content,
        raw: rawLine,
        children: [],
      };
      topFrame.list.children.push(item);
      topFrame.lastItem = item;
      continue;
    }

    // plain paragraph — list 컨텍스트 종료
    stack.length = 0;
    root.children.push({
      kind: "para",
      level: 1,
      text: trimmed,
      raw: rawLine,
      children: [],
    });
  }

  return root;
}

// ─── section marker 인식 ──────────────────────────────────────

/**
 * section marker alias — weekly-parser.SECTION_ALIASES와 1:1 동기화.
 * 동기화 대상이므로 가급적 weekly-parser 측 단일 소스로 통일하는 게 이상적이지만,
 * 모듈 간 import cycle을 피하기 위해 여기에 복제 + 정책 변경 시 두 군데 모두 갱신.
 */
const SECTION_MARKER_ALIASES: Array<{ section: SectionGroup; alias: string }> = [
  // progress
  { section: "progress", alias: "진행상황" },
  { section: "progress", alias: "진행 중" },
  { section: "progress", alias: "진행중" },
  { section: "progress", alias: "진행 현황" },
  { section: "progress", alias: "Progress" },
  { section: "progress", alias: "주요 진행" },
  { section: "progress", alias: "현황" },
  // schedule
  { section: "schedule", alias: "일정" },
  { section: "schedule", alias: "Schedule" },
  { section: "schedule", alias: "스케줄" },
  { section: "schedule", alias: "타임라인" },
  // risk
  { section: "risk", alias: "이슈/리스크" },
  { section: "risk", alias: "이슈·리스크" },
  { section: "risk", alias: "이슈/콜아웃" },
  { section: "risk", alias: "이슈" },
  { section: "risk", alias: "리스크" },
  { section: "risk", alias: "Risk" },
  { section: "risk", alias: "Issue" },
  { section: "risk", alias: "콜아웃" },
  // nextAction
  { section: "nextAction", alias: "다음 액션" },
  { section: "nextAction", alias: "다음액션" },
  { section: "nextAction", alias: "Next Action" },
  { section: "nextAction", alias: "Action Item" },
  { section: "nextAction", alias: "ActionItem" },
  { section: "nextAction", alias: "액션 아이템" },
  { section: "nextAction", alias: "다음 단계" },
];

function normalizeForMarkerMatch(s: string): string {
  // [...], <...>, plain alias 모두 지원. 양쪽 공백, 콜론, 줄 끝 허용.
  return s
    .replace(/^[\[<*🧭#]\s*/, "")  // leading bracket / asterisk / 🧭 / # 제거
    .replace(/\s*[\]>:]\s*$/, "")  // trailing bracket / colon 제거
    .replace(/^\s*\d+\s*주차\s*/, "")  // "21주차 일정" 같은 prefix 제거
    .trim();
}

/**
 * 텍스트가 section marker인지 검사. true면 어떤 section인지 반환.
 * 호출자: ADF paragraph / plain text line.
 */
export function detectSectionMarker(text: string): { section: SectionGroup; alias: string } | null {
  if (!text) return null;
  const t = normalizeForMarkerMatch(text);
  if (!t) return null;
  const tLower = t.toLowerCase();
  for (const m of SECTION_MARKER_ALIASES) {
    if (t === m.alias) return { section: m.section, alias: m.alias };
    if (tLower === m.alias.toLowerCase()) return { section: m.section, alias: m.alias };
  }
  return null;
}

// ─── section partition ────────────────────────────────────────

/**
 * AST root의 children을 section marker 기준으로 분할.
 *
 * 동작:
 *   - 순차로 children을 훑는다.
 *   - marker 노드를 만나면 활성 섹션을 갱신.
 *   - 그 뒤 따라오는 list/para/item 노드는 활성 섹션에 누적.
 *   - 활성 섹션이 없는 동안 만난 노드는 unsectioned로.
 *   - 같은 섹션 marker가 여러 번 등장하면 같은 그룹에 append (중복 허용, drop 없음).
 *
 * 반환:
 *   sections: section별 노드 리스트 (없으면 empty array)
 *   unsectioned: marker 이전 또는 marker 외 영역의 노드들
 *   hasAnyMarker: 어떤 section이라도 인식됐는지 (없으면 호출자가 fallback 경로 선택)
 */
export function partitionBySections(root: AstNode): {
  sections: Record<SectionGroup, AstNode[]>;
  unsectioned: AstNode[];
  hasAnyMarker: boolean;
} {
  const sections: Record<SectionGroup, AstNode[]> = {
    progress: [],
    schedule: [],
    risk: [],
    nextAction: [],
  };
  const unsectioned: AstNode[] = [];
  let active: SectionGroup | null = null;
  let hasAnyMarker = false;

  for (const child of root.children) {
    if (child.kind === "marker" && child.section) {
      active = child.section;
      hasAnyMarker = true;
      continue;
    }
    if (active) {
      sections[active].push(child);
    } else {
      unsectioned.push(child);
    }
  }

  return { sections, unsectioned, hasAnyMarker };
}

// ─── traversal with context propagation ──────────────────────

/** AST traversal context — 자식 노드에 전달되는 propagation state */
export interface AstContext {
  /** 부모 chain에서 결정된 phase (있을 때만 자식이 상속) */
  parentPhase?: string;
  /** 직속 부모 item의 text — debug/trace 용 */
  parentText?: string;
  /** root → 현재 item까지의 text 경로 — debug 용 */
  itemPath: string[];
  /** 현재 활성 section group (있을 때) */
  section?: SectionGroup;
}

/** item 방문 시 호출되는 visitor */
export type AstVisitor = (item: AstNode, ctx: AstContext) => {
  /** 다음 자식들에게 propagate할 phase. undefined를 반환하면 ctx.parentPhase가 그대로 유지됨. */
  propagatePhase?: string;
} | void;

/**
 * AST 순회 — item 노드마다 visitor를 호출하면서 자식에 context를 propagate.
 *
 * visitor의 반환값:
 *   - { propagatePhase: "QA" }      → 자식 ctx.parentPhase = "QA"
 *   - { propagatePhase: undefined } → 자식 ctx.parentPhase = ctx.parentPhase (그대로)
 *   - void / undefined              → 자식 ctx.parentPhase = ctx.parentPhase (그대로)
 *
 * para/marker는 visitor 호출 없이 단순 descend.
 */
export function traverseAst(
  node: AstNode,
  ctx: AstContext,
  visitor: AstVisitor,
): void {
  if (node.kind === "item") {
    const res = visitor(node, ctx);
    const nextPhase = res && "propagatePhase" in res
      ? res.propagatePhase ?? ctx.parentPhase
      : ctx.parentPhase;
    const childCtx: AstContext = {
      ...ctx,
      parentPhase: nextPhase,
      parentText: node.text,
      itemPath: [...ctx.itemPath, node.text],
    };
    for (const c of node.children) traverseAst(c, childCtx, visitor);
    return;
  }
  for (const c of node.children) traverseAst(c, ctx, visitor);
}

// ─── debug printer ───────────────────────────────────────────

/**
 * AST를 사람 읽기 좋은 트리 문자열로 직렬화. debug/trace 출력용.
 * production endpoint(jira-weekly-source/route.ts)에서 dev-mode debug 필드로 활용.
 */
export function printAstTree(node: AstNode, prefix: string = "", isLast: boolean = true, isRoot: boolean = true): string {
  const lines: string[] = [];
  const connector = isRoot ? "" : (isLast ? "└─ " : "├─ ");
  const desc =
    node.kind === "item" ? `[item L${node.level}] "${truncate(node.text, 80)}"`
    : node.kind === "list" ? `[list L${node.level}${node.ordered ? " ordered" : ""}] (${node.children.length} items)`
    : node.kind === "marker" ? `[marker L${node.level} section=${node.section ?? "?"}] "${truncate(node.text, 40)}"`
    : node.kind === "para" ? `[para L${node.level}] "${truncate(node.text, 80)}"`
    : `[${node.kind} L${node.level}]`;
  lines.push(prefix + connector + desc);

  const childPrefix = isRoot ? "" : (prefix + (isLast ? "   " : "│  "));
  node.children.forEach((c, i) => {
    lines.push(printAstTree(c, childPrefix, i === node.children.length - 1, false));
  });
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

// ─── 입력 자동 디스패치 ──────────────────────────────────────

/**
 * 입력이 ADF JSON인지 plain text인지 자동 판별해 알맞은 빌더 호출.
 * - object + type === "doc" + content array → ADF
 * - 그 외 (string) → plain text
 *
 * jira-weekly-source route에서 customfield_10625는 ADF로 직접 받지만,
 * parseWeekly() 진입점은 text를 받기 때문에 둘 다 처리할 수 있어야 함.
 */
export function buildAst(input: AdfNode | string | null | undefined): AstNode {
  if (input == null) return { kind: "doc", level: 0, text: "", raw: "", children: [] };
  if (typeof input === "string") return buildAstFromPlainText(input);
  if (typeof input === "object" && (input as AdfNode).type === "doc") {
    return buildAstFromAdf(input as AdfNode);
  }
  // 기타 객체는 일단 string으로 강제 후 plain text 빌더
  return buildAstFromPlainText(String(input));
}
