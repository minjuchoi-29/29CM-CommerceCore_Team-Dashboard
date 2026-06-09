/**
 * Phase B: Atlassian Document Format (ADF) helpers.
 *
 * Jira REST API v3 의 comment body 가 ADF 구조 (type:"doc", version:1, content:[...]).
 * Dashboard 가 단순 텍스트를 받아 ADF 로 변환하고,
 * Jira 가 응답한 comment 안에서 marker 문자열을 검색하는 두 헬퍼만 제공.
 *
 * 지원 텍스트 문법:
 *  - 빈 줄 = paragraph 분리
 *  - "- " 또는 "* " 로 시작 = bulletList item
 *  - marker 가 주어지면 마지막에 inline code paragraph 로 부착 (검색용)
 */

export type ADFMark = { type: string; attrs?: Record<string, unknown> };
export type ADFNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ADFNode[];
  marks?: ADFMark[];
  text?: string;
};
export type ADFDoc = { type: "doc"; version: 1; content: ADFNode[] };

function textNode(text: string, marks?: ADFMark[]): ADFNode {
  return marks && marks.length > 0 ? { type: "text", text, marks } : { type: "text", text };
}

function paragraphNode(text: string): ADFNode {
  if (!text) return { type: "paragraph" }; // empty paragraph = blank line
  return { type: "paragraph", content: [textNode(text)] };
}

function bulletItemNode(text: string): ADFNode {
  return { type: "listItem", content: [paragraphNode(text)] };
}

function bulletListNode(items: string[]): ADFNode {
  return { type: "bulletList", content: items.map(bulletItemNode) };
}

/**
 * 단순 텍스트 → ADF doc.
 *
 * @param text 사용자에게 보일 본문. 줄바꿈 + "- " bullet 지원.
 * @param marker 옵션. 있으면 마지막에 inline code paragraph 로 부착.
 */
export function buildCommentBody(text: string, marker?: string): ADFDoc {
  const content: ADFNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  let bulletBuffer: string[] = [];
  const flushBullets = () => {
    if (bulletBuffer.length === 0) return;
    content.push(bulletListNode(bulletBuffer));
    bulletBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      bulletBuffer.push(bulletMatch[1].trim());
      continue;
    }
    flushBullets();
    content.push(paragraphNode(line.trim()));
  }
  flushBullets();

  if (marker) {
    content.push({
      type: "paragraph",
      content: [textNode(marker, [{ type: "code" }])],
    });
  }

  return { type: "doc", version: 1, content };
}

/**
 * 주어진 ADF body 안에 marker 문자열이 포함되어 있는지 재귀 검색.
 * Jira GET /comment 응답의 각 comment.body 에 대해 호출.
 */
export function findMarkerInADF(body: unknown, marker: string): boolean {
  if (!marker) return false;
  if (!body || typeof body !== "object") return false;
  const node = body as ADFNode;
  if (typeof node.text === "string" && node.text.includes(marker)) return true;
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (findMarkerInADF(child, marker)) return true;
    }
  }
  return false;
}
