import { NextRequest, NextResponse } from "next/server";
import { parseWeekly, parseWeekNumber } from "@/lib/weekly-parser";
import { buildAstFromAdf, printAstTree } from "@/lib/weekly-ast";
import type { WeeklyDetectedSource } from "@/lib/weekly-types";
import {
  extractLatestWeeklySection,
  buildWeeklyReplaySources,
  versionWeeklySourceId,
  isWeeklyAutomationComment,
  selectLatestQualifyingComment,
  selectWeeklySource,
  weeklyAdfToText,
  weeklyFieldToText,
  type WeeklyAdfNode,
  type WeeklyCommentCandidate,
} from "@/lib/weekly-source";

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
  body: WeeklyAdfNode;
  created: string;
  updated: string;
  author?: { displayName?: string };
};

// ─── 메인 ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const key = (req.nextUrl.searchParams.get("key") ?? "").trim().toUpperCase();
  const compact = req.nextUrl.searchParams.get("compact") === "1";
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
    // 1) description + updated + customfield_10625
    //    customfield_10625 = "Weekly 공유사항" (29CM Jira).
    //    Jira 화면에서 description과 별도로 노출되는 현재 Weekly 전용 필드.
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
    const descAdf = (issueData.fields?.description ?? null) as WeeklyAdfNode | null;
    const descAdfNodeTypes = new Set<string>();
    const descText = weeklyAdfToText(descAdf, descAdfNodeTypes).trim();
    const descUpdated = (issueData.fields?.updated as string | undefined) ?? "";
    // description 내부에서 시각적으로 마지막 Weekly 섹션을 live source로 선택.
    // sourceText에는 헤더를 보존하여 "<NN>주차"가 parser까지 전달되게 한다.
    const {
      section: descWeeklySection,
      headerMatched: descWeeklyHeader,
      sourceText: descWeeklySourceText,
    } = descText
      ? extractLatestWeeklySection(descText)
      : { section: "", headerMatched: null, sourceText: "" };
    const descMarkers = descWeeklySection ? findMarkers(descWeeklySection) : [];

    // ── 진짜 SoT: customfield_10625 = "Weekly 공유사항" ─────────
    // PM이 매주 직접 갱신하는 dedicated field. description/comment보다 우선.
    const cfWeeklyRaw = issueData.fields?.[WEEKLY_CUSTOM_FIELD_ID] ?? null;
    const cfWeeklyAdf = typeof cfWeeklyRaw === "object" ? cfWeeklyRaw as WeeklyAdfNode : null;
    const cfWeeklyText = weeklyFieldToText(cfWeeklyRaw);
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
    const markedCommentList: WeeklyCommentCandidate[] = [];
    for (const c of comments) {
      const t = weeklyAdfToText(c.body).trim();
      if (!t) continue;
      const ms = findMarkers(t);
      if (ms.length === 0) continue;
      const authorName = c.author?.displayName ?? "-";
      const qualifies = isWeeklyAutomationComment(authorName, t);
      markedCommentList.push({
        id: c.id,
        text: t,
        updated: c.updated,
        created: c.created,
        author: authorName,
        markers: ms,
        qualifiesForSync: qualifies,
      });
    }
    // 진단에는 최신 marker 댓글을 보존하되, 실제 source는 newest-first 목록에서
    // 처음 발견되는 "자격 충족 Automation 댓글"을 선택한다.
    const latestMarkedComment: WeeklyCommentCandidate | null = markedCommentList[0] ?? null;
    const markedComment = selectLatestQualifyingComment(markedCommentList);

    // ─── 우선순위 결정 (2026-07-28 실제 Jira 화면 재검증) ─────────
    //
    // [운영 흐름]
    //   customfield_10625 ("Weekly 공유사항")        = 현재 Weekly (1순위)
    //   description "Weekly 공유사항" 섹션           = legacy live Weekly (2순위)
    //   Automation "nn주차 Weekly 공유사항" 댓글     = 지난 Weekly archive (3순위)
    //
    // [선택 정책]
    //   1) dedicated Weekly field 있음 → customfield-first
    //   2) description Weekly 섹션 있음 → description legacy fallback
    //   3) latest Automation Weekly 댓글 있음 → archived comment fallback
    //   4) 모두 없음 → null
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
      source: "customfield" | "description" | "comment";
      sourceUpdatedAt: string;
      markers: string[];
      policyReason: "customfield-first" | "description-legacy" | "comment-automation";
    };

    // 1순위: Jira dedicated "Weekly 공유사항" field — 현재 operational truth.
    // 필드 label 자체가 Weekly marker이므로 내부에 Weekly 헤더가 없어도 유효하다.
    const customfieldCandidate: Pick | null = cfWeeklyText
      ? {
          text: cfWeeklyText,
          source: "customfield",
          sourceUpdatedAt: descUpdated,
          markers: cfWeeklyMarkers.length > 0 ? cfWeeklyMarkers : ["weekly_공유사항_field"],
          policyReason: "customfield-first",
        }
      : null;

    // 2순위: description "Weekly 공유사항" 섹션 — legacy live source
    const descCandidate: Pick | null = descWeeklySection
      ? {
          text: descWeeklySourceText,
          source: "description",
          sourceUpdatedAt: descUpdated,
          markers: descMarkers.length > 0 ? descMarkers : ["weekly_공유사항_section"],
          policyReason: "description-legacy",
        }
      : null;

    // 3순위: Automation Bot 의 "<NN>주차 Weekly 공유사항" archive 댓글
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

    const pick: Pick | null = selectWeeklySource({
      customfield: customfieldCandidate,
      description: descCandidate,
      comment: commentCandidate,
    });

    // ─── PR-Multi-1 (2026-06-17): detection 단계의 모든 source 후보 노출 ──
    //
    // 단일 pick 정책 (`pick = descCandidate ?? commentCandidate`) 은 그대로 유지.
    // 운영자가 "어떤 후보가 감지됐는지" / "왜 특정 source 가 선택됐는지" 를
    // 코드/디버그 없이 self-diagnose 할 수 있도록 detection 결과 자체를 노출.
    //
    // 포함 대상:
    //   1) dedicated "Weekly 공유사항" field
    //   2) description 의 legacy "Weekly 공유사항" 섹션
    //   3) Automation Bot 자격 충족 comment 전체
    //
    // qualifies=false comment (marker 만 우연 매칭한 인간 작성자 댓글) 는 의도적으로 제외.
    //   debug.allComments / debug.markedCommentQualifiesForSync 에서 확인 가능.
    //
    // 정렬: comment 는 sourceWeek 숫자 DESC (최신 주차 먼저). description 은 항상 맨 앞.
    //   숫자 추출 실패시 그 자리에 그대로 (stable sort).
    const detectedSources: WeeklyDetectedSource[] = [];

    if (cfWeeklyText) {
      detectedSources.push({
        source: "customfield",
        sourceWeek: parseWeekNumber(cfWeeklyText),
        sourceUpdatedAt: descUpdated,
        policyReason: "customfield-first",
        markers: cfWeeklyMarkers.length > 0 ? cfWeeklyMarkers : ["weekly_공유사항_field"],
        textLength: cfWeeklyText.length,
        textPreview: cfWeeklyText.slice(0, 200),
      });
    }

    if (descWeeklySection) {
      detectedSources.push({
        source: "description",
        sourceWeek: parseWeekNumber(descWeeklySourceText),
        sourceUpdatedAt: descUpdated,
        policyReason: "description-legacy",
        markers: descMarkers.length > 0 ? descMarkers : ["weekly_공유사항_section"],
        textLength: descWeeklySourceText.length,
        textPreview: descWeeklySourceText.slice(0, 200),
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

    const replayCommentSources = qualifyingComments.map(c => ({
      sourceId: versionWeeklySourceId(`comment:${c.id ?? `${c.created}:${c.updated}`}`),
      text: c.text,
      source: "comment" as const,
      sourceWeek: parseWeekNumber(c.text),
      sourceUpdatedAt: c.updated,
      created: c.created,
    }));
    const currentReplaySource = pick ? {
      sourceId: versionWeeklySourceId(pick.source === "comment"
        ? `comment:${markedComment?.id ?? `${markedComment?.created}:${markedComment?.updated}`}`
        : `${pick.source}:${pick.sourceUpdatedAt}`),
      text: pick.text,
      source: pick.source,
      sourceWeek: parseWeekNumber(pick.text),
      sourceUpdatedAt: pick.sourceUpdatedAt,
    } : null;
    const syncSources = buildWeeklyReplaySources(replayCommentSources, currentReplaySource);

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
      parsed: compact ? undefined : parsed,
      parseSummary,
      // detection 단계의 모든 source 후보 (current field + legacy description + archived comments).
      // 단일 pick 정책은 무변경 — 본 필드는 UI 의 "Detected Sources" 노출 전용.
      sources: detectedSources,
      // schedule history 복원용: archived comments(oldest → newest), current live Weekly(last).
      syncSources,
      debug: compact ? undefined : {
        // ─── customfield_10625 = "Weekly 공유사항" (현재 Weekly SoT) ───
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
        markedCommentFound: !!latestMarkedComment,
        markedCommentMarkers: latestMarkedComment?.markers ?? [],
        markedCommentUpdated: latestMarkedComment?.updated ?? null,
        markedCommentAuthor: latestMarkedComment?.author ?? null,
        markedCommentLength: latestMarkedComment?.text.length ?? 0,
        markedCommentPreview: latestMarkedComment?.text.slice(0, 200) ?? null,
        // v6: schedule sync 자격 충족 여부. false 이면 markedComment 가 있어도 pick 미반영.
        markedCommentQualifiesForSync: latestMarkedComment?.qualifiesForSync ?? false,
        selectedAutomationCommentUpdated: markedComment?.updated ?? null,
        // 디버깅: 모든 comment 요약 (auto-archive vs human 구분, marker 매칭 여부)
        allComments: comments.map(c => {
          const t = weeklyAdfToText(c.body).trim();
          return {
            created: c.created,
            updated: c.updated,
            author: c.author?.displayName ?? "-",
            length: t.length,
            markers: t ? findMarkers(t) : [],
            preview: t.slice(0, 150),
          };
        }),
        // ─── 운영 정책 명시 ───
        policyDescription:
          "[2026-07-28 정책] customfield_10625 현재 Weekly → 최우선. " +
          "없으면 description Weekly 섹션, 그것도 없으면 Automation Bot 의 최신 " +
          "'<NN>주차 Weekly 공유사항' archive 댓글을 사용. " +
          "사람이 작성한 댓글 + marker 만 우연 매칭은 markedCommentQualifiesForSync=false 로 분류. " +
          "감지된 archive 댓글은 sources[]에 지난 Weekly 후보로 보존.",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `요청 실패: ${msg}` }, { status: 500 });
  }
}
