/**
 * Jira Weekly source detection helpers.
 *
 * Pure functions only: keeping source extraction outside the Route Handler makes
 * the production policy directly testable without calling Jira.
 */

export type WeeklyAdfNode = {
  type?: string;
  text?: string;
  content?: WeeklyAdfNode[];
  attrs?: Record<string, unknown>;
};

const BLOCK_TYPES = new Set([
  "paragraph", "heading", "codeBlock", "blockquote",
  "rule", "panel", "expand", "nestedExpand", "mediaSingle",
]);

/** Convert Jira ADF to indent-preserving plain text. */
export function weeklyAdfToText(
  node: WeeklyAdfNode | null | undefined,
  typesSeen?: Set<string>,
  listDepth = 0,
): string {
  if (!node) return "";
  if (typesSeen && node.type) typesSeen.add(node.type);
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention") {
    const mentionText = node.attrs?.text;
    return typeof mentionText === "string" ? mentionText : "";
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    return Array.isArray(node.content)
      ? node.content.map((child) => weeklyAdfToText(child, typesSeen, listDepth + 1)).join("")
      : "";
  }

  if (node.type === "listItem") {
    const inner = Array.isArray(node.content)
      ? node.content.map((child) => weeklyAdfToText(child, typesSeen, listDepth)).join("")
      : "";
    const indent = "  ".repeat(Math.max(0, listDepth - 1));
    const lines = inner.split("\n");
    const firstNonEmpty = lines.findIndex((line) => line.trim().length > 0);
    if (firstNonEmpty < 0) return "";
    lines[firstNonEmpty] = `${indent}- ${lines[firstNonEmpty].trim()}`;
    while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
    return `${lines.join("\n")}\n`;
  }

  const inner = Array.isArray(node.content)
    ? node.content.map((child) => weeklyAdfToText(child, typesSeen, listDepth)).join("")
    : "";

  if (node.type === "tableRow") return `${inner.replace(/\n+/g, " | ")}\n`;
  if (node.type && BLOCK_TYPES.has(node.type)) return `${inner}\n`;
  return inner;
}

export const WEEKLY_HEADER_RE =
  /(?:^|\n)\s*[*🧭#[]*\s*(?:\d+\s*주차|이번주|금주|this\s*week|current\s*week)?\s*Weekly\s*공유\s*사항\s*\]?\s*[:\n]?/i;

const WEEKLY_STOP_PATTERNS: RegExp[] = [
  /\n\s*[*#]*\s*(?:연결된\s*업무\s*항목|활동|Confluence\s*콘텐츠|Linked\s*work\s*items|Activity)\s*[:\n]/i,
  /\n\s*\[\s*(?:연결된\s*업무\s*항목|활동|Confluence\s*콘텐츠|Linked\s*work\s*items|Activity)\s*\]/i,
];

export type WeeklySection = {
  section: string;
  headerMatched: string | null;
  /** Header + body. Numeric week in the header must reach parseWeekly(). */
  sourceText: string;
};

/**
 * Extract the last Weekly section in a description.
 *
 * Jira descriptions can retain archived Weekly blocks. The visually last block
 * is the live block, and a following Weekly header also terminates the previous
 * block. Returning header + body preserves a numeric source week for parsing.
 */
export function extractLatestWeeklySection(text: string): WeeklySection {
  const headerRe = new RegExp(WEEKLY_HEADER_RE.source, "gi");
  const matches = Array.from(text.matchAll(headerRe));
  const match = matches.at(-1);
  if (!match || match.index === undefined) {
    return { section: "", headerMatched: null, sourceText: "" };
  }

  const headerMatched = match[0].trim();
  const bodyStart = match.index + match[0].length;
  const after = text.slice(bodyStart);
  let stopAt = after.length;

  for (const stopRe of WEEKLY_STOP_PATTERNS) {
    const stop = after.match(stopRe);
    if (stop?.index !== undefined && stop.index < stopAt) stopAt = stop.index;
  }

  const section = after.slice(0, stopAt).trim();
  const sourceText = [headerMatched, section].filter(Boolean).join("\n");
  return { section, headerMatched, sourceText };
}

export const WEEKLY_COMMENT_MARKER_RE = /\d+\s*주차\s*Weekly\s*공유사항/i;

export function isAutomationAuthor(name: string | undefined | null): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase().trim();
  if (!normalized || normalized === "-") return false;
  return (
    normalized.includes("automation")
    || /\bbot\b/.test(normalized)
    || normalized.includes("atlassian")
    || normalized.includes("자동 생성")
    || normalized.includes("자동생성")
  );
}

export function isWeeklyAutomationComment(
  authorName: string | undefined | null,
  body: string,
): boolean {
  return isAutomationAuthor(authorName) && WEEKLY_COMMENT_MARKER_RE.test(body);
}

export type WeeklyCommentCandidate = {
  text: string;
  updated: string;
  created: string;
  author: string;
  markers: string[];
  qualifiesForSync: boolean;
};

/** Comments must already be ordered newest-first by Jira. */
export function selectLatestQualifyingComment<T extends WeeklyCommentCandidate>(
  comments: T[],
): T | null {
  return comments.find((comment) => comment.qualifiesForSync) ?? null;
}

export type WeeklySourceCandidate = {
  source: "customfield" | "description" | "comment";
};

/**
 * Current Weekly source policy.
 *
 * Jira's dedicated "Weekly 공유사항" field is the live source of truth.
 * Description sections are retained for legacy tickets, while Automation
 * comments are archived Weekly history and are used only as a fallback.
 */
export function selectWeeklySource<T extends WeeklySourceCandidate>(
  candidates: {
    customfield: T | null;
    description: T | null;
    comment: T | null;
  },
): T | null {
  return candidates.customfield ?? candidates.description ?? candidates.comment;
}
