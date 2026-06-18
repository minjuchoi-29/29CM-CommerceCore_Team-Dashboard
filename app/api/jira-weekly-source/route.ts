import { NextRequest, NextResponse } from "next/server";
import { parseWeekly, parseWeekNumber } from "@/lib/weekly-parser";
import { buildAstFromAdf, printAstTree } from "@/lib/weekly-ast";
import type { WeeklyDetectedSource } from "@/lib/weekly-types";

export const dynamic = "force-dynamic";

const JIRA_HOST = "https://musinsa-oneteam.atlassian.net";
const FETCH_TIMEOUT_MS = 15_000;

// ─── ADF → plain text (indent-preserving) ─────────────────────
//
// Atlassian Document Format은 ProseMirror-like JSON. 본 모듈은 ADF tree를 평탄화한
// text를 반환하지만, **nested bulletList의 depth는 2-space indent로 보존**한다.
//   - bulletList / orderedList는 들어갈 때마다 listDepth++
//   - listItem 렌더 시 (listDepth - 1) * 2 칸 indent 후 "- " prefix
//   - text 출력은 lib/weekly-ast.buildAstFromPlainText가 이 indent를 보고 hierarchy를 복구
//
// 이렇게 해야 jira-weekly-source → /api/weekly-sync → parseWeekly → AST traversal 흐름에서
// parent phase context가 실제로 자식에게 propagate됨. 이 indent가 없으면 AST 도입의 효과 0.

type AdfNode = {
  type?: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
};

const BLOCK_TYPES = new Set([
  "paragraph", "heading", "codeBlock", "blockquote",
  "rule", "panel", "expand", "nestedExpand", "mediaSingle",
]);

function adfToText(node: AdfNode | null | undefined, typesSeen?: Set<string>, listDepth = 0): string {
  if (!node) return "";
  if (typesSeen && node.type) typesSeen.add(node.type);
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";

  // bulletList / orderedList: depth +1 하여 자식 listItem 처리
  if (node.type === "bulletList" || node.type === "orderedList") {
    return Array.isArray(node.content)
      ? node.content.map(c => adfToText(c, typesSeen, listDepth + 1)).join("")
      : "";
  }

  // listItem: 현재 listDepth를 기준으로 indent 적용
  if (node.type === "listItem") {
    // listItem 내부의 paragraph는 자체 줄바꿈을 붙이므로, 우리는 첫 줄에 prefix만 붙이고
    // nested list (자식 bulletList)는 그 다음 줄들에 자기 indent를 입혀 출력함.
    const inner = Array.isArray(node.content)
      ? node.content.map(c => adfToText(c, typesSeen, listDepth)).join("")
      : "";
    const indent = "  ".repeat(Math.max(0, listDepth - 1));
    const lines = inner.split("\n");
    // 첫 비어있지 않은 line에 prefix를 붙이고, 그 뒤 line은 indent 유지 (자식 list가 이미 자기 indent를 가짐)
    let firstNonEmpty = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim()) { firstNonEmpty = i; break; }
    }
    if (firstNonEmpty < 0) return "";
    lines[firstNonEmpty] = `${indent}- ${lines[firstNonEmpty].trim()}`;
    // trailing blank lines 제거 후 줄바꿈 1개
    while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
    return lines.join("\n") + "\n";
  }

  const inner = Array.isArray(node.content)
    ? node.content.map(c => adfToText(c, typesSeen, listDepth)).join("")
    : "";

  if (node.type === "tableRow") return inner.replace(/\n+/g, " | ") + "\n";
  if (node.type && BLOCK_TYPES.has(node.type)) return inner + "\n";
  return inner;
}

// ─── Marker 정의 ──────────────────────────────────────────────
const MARKER_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "주차_Weekly_공유사항", re: /\d+\s*주차\s*Weekly\s*공유사항/i },
  { name: "[진행상황]",         re: /\[\s*진행\s*상황\s*\]/ },
  { name: "[일정]",             re: /\[\s*일정\s*\]/ },
  { name: "[이슈/리스크]",      re: /\[\s*이슈\s*[/··]\s*리스크\s*\]/ },
  { name: "[다음 액션]",        re: /\[\s*다음\s*액션\s*\]/ },
];

function findMarkers(text: string): string[] {
  const out: string[] = [];
  for (const m of MARKER_PATTERNS) {
    if (m.re.test(text)) out.push(m.name);
  }
  return out;
}

// ─── Weekly Automation Comment 자격 ──────────────────────────────
//
// Comment-source 정책 (2026-06-16 확정):
//   description Weekly 섹션이 없을 때, comment 도 schedule sync 대상이 될 수 있음.
//   단 노이즈 차단을 위해 다음 두 조건 **모두** 충족하는 comment 만 허용:
//
//   1) 본문이 정확히 "<NN>주차 Weekly 공유사항" 패턴 포함
//      → Automation for Jira 가 자동 archive 하는 표준 헤더.
//        사람이 작성한 일반 댓글 안에서 우연히 매칭될 가능성을 줄이기 위해
//        MARKER_PATTERNS 중 가장 좁은 패턴만 사용.
//
//   2) 작성자가 시스템 (Automation / Bot) 임이 표시되어야 함.
//      → Jira API 의 author.displayName 기준. 보수적 매칭:
//        "Automation for Jira", "Jira Bot", "Atlassian Automation",
//        "자동 생성" 등 운영 환경에서 관찰 가능한 이름 패턴.
//
//   기본 정렬은 이미 -created (최신순) → break 로 가장 최근 1건만 사용.

const WEEKLY_COMMENT_MARKER_RE = /\d+\s*주차\s*Weekly\s*공유사항/i;

function isAutomationAuthor(name: string | undefined | null): boolean {
  if (!name) return false;
  const n = name.toLowerCase().trim();
  if (n === "-" || n.length === 0) return false;
  return (
    n.includes("automation")
    || /\bbot\b/.test(n)
    || n.includes("atlassian")
    || n.includes("자동 생성")
    || n.includes("자동생성")
  );
}

/** 단일 comment 가 weekly automation archive 자격을 충족하는지 판정. */
function isWeeklyAutomationComment(
  authorName: string | undefined | null,
  body: string,
): boolean {
  if (!isAutomationAuthor(authorName)) return false;
  return WEEKLY_COMMENT_MARKER_RE.test(body);
}

// ─── description 내부 "Weekly 공유사항" 섹션 추출 ────────────────
// 운영 약속:
//   description 안에는 PRD/기대결과/링크 등 여러 섹션이 공존한다.
//   그중 "Weekly 공유사항" 헤더 아래 영역만이 live operational weekly.
//   PRD 본문은 weekly와 무관 — 추출 대상 아님.
//
// 헤더 표기 허용:
//   - "Weekly 공유사항"
//   - "🧭 21주차 Weekly 공유사항"
//   - "[Weekly 공유사항]"
//   - "*Weekly 공유사항"
//   - "이번주 Weekly 공유사항"     (v6.1: 주초 LIVE 편집 패턴)
//   - "금주 Weekly 공유사항"       (v6.1)
//   - "This Week Weekly 공유사항"  (v6.1)
// 종료 조건 (Stop section):
//   - "연결된 업무 항목" / "활동" / "Confluence 콘텐츠" / "Linked work items" / "Activity"
//   - description EOF

const WEEKLY_HEADER_RE =
  /(?:^|\n)\s*[*🧭#[]*\s*(?:\d+\s*주차|이번주|금주|this\s*week|current\s*week)?\s*Weekly\s*공유\s*사항\s*\]?\s*[:\n]?/i;

const WEEKLY_STOP_PATTERNS: RegExp[] = [
  /\n\s*[*#]*\s*(?:연결된\s*업무\s*항목|활동|Confluence\s*콘텐츠|Linked\s*work\s*items|Activity)\s*[:\n]/i,
  /\n\s*\[\s*(?:연결된\s*업무\s*항목|활동|Confluence\s*콘텐츠|Linked\s*work\s*items|Activity)\s*\]/i,
];

function extractWeeklySection(text: string): { section: string; headerMatched: string | null } {
  const m = text.match(WEEKLY_HEADER_RE);
  if (!m || m.index === undefined) return { section: "", headerMatched: null };

  const headerMatched = m[0].trim();
  const startIdx = m.index + m[0].length;
  const after = text.slice(startIdx);

  // 첫 stop pattern 매치 위치 찾음
  let stopAt = after.length;
  for (const stopRe of WEEKLY_STOP_PATTERNS) {
    const sm = after.match(stopRe);
    if (sm && sm.index !== undefined && sm.index < stopAt) stopAt = sm.index;
  }

  return { section: after.slice(0, stopAt).trim(), headerMatched };
}

// ─── Jira fetch helper ───────────────────────────────────────
async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type JiraComment = {
  id: string;
  body: AdfNode;
  created: string;
  updated: string;
  author?: { displayName?: string };
};

// ─── 메인 ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const key = (req.nextUrl.searchParams.get("key") ?? "").trim().toUpperCase();
  if (!key || !/^[A-Z][A-Z0-9]*-\d+$/.test(key)) {
    return NextResponse.json(
      { error: "유효한 티켓 키가 필요합니다. 예: TM-1234" },
      { status: 400 },
    );
  }

  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) {
    return NextResponse.json(
      { error: "JIRA_EMAIL 또는 JIRA_API_TOKEN 환경변수가 없습니다." },
      { status: 500 },
    );
  }

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };

  // ── 디버깅 옵션: ?discover=fields (dev-only) ──────────────────
  // 전체 field 메타데이터(custom field id ↔ display name 매핑)와
  // weekly 후보 field를 찾아서 응답. source discovery 단계 전용.
  // production에서는 비활성화 (운영 안전성 + 노이즈 방지).
  if (req.nextUrl.searchParams.get("discover") === "fields") {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "?discover=fields is disabled in production (debug-only)" },
        { status: 404 },
      );
    }
    const url = `${JIRA_HOST}/rest/api/3/issue/${encodeURIComponent(key)}` +
                `?expand=names&fields=*all`;
    const res = await fetchWithTimeout(url, { headers, cache: "no-store" });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        { error: `Jira issue API ${res.status}: ${body.slice(0, 300)}` },
        { status: 502 },
      );
    }
    const data = await res.json();
    const names = (data.names ?? {}) as Record<string, string>;
    const fields = (data.fields ?? {}) as Record<string, unknown>;
    const candidates = Object.entries(names)
      .filter(([, n]) => typeof n === "string" && (
        n.includes("Weekly") || n.includes("공유사항") || n.includes("주차") ||
        n.toLowerCase().includes("weekly") || n.includes("주간")
      ))
      .map(([id, name]) => {
        const v = fields[id];
        return {
          id,
          name,
          hasValue: v !== null && v !== undefined,
          valueType: Array.isArray(v) ? "array" : typeof v,
          valuePreview: v !== null && v !== undefined
            ? JSON.stringify(v).slice(0, 600)
            : null,
        };
      });
    const allFieldsWithValues = Object.entries(fields)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([id, v]) => ({
        id,
        name: names[id] ?? "(no name)",
        valueType: Array.isArray(v) ? "array" : typeof v,
        valuePreview: JSON.stringify(v).slice(0, 200),
      }));
    return NextResponse.json({
      ticketKey: key,
      weeklyCandidates: candidates,
      allCustomFieldsWithValues: allFieldsWithValues.filter(f => f.id.startsWith("customfield_")),
      allFieldNamesMap: names,
    });
  }

  try {
    // 1) description + updated + customfield_10625 (참고용만 — v5부터 resolution에서 제외)
    //    customfield_10625 = "Weekly 공유사항" (29CM Jira).
    //    실운영에서 거의 채워지지 않음 → debug 확인용으로만 fetch.
    const WEEKLY_CUSTOM_FIELD_ID = "customfield_10625";
    const WEEKLY_CUSTOM_FIELD_NAME = "Weekly 공유사항";
    const issueUrl =
      `${JIRA_HOST}/rest/api/3/issue/${encodeURIComponent(key)}` +
      `?fields=description,updated,${WEEKLY_CUSTOM_FIELD_ID}`;
    const issueRes = await fetchWithTimeout(issueUrl, { headers, cache: "no-store" });
    if (!issueRes.ok) {
      const body = await issueRes.text();
      return NextResponse.json(
        { error: `Jira issue API ${issueRes.status}: ${body.slice(0, 300)}` },
        { status: issueRes.status === 404 ? 404 : 502 },
      );
    }
    const issueData = await issueRes.json();
    const descAdf = (issueData.fields?.description ?? null) as AdfNode | null;
    const descAdfNodeTypes = new Set<string>();
    const descText = adfToText(descAdf, descAdfNodeTypes).trim();
    const descUpdated = (issueData.fields?.updated as string | undefined) ?? "";
    // description 내부 "Weekly 공유사항" 섹션 추출 (fallback용)
    const { section: descWeeklySection, headerMatched: descWeeklyHeader } =
      descText ? extractWeeklySection(descText) : { section: "", headerMatched: null };
    const descMarkers = descWeeklySection ? findMarkers(descWeeklySection) : [];

    // ── 진짜 SoT: customfield_10625 = "Weekly 공유사항" ─────────
    // PM이 매주 직접 갱신하는 dedicated field. description/comment보다 우선.
    const cfWeeklyAdf = (issueData.fields?.[WEEKLY_CUSTOM_FIELD_ID] ?? null) as AdfNode | null;
    const cfWeeklyText = cfWeeklyAdf ? adfToText(cfWeeklyAdf).trim() : "";
    const cfWeeklyMarkers = cfWeeklyText ? findMarkers(cfWeeklyText) : [];

    // 2) comments — 최신순 (Jira는 기본 created asc, 최근 N개만 보려면 orderBy=-created)
    const commentUrl =
      `${JIRA_HOST}/rest/api/3/issue/${encodeURIComponent(key)}/comment` +
      `?orderBy=-created&maxResults=20`;
    const commentRes = await fetchWithTimeout(commentUrl, { headers, cache: "no-store" });
    if (!commentRes.ok) {
      const body = await commentRes.text();
      return NextResponse.json(
        { error: `Jira comment API ${commentRes.status}: ${body.slice(0, 300)}` },
        { status: 502 },
      );
    }
    const commentData = await commentRes.json();
    const comments = (commentData.comments ?? []) as JiraComment[];

    // marker 있는 comment 탐색 (이미 -created 정렬)
    //
    // schedule sync 자격 정책 (isWeeklyAutomationComment):
    //   - 작성자 = Automation / Bot 류
    //   - 본문에 "<NN>주차 Weekly 공유사항" 정확 매칭
    //   양쪽 조건 모두 충족하는 comment 만 schedule sync 대상.
    //
    // [PR-Multi-1 변경 — 2026-06-17]
    //   기존 로직은 `for ... break;` 로 첫 marker 매치 1건만 보존했다.
    //   본 변경은 **break 제거**: marker 가 있는 comment 를 전부 누적하여
    //   `markedCommentList` 에 보관한다. 단일 source pick 정책 (`pick = descCandidate
    //   ?? commentCandidate`) 은 변경 없음 — `markedComment = list[0] ?? null` 로
    //   기존 동작 그대로 복원 (comments 가 -created 정렬이므로 [0] = 최신 marker comment).
    //
    //   추가된 list 는 응답의 `sources[]` 노출 (detection 후보 시각화) 전용이며,
    //   merge / candidate / stale 로직은 list 를 참조하지 않는다.
    type MarkedComment = {
      text: string;
      updated: string;
      created: string;
      author: string;
      markers: string[];
      qualifiesForSync: boolean;
    };
    const markedCommentList: MarkedComment[] = [];
    for (const c of comments) {
      const t = adfToText(c.body).trim();
      if (!t) continue;
      const ms = findMarkers(t);
      if (ms.length === 0) continue;
      const authorName = c.author?.displayName ?? "-";
      const qualifies = isWeeklyAutomationComment(authorName, t);
      markedCommentList.push({
        text: t,
        updated: c.updated,
        created: c.created,
        author: authorName,
        markers: ms,
        qualifiesForSync: qualifies,
      });
    }
    // 기존 단일 pick 경로 복원 — 최신 marker comment 1건 (-created 정렬 → [0]).
    const markedComment: MarkedComment | null = markedCommentList[0] ?? null;

    // ─── 우선순위 결정 (2026-05-29 정책 재확정 v5) ───────────────
    //
    // [운영 흐름 — v5 실제 운영 기준]
    //   description "Weekly 공유사항" 섹션          = LIVE operational truth (1순위)
    //                                               PM이 description 안에 직접 적는 경우, 항상 latest operational state.
    //   Automation for Jira "nn주차 Weekly 공유사항" 댓글 = 실제 운영 SoT (2순위)
    //                                               description Weekly가 없을 때 가장 최신 주차 댓글을 선택.
    //   customfield_10625 ("Weekly 공유사항")        = 참고용만 — source resolution에 사용 안 함
    //                                               실운영에서 거의 사용되지 않거나 비어있는 경우가 많음.
    //                                               debug 응답에서 확인 가능하나 pick에 포함되지 않음.
    //
    // [선택 정책 — 우선순위 (descCandidate ?? commentCandidate)]
    //   1) description "Weekly 공유사항" 섹션 있음 → description-first
    //   2) latest Automation "nn주차 Weekly 공유사항" 댓글 있음 → comment-fallback
    //   3) 모두 없음 → null
    //
    // [v4 → v5 변경 사유]
    //   customfield_10625는 실제 운영에서 거의 채워지지 않음 (PM 확인).
    //   따라서 customfield를 2순위로 두면 description도 없고 comment도 있는 티켓
    //   (예: TM-3032 — 20/21/22주차 댓글 존재, customfield=null)에서
    //   올바른 댓글을 선택하지 못하는 문제가 발생.
    //   v5에서는 comment가 2순위 — customfield는 resolution chain에서 완전히 제외.
    //
    // [중요 운영 약속 — v6 (2026-06-16)]
    //   - PRD 본문은 schedule/note 추출 대상 아님 (description 안의 "Weekly 공유사항" 섹션만).
    //   - comment 는 Automation Bot 이 생성한 "<NN>주차 Weekly 공유사항" 형식 댓글만 대상
    //     (isWeeklyAutomationComment).
    //   - comment 는 -created 정렬 → 최신 주차 자동 선택.
    //   - **v6 변경**: comment 도 schedule sync 대상. (이전 v5 의 history-only skip 폐기)
    //     mergeWeeklySync 의 idempotent path (lib/weekly-merge.ts:245-254) 가 중복 schedule
    //     생성 방어. 자격 미달 comment 는 commentCandidate=null 로 분류 — schedule sync 미발생.
    type Pick = {
      text: string;
      source: "description" | "comment";
      sourceUpdatedAt: string;
      markers: string[];
      policyReason: "description-first" | "comment-automation";
    };

    // 1순위: description "Weekly 공유사항" 섹션 — LIVE operational truth
    const descCandidate: Pick | null = descWeeklySection
      ? {
          text: descWeeklySection,
          source: "description",
          sourceUpdatedAt: descUpdated,
          markers: descMarkers.length > 0 ? descMarkers : ["weekly_공유사항_section"],
          policyReason: "description-first",
        }
      : null;

    // 2순위: Automation Bot 의 "<NN>주차 Weekly 공유사항" 댓글
    //   - 작성자 = Automation / Bot 일 때만 schedule sync 대상.
    //   - 사람이 작성한 댓글이 marker 만 우연히 매칭하는 경우는 commentCandidate=null.
    //   - 자격 미달 comment 도 markedComment 자체는 보존 (debug 응답에 노출 — 운영 진단용).
    const commentCandidate: Pick | null =
      markedComment && markedComment.qualifiesForSync
        ? {
            text: markedComment.text,
            source: "comment",
            sourceUpdatedAt: markedComment.updated,
            markers: markedComment.markers,
            policyReason: "comment-automation",
          }
        : null;

    // customfield_10625 — 참고용만 (v5: resolution chain에서 제외)
    // 실운영에서 거의 채워지지 않으므로 source pick에 포함하지 않음.

    // 최종 우선순위 (v6): description LIVE → comment (Automation 최신 주차, schedule sync 대상)
    const pick: Pick | null = descCandidate ?? commentCandidate;

    // ─── PR-Multi-1 (2026-06-17): detection 단계의 모든 source 후보 노출 ──
    //
    // 단일 pick 정책 (`pick = descCandidate ?? commentCandidate`) 은 그대로 유지.
    // 운영자가 "어떤 후보가 감지됐는지" / "왜 특정 source 가 선택됐는지" 를
    // 코드/디버그 없이 self-diagnose 할 수 있도록 detection 결과 자체를 노출.
    //
    // 포함 대상:
    //   1) description 의 "Weekly 공유사항" 섹션 (descWeeklySection 이 non-empty)
    //   2) Automation Bot 자격 충족 comment 전체 (markedCommentList 의 qualifiesForSync=true)
    //
    // qualifies=false comment (marker 만 우연 매칭한 인간 작성자 댓글) 는 의도적으로 제외.
    //   debug.allComments / debug.markedCommentQualifiesForSync 에서 확인 가능.
    //
    // 정렬: comment 는 sourceWeek 숫자 DESC (최신 주차 먼저). description 은 항상 맨 앞.
    //   숫자 추출 실패시 그 자리에 그대로 (stable sort).
    const detectedSources: WeeklyDetectedSource[] = [];

    if (descWeeklySection) {
      detectedSources.push({
        source: "description",
        sourceWeek: parseWeekNumber(descWeeklySection),
        sourceUpdatedAt: descUpdated,
        policyReason: "description-first",
        markers: descMarkers.length > 0 ? descMarkers : ["weekly_공유사항_section"],
        textLength: descWeeklySection.length,
        textPreview: descWeeklySection.slice(0, 200),
      });
    }

    const qualifyingComments = markedCommentList.filter(c => c.qualifiesForSync);
    // sourceWeek 숫자 DESC 정렬 (최신 주차 우선) — comment 만 정렬, description 은 위에서 prepend.
    const commentSourcesSorted: WeeklyDetectedSource[] = qualifyingComments
      .map(c => ({
        source: "comment" as const,
        sourceWeek: parseWeekNumber(c.text),
        sourceUpdatedAt: c.updated,
        policyReason: "comment-automation" as const,
        markers: c.markers,
        textLength: c.text.length,
        textPreview: c.text.slice(0, 200),
      }))
      .sort((a, b) => {
        const na = parseInt(a.sourceWeek, 10);
        const nb = parseInt(b.sourceWeek, 10);
        if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
        if (Number.isNaN(na)) return 1;
        if (Number.isNaN(nb)) return -1;
        return nb - na;
      });
    detectedSources.push(...commentSourcesSorted);

    // ─── 파싱 결과 (선택) — text가 있으면 parseWeekly 실행 ───────
    const parsed = pick ? parseWeekly(pick.text, key) : null;
    const parseSummary = parsed ? {
      sourceWeek: parsed.sourceWeek,
      schedulesCount: parsed.scheduleItems.length,
      progressCount: parsed.progressItems.length,
      risksCount: parsed.risks.length,
      actionsCount: parsed.nextActions.length,
      noIssues: parsed.noIssues,
      sectionsFound: parsed.debug?.sectionsFound ?? [],
      ignoredLines: parsed.debug?.ignoredLines ?? [],
      warnings: parsed.debug?.warnings ?? [],
    } : null;

    return NextResponse.json({
      ticketKey: key,
      text: pick?.text ?? null,
      source: pick?.source ?? null,
      policyReason: pick ? pick.policyReason : null,
      sourceUpdatedAt: pick?.sourceUpdatedAt ?? null,
      foundMarker: pick !== null,
      markers: pick?.markers ?? [],
      parsed,
      parseSummary,
      // PR-Multi-1: detection 단계의 모든 source 후보 (description + qualifying comments).
      // 단일 pick 정책은 무변경 — 본 필드는 UI 의 "Detected Sources" 노출 전용.
      sources: detectedSources,
      debug: {
        // ─── customfield_10625 = "Weekly 공유사항" (참고용 — v5 resolution에서 제외) ───
        // 실운영에서 거의 비어있음. source pick 에 사용되지 않으며 debug 확인 전용.
        weeklyCustomFieldId: WEEKLY_CUSTOM_FIELD_ID,
        weeklyCustomFieldName: WEEKLY_CUSTOM_FIELD_NAME,
        weeklyCustomFieldHasValue: !!cfWeeklyText,
        weeklyCustomFieldLength: cfWeeklyText.length,
        weeklyCustomFieldPreview: cfWeeklyText.slice(0, 1200),
        weeklyCustomFieldMarkers: cfWeeklyMarkers,
        // AST tree dump — ADF 직접 빌더 결과 (운영자가 hierarchy 인식 결과를 확인 가능)
        // dev 환경 외에는 omit해 production 응답 사이즈를 줄임
        weeklyCustomFieldAstTree: process.env.NODE_ENV === "development" && cfWeeklyAdf
          ? printAstTree(buildAstFromAdf(cfWeeklyAdf))
          : undefined,
        // ─── description (legacy fallback) ───
        descriptionLength: descText.length,
        descriptionPreview: descText.slice(0, 1200),
        descriptionUpdated: descUpdated,
        descriptionAdfNodeTypes: Array.from(descAdfNodeTypes).sort(),
        descriptionAdfRaw: process.env.NODE_ENV === "development" ? descAdf : undefined,
        // ─── description 내부 Weekly 섹션 (실제 SoT) ───
        descriptionWeeklyHeaderMatched: descWeeklyHeader,
        descriptionWeeklySectionLength: descWeeklySection.length,
        descriptionWeeklySectionPreview: descWeeklySection.slice(0, 1200),
        descriptionWeeklySectionMarkers: descMarkers,
        descriptionHasMarker: !!descWeeklySection,  // legacy 호환: 섹션 존재 여부로 의미 변경
        descriptionMarkers: descMarkers,             // legacy 호환
        // ─── comment (Automation Bot archive — v6 schedule sync 대상) ───
        commentCount: comments.length,
        markedCommentFound: !!markedComment,
        markedCommentMarkers: markedComment?.markers ?? [],
        markedCommentUpdated: markedComment?.updated ?? null,
        markedCommentAuthor: markedComment?.author ?? null,
        markedCommentLength: markedComment?.text.length ?? 0,
        markedCommentPreview: markedComment?.text.slice(0, 200) ?? null,
        // v6: schedule sync 자격 충족 여부. false 이면 markedComment 가 있어도 pick 미반영.
        markedCommentQualifiesForSync: markedComment?.qualifiesForSync ?? false,
        // 디버깅: 모든 comment 요약 (auto-archive vs human 구분, marker 매칭 여부)
        allComments: comments.map(c => {
          const t = adfToText(c.body).trim();
          return {
            created: c.created,
            updated: c.updated,
            author: c.author?.displayName ?? "-",
            length: t.length,
            markers: t ? findMarkers(t) : [],
            preview: t.slice(0, 150),
          };
        }),
        // ─── 운영 정책 명시 (v5) ───
        policyDescription:
          "[v6 정책 2026-06-16] description Weekly 섹션 → 최우선. " +
          "없으면 Automation Bot 의 최신 '<NN>주차 Weekly 공유사항' 댓글 사용 — " +
          "schedule sync 대상 (이전 v5 의 comment-only skip 폐기). " +
          "사람이 작성한 댓글 + marker 만 우연 매칭은 markedCommentQualifiesForSync=false 로 분류. " +
          "customfield_10625는 참고용만 — source resolution에 사용 안 함.",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `요청 실패: ${msg}` }, { status: 500 });
  }
}
