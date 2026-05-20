/**
 * Weekly 공유사항 파서
 * 순수 함수만 포함. KV/Redis 접근 없음.
 *
 * 2026-05-20 보강:
 *   - section marker: 대괄호 / 꺽쇠 / plain, 별칭 다중 지원
 *   - 날짜: M/D, M/D(요일), YYYY-MM-DD, YYYY/MM/DD, 범위(~)
 *   - 일정 라인: 슬래시 구분 + 자연어 fallback (status/날짜 키워드 추출)
 *   - role/status 별칭 확장
 *   - debug: sectionsFound, ignoredLines, warnings
 */
import type {
  ParsedWeekly, ParsedScheduleItem, ParsedRisk, ParsedNextAction,
  ScheduleStatus, ActionCategory, NoteSeverity,
} from "./weekly-types";

// ─── 정규화: status ────────────────────────────────────────────

export function normalizeStatus(raw: string): ScheduleStatus {
  const s = raw.trim();
  if (!s) return "확인필요";
  if (/^(진행\s*중|in\s*progress)$/i.test(s)) return "진행중";
  if (/^(완료\s*됨?|done|completed)$/i.test(s)) return "완료";
  if (/^(예정대로|예정)$/i.test(s)) return "예정";
  if (/^(미정|tbd|unknown)$/i.test(s)) return "확인필요";
  if (/^(확인\s*필요)$/i.test(s)) return "확인필요";
  if (/^(지연\s*중?|delayed)$/i.test(s)) return "지연";
  if (/^(보류|on\s*hold|hold)$/i.test(s)) return "보류";
  const map: Record<string, ScheduleStatus> = {
    "진행중": "진행중", "완료": "완료", "예정": "예정",
    "미정": "확인필요", "확인필요": "확인필요", "지연": "지연", "보류": "보류",
  };
  return map[s] ?? "확인필요";
}

// ─── 정규화: role ───────────────────────────────────────────────
// 결과는 mergeKey에 들어가므로 안정적인 표준 라벨 사용.

export function normalizeRole(raw: string): string {
  const s = raw.trim();
  if (!s) return "기타";
  // Milestone
  if (/kick[-\s]?off|킥\s*오프/i.test(s)) return "Kick-Off";
  if (/launch|론치|런치|오픈/i.test(s)) return "Launch";
  if (/release|릴리즈|릴리스|배포/i.test(s)) return "Release";
  // QA
  if (/\bqa\b|qc|테스트|test|검수|검증/i.test(s)) return "QA";
  // Dev
  if (/be[-\s]?pp/i.test(s))   return "BE-PP";
  if (/be[-\s]?sp/i.test(s))   return "BE-SP";
  if (/be[-\s]?ce/i.test(s))   return "BE-CE";
  if (/fe[-\s]?cfe/i.test(s))  return "FE-CFE";
  if (/fe[-\s]?dfe/i.test(s))  return "FE-DFE";
  if (/메가존/.test(s))         return "BE-메가존";
  if (/개발|api|코드\s*리뷰|code\s*review|development|^dev$|\bbe\b|\bfe\b/i.test(s)) return "개발";
  // PM / Planning
  if (/기획|요구사항|정책|planning|policy|requirement|product/i.test(s)) return "기획";
  // Design
  if (/디자인|design|\bui\b/i.test(s)) return "디자인";
  // Mobile / DA / CSE
  if (/mobile|모바일/i.test(s)) return "Mobile";
  if (/\bda\b/i.test(s))        return "DA";
  if (/\bcse\b/i.test(s))       return "CSE";
  return s;
}

const CANCEL_KEYWORDS = ["취소", "제외", "보류", "중단", "범위 제외", "진행 안 함", "대상 아님"];

// ─── 날짜 파싱 ─────────────────────────────────────────────────
// 지원: YYYY-MM-DD, YYYY/MM/DD, M/D, M/D(요일), MM-DD
// 연도 생략 시 fallbackYear (없으면 현재 연도)

function parseDate(raw: string, fallbackYear?: number): string | null {
  const s = raw.trim().replace(/[()월화수목금토일,\s]+$/, "").replace(/\s*\([일월화수목금토]\)\s*$/, "");
  const cleaned = s.trim();
  if (!cleaned || /^(미정|tbd|확인\s*필요|-|없음)$/i.test(cleaned)) return null;

  // YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(cleaned)) {
    const [y, m, d] = cleaned.split("-");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // YYYY/MM/DD
  const slash = cleaned.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slash) return `${slash[1]}-${slash[2].padStart(2, "0")}-${slash[3].padStart(2, "0")}`;

  // M/D (with optional weekday paren stripped above)
  const short = cleaned.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (short) {
    const year = fallbackYear ?? new Date().getFullYear();
    return `${year}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`;
  }
  // MM-DD
  const dash = cleaned.match(/^(\d{1,2})-(\d{1,2})$/);
  if (dash) {
    const year = fallbackYear ?? new Date().getFullYear();
    return `${year}-${dash[1].padStart(2, "0")}-${dash[2].padStart(2, "0")}`;
  }
  return null;
}

/** 라인 안에서 날짜/범위를 첫 매치만 추출 */
function extractDateRange(text: string, fallbackYear?: number): { start: string | null; end: string | null; raw: string } | null {
  // 범위: M/D(요일)? ~ M/D(요일)? 또는 YYYY-MM-DD ~ YYYY-MM-DD
  const rangeRe = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2})(?:\s*\([일월화수목금토]\))?\s*~\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2})(?:\s*\([일월화수목금토]\))?/;
  const r = text.match(rangeRe);
  if (r) {
    return { start: parseDate(r[1], fallbackYear), end: parseDate(r[2], fallbackYear), raw: r[0] };
  }
  // 단일: YYYY-MM-DD 또는 M/D(요일)?
  const singleRe = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2})(?:\s*\([일월화수목금토]\))?/;
  const s = text.match(singleRe);
  if (s) {
    const d = parseDate(s[1], fallbackYear);
    return { start: d, end: d, raw: s[0] };
  }
  return null;
}

// ─── 섹션 분리 ─────────────────────────────────────────────────
// 표준: [...], 꺽쇠: <...>, plain: 줄 단독으로 alias.
// 뒤 따라오는 anchor: 다음 [, <, 또는 다음 plain alias, EOF

const SECTION_ALIASES: Record<string, string[]> = {
  progress:   ["진행상황", "진행 중", "진행중", "진행 현황", "Progress", "주요 진행", "현황"],
  schedule:   ["일정", "Schedule", "스케줄", "타임라인"],
  risk:       ["이슈/리스크", "이슈·리스크", "이슈/콜아웃", "이슈", "리스크", "Risk", "Issue", "콜아웃"],
  nextAction: ["다음 액션", "다음액션", "Next Action", "Action Item", "ActionItem", "액션 아이템", "다음 단계"],
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 모든 alias의 모든 표기형(대괄호/꺽쇠/plain)을 한 정규식으로 통합 */
function buildSectionAnchor(): RegExp {
  const all: string[] = [];
  for (const aliases of Object.values(SECTION_ALIASES)) {
    for (const a of aliases) all.push(escapeRe(a));
  }
  // 매치: \[alias\] | <alias> | (줄 시작) alias (콜론 또는 줄 끝)
  return new RegExp(
    `(?:\\[\\s*(?:${all.join("|")})\\s*\\]|<\\s*(?:${all.join("|")})\\s*>|(?:^|\\n)\\s*(?:${all.join("|")})\\s*(?::|\\n|$))`,
    "im",
  );
}

const SECTION_ANCHOR = buildSectionAnchor();

function extractSection(text: string, group: keyof typeof SECTION_ALIASES): { content: string; matchedAlias: string | null } {
  const aliases = SECTION_ALIASES[group];
  for (const alias of aliases) {
    const aliasRe = escapeRe(alias);
    // 우선순위: 대괄호 → 꺽쇠 → plain (줄 단독)
    const patterns = [
      new RegExp(`\\[\\s*${aliasRe}\\s*\\][^\\n]*\\n([\\s\\S]*?)(?=\\n[ \\t]*\\[|\\n[ \\t]*<|$)`, "i"),
      new RegExp(`<\\s*${aliasRe}\\s*>[^\\n]*\\n([\\s\\S]*?)(?=\\n[ \\t]*\\[|\\n[ \\t]*<|$)`, "i"),
      // plain: 줄 시작 + alias + 콜론 또는 줄 끝
      new RegExp(`(?:^|\\n)[ \\t]*${aliasRe}[ \\t]*:?[ \\t]*\\n([\\s\\S]*?)(?=\\n[ \\t]*\\[|\\n[ \\t]*<|$)`, "i"),
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m && m[1] && m[1].trim()) {
        // plain match가 다른 섹션 anchor를 포함하지 않는지 확인 (greedy 방어)
        const content = trimToNextSectionAnchor(m[1]);
        if (content.trim()) {
          return { content: content.trim(), matchedAlias: alias };
        }
      }
    }
  }
  return { content: "", matchedAlias: null };
}

/** content 안에 다음 섹션 anchor가 끼어 있으면 그 앞까지 잘라냄 */
function trimToNextSectionAnchor(content: string): string {
  const m = content.match(SECTION_ANCHOR);
  if (!m || m.index === undefined) return content;
  // 첫 줄 자체가 anchor면 빈 컨텐츠
  return content.slice(0, m.index).trimEnd();
}

function extractBullets(section: string): string[] {
  return section
    .split("\n")
    .map(l => l.replace(/^[\s\-*•·●○◦]+/, "").trim())
    .filter(l => l.length > 0);
}

// ─── 일정 라인 파싱 ────────────────────────────────────────────
// 패턴 1 (슬래시 explicit): "{role}: {date_or_range} / {status} / {assignee}"
// 패턴 2 (자연어): "{role}: {date} {status}" 또는 "{free text} {date} {status}"
//                  status/날짜 키워드 추출

const STATUS_KEYWORDS = [
  "완료됨", "완료", "진행 중", "진행중", "지연 중", "지연",
  "보류", "예정대로", "예정", "미정", "확인필요", "확인 필요",
];

function findStatusKeyword(text: string): { kw: string; index: number } | null {
  for (const kw of STATUS_KEYWORDS) {
    const i = text.indexOf(kw);
    if (i >= 0) return { kw, index: i };
  }
  return null;
}

function parseScheduleLine(line: string, fallbackYear?: number): ParsedScheduleItem | null {
  if (!line.trim()) return null;

  const isCancelled = CANCEL_KEYWORDS.some(kw => line.includes(kw));

  // role split: 첫 ':' 위치
  let roleRaw = "";
  let rest = line.trim();
  const colon = rest.indexOf(":");
  if (colon > 0 && colon < 40) {  // role 부분이 너무 길면 콜론은 본문에 있는 거
    roleRaw = rest.slice(0, colon).trim();
    rest = rest.slice(colon + 1).trim();
  }

  let datePart = "";
  let statusRaw = "";
  let assigneeRaw = "";

  // 패턴 1: 명시적 field separator는 " / " (앞뒤 공백 강제) — 날짜의 M/D를 오인하지 않도록.
  // role: date / status / assignee
  // role: date / status
  const SLASH_SEP = /\s+\/\s+/;
  if (SLASH_SEP.test(rest)) {
    const parts = rest.split(SLASH_SEP).map(p => p.trim());
    datePart = parts[0] ?? "";
    statusRaw = parts[1] ?? "";
    assigneeRaw = parts[2] ?? "";
  }

  // 패턴 2: 자연어 — date/range/status 키워드 추출
  if (!datePart && !statusRaw) {
    const dr = extractDateRange(rest, fallbackYear);
    if (dr) datePart = dr.raw;
    const sk = findStatusKeyword(rest);
    if (sk) statusRaw = sk.kw;
  }

  // start/end 계산
  let startDate: string | null = null;
  let endDate: string | null = null;
  if (datePart) {
    if (datePart.includes("~")) {
      const [s, e] = datePart.split("~").map(p => p.trim());
      startDate = parseDate(s, fallbackYear);
      endDate = parseDate(e, fallbackYear);
    } else {
      startDate = parseDate(datePart, fallbackYear);
      endDate = startDate;
    }
  }

  // role이 없는데 status/date도 못 찾으면 line은 schedule 아님
  if (!roleRaw && !startDate && !statusRaw) return null;

  const normalizedRole = normalizeRole(roleRaw || "기타");

  return {
    role: roleRaw,
    normalizedRole,
    startDate,
    endDate,
    status: normalizeStatus(statusRaw),
    assignee: assigneeRaw ? assigneeRaw.trim() : null,
    rawText: line,
    isCancelled,
  };
}

// ─── Risk severity / Action category ───────────────────────────

export function inferRiskSeverity(content: string): NoteSeverity | null {
  const c = content.toLowerCase();
  if (/없음|주요\s*이슈\s*없음|이슈\s*없음/.test(c)) return null;
  if (/blocker|차단|일정\s*영향|론치\s*영향|배포\s*불가|승인\s*지연/.test(c)) return "high";
  if (/지연/.test(c)) return "high";
  if (/확인\s*필요|추가\s*검토|스펙\s*확인|의존성|리소스\s*부족/.test(c)) return "medium";
  if (/참고/.test(c)) return "low";
  return "medium";
}

export function inferActionCategory(content: string): ActionCategory {
  const c = content.toLowerCase();
  if (/일정\s*확정|날짜\s*확정|launch\s*일정|release\s*일정/.test(c)) return "schedule_confirmation";
  if (/검토\s*필요|확인\s*필요|논의\s*필요/.test(c)) return "planning_review";
  if (/api\s*공유|문서\s*공유|외부\s*부서|협의\s*필요/.test(c)) return "dependency";
  if (/qa|테스트|검수/.test(c)) return "qa";
  if (/배포|릴리즈|오픈|launch|론치/.test(c)) return "release";
  return "unknown";
}

// ─── ID 생성 ───────────────────────────────────────────────────

export function buildNoteId(
  ticketKey: string, sourceWeek: string, type: string, content: string,
): string {
  const raw = `${ticketKey}::${sourceWeek}::${type}::${content.slice(0, 40).replace(/\s+/g, "")}`;
  return raw.replace(/[^a-zA-Z0-9가-힣:_-]/g, "_");
}

export function buildMergeKey(ticketKey: string, normalizedRole: string): string {
  return `${ticketKey}::${normalizedRole}`;
}

// ─── 주차 추출 ─────────────────────────────────────────────────

export function parseWeekNumber(text: string): string {
  const m = text.match(/(\d+)\s*주차/);
  if (m) return `${m[1]}주차`;
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
  return `${week}주차`;
}

// ─── 메인 파서 ─────────────────────────────────────────────────

export function parseWeekly(text: string, ticketKey: string): ParsedWeekly {
  const now = new Date().toISOString();
  const sourceWeek = parseWeekNumber(text);
  const fallbackYear = new Date().getFullYear();
  const warnings: string[] = [];
  const sectionsFound: string[] = [];
  const consumedLines = new Set<string>();

  // ── 진행상황 ──
  const progressSec = extractSection(text, "progress");
  if (progressSec.matchedAlias) sectionsFound.push(`progress(${progressSec.matchedAlias})`);
  const progressItems = extractBullets(progressSec.content);
  progressItems.forEach(l => consumedLines.add(l));

  // ── 일정 ──
  const scheduleSec = extractSection(text, "schedule");
  if (scheduleSec.matchedAlias) sectionsFound.push(`schedule(${scheduleSec.matchedAlias})`);
  const scheduleItems: ParsedScheduleItem[] = [];
  for (const line of extractBullets(scheduleSec.content)) {
    consumedLines.add(line);
    try {
      const item = parseScheduleLine(line, fallbackYear);
      if (item) scheduleItems.push(item);
    } catch (e) {
      warnings.push(`schedule line parse failed: "${line.slice(0, 60)}" — ${(e as Error).message}`);
    }
  }
  // schedule 섹션이 없거나 비었으면 progressItems에서 일정 후보 추출 시도
  if (scheduleItems.length === 0) {
    for (const line of progressItems) {
      const item = parseScheduleLine(line, fallbackYear);
      // 날짜 또는 status가 있어야 schedule로 인정
      if (item && (item.startDate || item.status !== "확인필요")) {
        scheduleItems.push(item);
      }
    }
  }

  // ── 이슈/리스크 ──
  const riskSec = extractSection(text, "risk");
  if (riskSec.matchedAlias) sectionsFound.push(`risk(${riskSec.matchedAlias})`);
  const risks: ParsedRisk[] = [];
  let noIssues = false;
  for (const line of extractBullets(riskSec.content)) {
    consumedLines.add(line);
    const sev = inferRiskSeverity(line);
    if (sev === null) { noIssues = true; continue; }
    risks.push({ content: line, severity: sev, rawText: line });
  }

  // ── 다음 액션 ──
  const actionSec = extractSection(text, "nextAction");
  if (actionSec.matchedAlias) sectionsFound.push(`nextAction(${actionSec.matchedAlias})`);
  const nextActions: ParsedNextAction[] = [];
  for (const line of extractBullets(actionSec.content)) {
    consumedLines.add(line);
    nextActions.push({
      content: line,
      actionCategory: inferActionCategory(line),
      rawText: line,
    });
  }

  // ── ignored lines: 어느 섹션에도 안 들어간 줄 (header 줄 제외) ──
  const allBullets = extractBullets(text);
  const ignoredLines: string[] = [];
  for (const l of allBullets) {
    if (consumedLines.has(l)) continue;
    // section header 자체 또는 marker 줄은 무시
    if (/^\s*(\[.+\]|<.+>|🧭|\d+\s*주차)/.test(l)) continue;
    ignoredLines.push(l);
    if (ignoredLines.length >= 5) break;
  }

  if (sectionsFound.length === 0) {
    warnings.push("no_section_marker — 어떤 섹션도 매칭되지 않음");
  }

  return {
    ticketKey,
    sourceWeek,
    sourceText: text,
    parsedAt: now,
    progressItems,
    scheduleItems,
    risks,
    nextActions,
    noIssues,
    debug: { sectionsFound, ignoredLines, warnings },
  };
}
