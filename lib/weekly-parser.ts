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
  ScheduleStatus, ActionCategory, NoteSeverity, Confidence, LineClassification,
  SchedulePhase, PhaseSource,
} from "./weekly-types";
import {
  buildAstFromPlainText, partitionBySections, traverseAst,
  printAstTree, type AstNode, type AstContext,
} from "./weekly-ast";

// ─── 정책 화이트리스트 / 키워드 ─────────────────────────────────
// Phase taxonomy — 운영 단계 (PM이 관리하는 실행 일정 단위).
// resourceTeam은 자유 text로 phase 안에 들어감 (예: "Core AI BE", "BE-PP", "메가존").
// schedule 자격 판정은 phase 기준.
export const ALLOWED_PHASES = new Set<string>([
  "Kick-Off", "기획", "디자인", "개발", "QA", "Release", "Launch",
]);

// 명시적 dev resource 명칭 — 발견되면 phase="개발"로 분류하고 raw 전체를 resourceTeam에 보관.
// "Core AI BE", "BE-PP", "FE-CFE", "메가존 개발 및 코드리뷰" 등 자유 조합 모두 처리.
const DEV_RESOURCE_PATTERNS: RegExp[] = [
  /be[-\s]?pp/i, /be[-\s]?sp/i, /be[-\s]?ce/i, /be[-\s]?cfe/i,
  /fe[-\s]?cfe/i, /fe[-\s]?dfe/i, /fe[-\s]?sotatek/i,
  /\bbe\b/i, /\bfe\b/i,
  /메가존/, /sotatek/i, /core/i, /platform/i,
  /\bcfe\b/i, /\bdfe\b/i, /\bsp\b/i, /\bpp\b/i,
  /mobile/i, /모바일/, /\bda\b/i, /\bcse\b/i,
  /engineering/i,
];

/**
 * raw role text를 phase + resourceTeam으로 분리.
 * 운영 organisation 구조와 phase taxonomy를 모두 표현.
 *
 * - phase: ALLOWED_PHASES 중 하나 또는 "기타"
 * - resourceTeam: 자유 text (null이면 phase만 있는 단일 단계)
 *
 * 예시:
 *   "Core AI BE"            → { phase: "개발", resourceTeam: "Core AI BE" }
 *   "BE-PP"                 → { phase: "개발", resourceTeam: "BE-PP" }
 *   "메가존 개발 및 코드리뷰" → { phase: "개발", resourceTeam: "메가존 개발 및 코드리뷰" }
 *   "기획"                  → { phase: "기획", resourceTeam: null }
 *   "QA-내부"               → { phase: "QA",   resourceTeam: "내부" }
 *   "Launch"                → { phase: "Launch", resourceTeam: null }
 *   "PTG plan"              → { phase: "기타", resourceTeam: "PTG plan" }
 */
export function extractPhaseAndResource(raw: string): { phase: SchedulePhase; resourceTeam: string | null } {
  const s = raw.trim();
  if (!s) return { phase: "기타", resourceTeam: null };

  // 1. Milestone (resource 없는 단일 phase) — 운영 키워드 확장
  if (/kick[-\s]?off|킥\s*오프/i.test(s)) return { phase: "Kick-Off", resourceTeam: null };
  // Release: 배포 / sign-off / 릴리즈 / 릴리스
  if (/release|릴리즈|릴리스|배포|sign[-\s]?off/i.test(s)) return { phase: "Release", resourceTeam: null };
  // Launch: 론치 / 런치 / 런칭 / 오픈 / 대고객 (오픈|런칭)
  if (/launch|론치|런치|런칭|오픈|대고객/i.test(s)) return { phase: "Launch", resourceTeam: null };

  // 2. QA (phase + 선택적 resource)
  if (/\bqa\b|qc|테스트|test|검수|검증/i.test(s)) {
    const stripped = s.replace(/\bqa\b|qc|테스트|test|검수|검증/gi, "").replace(/[-:\s]+/g, " ").trim();
    return { phase: "QA", resourceTeam: stripped || null };
  }

  // 3. 디자인
  if (/디자인|design|\bui\b|\bux\b/i.test(s)) {
    const stripped = s.replace(/디자인|design|\bui\b|\bux\b/gi, "").replace(/[-:\s]+/g, " ").trim();
    return { phase: "디자인", resourceTeam: stripped || null };
  }

  // 4. 개발 — dev resource pattern 매칭 또는 개발 키워드
  // (기획보다 먼저 체크 — "Core AI BE 기획"처럼 섞여 있어도 dev resource 우선)
  const hasDevResource = DEV_RESOURCE_PATTERNS.some(re => re.test(s));
  const hasDevKeyword  = /개발|코드\s*리뷰|development|api/i.test(s) || /^dev$/i.test(s);
  if (hasDevResource || hasDevKeyword) {
    const isJustDev = /^(개발|dev|development|코드리뷰|코드\s*리뷰)$/i.test(s);
    return { phase: "개발", resourceTeam: isJustDev ? null : s };
  }

  // 5. 기획
  if (/기획|planning|요구사항|정책|product|requirement/i.test(s)) {
    const stripped = s.replace(/기획|planning|요구사항|정책|product|requirement/gi, "").replace(/[-:\s]+/g, " ").trim();
    return { phase: "기획", resourceTeam: stripped || null };
  }

  // 6. fallback — schedule 자격 없음 (ALLOWED_PHASES 미포함)
  return { phase: "기타", resourceTeam: s };
}

/** normalizedRole derivation: resourceTeam이 있으면 그것, 없으면 phase. mergeKey 호환용. */
export function deriveNormalizedRole(phase: SchedulePhase, resourceTeam: string | null): string {
  return resourceTeam || phase;
}

// @deprecated — backward compat. 새 코드는 ALLOWED_PHASES + extractPhaseAndResource 사용.
export const ALLOWED_SCHEDULE_ROLES = new Set<string>([
  "Kick-Off", "기획", "디자인", "개발",
  "BE-SP", "BE-PP", "BE-CFE", "BE-CE", "BE-메가존",
  "FE-CFE", "FE-DFE", "FE-Sotatek",
  "Mobile", "DA", "QA", "CSE", "Release", "Launch",
]);

// Follow-up action 의미가 명확한 키워드 — schedule이 아니면 action으로 분류.
// 매칭 안 되면 자동 ignored (note 박스에 노출 안 됨).
// 사용자 정책: "실제 follow-up 의미가 있어야 함".
const LOW_CONFIDENCE_KEYWORDS = [
  "확인 필요", "확인필요",
  "논의 필요", "논의필요", "논의중", "논의 중",
  "리뷰 필요", "리뷰필요",
  "검토 필요", "검토필요",
  "산정 필요", "산정필요",
  "가능 여부", "준수 가능",
  "재산정", "재검토",
  "ETA 준수", "ETA 가능", "ETA risk",
  "R&R 논의", "R&R 확정", "R&R 정리",
  "follow-up", "후속 조치",
  "일정 미확정", "일정미확정",
  "TBD", "tbd",
];

// 설명/상태성/조건성 표현 — schedule이 아닌 note로 분류
const NON_SCHEDULE_INDICATORS = [
  "PTG plan", "ptg plan",
  "yellow 유지", "green 유지", "red 유지",
  "yellow 전환", "green 전환", "red 전환",
  "yellow → green", "green → yellow",
  "blocker", "리소스 부족", "리소스 재산정",
  "정책 이슈", "조건부 진행", "전제 조건", "선행 조건",
];

// 리스크/이슈 시그널 — note 대신 risk로 분류
const RISK_INDICATORS = [
  "blocker", "차단", "이슈", "리스크", "지연", "장애", "위험",
  "dependency", "의존성", "선행 작업",
];

// 실행성 status — 이 외(확인필요/미정/지연/보류)는 schedule 자격 박탈.
// 사용자 정책: "실제 실행 일정"만 Gantt row.
const EXECUTABLE_STATUSES: Set<ScheduleStatus> = new Set(["예정", "진행중", "완료"]);

function matchesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => text.includes(kw) || lower.includes(kw.toLowerCase()));
}

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

/**
 * @deprecated AST 마이그레이션 이후 사용되지 않음. emergency rollback / 디버깅 reference로 보존.
 * 신규 코드는 lib/weekly-ast의 detectSectionMarker + partitionBySections를 사용.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

/**
 * @deprecated AST 마이그레이션 이후 사용되지 않음. emergency rollback / 디버깅 reference로 보존.
 * 신규 코드는 lib/weekly-ast의 buildAstFromPlainText를 사용.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

/**
 * 한 줄을 분류 — schedule row로 적합한지 아닌지 판단.
 * 정책:
 *   - 허용 role + 명확한 날짜 + low-confidence 표현 없음 → schedule (high/medium)
 *   - 허용 role + 날짜 없음 → action (low)
 *   - 허용 role 외 → note 또는 action (low)
 *   - NON_SCHEDULE_INDICATORS 매칭 → note (설명성 문장)
 *   - RISK_INDICATORS 매칭 → risk
 */
export function classifyLine(
  line: string,
  fallbackYear?: number,
): {
  type: LineClassification;
  confidence: Confidence;
  content: string;
  rawText: string;
  schedule?: ParsedScheduleItem;
  declineReason?: string;
} {
  // backward compat — ctx 없이 호출 시 parent context 없음
  return classifyLineWithCtx(line, undefined, fallbackYear);
}

/**
 * classifyLine의 context-aware 버전. AST traversal에서 호출.
 * ctx?.parentPhase가 있으면 schedule 추출 시 parent inheritance가 동작.
 */
export function classifyLineWithCtx(
  line: string,
  ctx: { parentPhase?: SchedulePhase; parentText?: string } | undefined,
  fallbackYear?: number,
): {
  type: LineClassification;
  confidence: Confidence;
  content: string;
  rawText: string;
  schedule?: ParsedScheduleItem;
  declineReason?: string;
} {
  const content = line.trim();
  if (!content) {
    return { type: "note", confidence: "low", content, rawText: line };
  }

  const nonSchedule = matchesAny(content, NON_SCHEDULE_INDICATORS);
  const lowConf = matchesAny(content, LOW_CONFIDENCE_KEYWORDS);
  const isRisk = matchesAny(content, RISK_INDICATORS);

  // explainability를 위해, declined 결과에도 parseScheduleLineWithCtx로 얻은 schedule meta를
  // (있을 때만) 첨부한다. UI/debug에서 "왜 schedule 자격이 박탈됐는지" + "추정된 phase는 무엇이었는지"를
  // 함께 보여주기 위함. scheduleItems push 정책은 변경 없음(type === "schedule"일 때만).
  const classifyDeclined = (declineReason: string, computedItem?: ParsedScheduleItem) => ({
    type: (isRisk ? "risk" : lowConf ? "action" : "note") as LineClassification,
    confidence: "low" as Confidence,
    content, rawText: line,
    schedule: computedItem,
    declineReason,
  });

  // 1) 설명/상태성 문장 (PTG plan / yellow 유지 / 정책 이슈 등)
  if (nonSchedule) {
    return classifyDeclined("non_schedule_indicator (PTG plan / 전환 조건 등)");
  }

  // 2) schedule line 시도 — context 전달
  const item = parseScheduleLineWithCtx(content, ctx, fallbackYear);
  if (!item) {
    return classifyDeclined("schedule line parse failed");
  }

  // schedule 자격 판정은 phase taxonomy 기준 — resourceTeam(Core AI BE 등 자유 text)은 무관.
  const phaseOK = !!item.phase && ALLOWED_PHASES.has(item.phase);
  const hasDate = !!item.startDate;
  const hasClearStatus = item.status !== "확인필요";

  // 3) phase 화이트리스트 위반 → schedule 금지
  if (!phaseOK) {
    return classifyDeclined(`phase "${item.phase ?? "(none)"}" not in allowed phases`, item);
  }

  // 4) 날짜 없음 → schedule 금지
  if (!hasDate) {
    return classifyDeclined("no date", item);
  }

  // 5) low-confidence 키워드 매칭 → schedule 금지 (단, milestone phase는 예외)
  // 사용자 정책: Release/Launch/Kick-Off 같은 milestone은 조건부 표현이어도
  // medium confidence candidate로 허용 — "7/27 런칭 ETA 준수 가능 여부" 같은
  // 케이스도 일정 검토 대상이 되어야 함.
  const isMilestonePhase = item.phase === "Release" || item.phase === "Launch" || item.phase === "Kick-Off";
  if (lowConf && !isMilestonePhase) {
    return classifyDeclined("low_confidence keyword (follow-up 필요)", item);
  }

  // 6) 실행성 status 검증 — milestone phase는 status 비실행성이어도 허용 (조건부 일정도 candidate)
  if (!EXECUTABLE_STATUSES.has(item.status) && !isMilestonePhase) {
    return classifyDeclined(`status "${item.status}" not executable (need 예정/진행중/완료)`, item);
  }

  // 7) confidence 결정
  //    - milestone + lowConf  → low (조건부 표현이라 확정 X, candidate로만)
  //    - 일반 + clear status   → high
  //    - 일반 + 확인필요 status → medium
  const confidence: Confidence =
    (isMilestonePhase && lowConf) ? "low"
    : hasClearStatus                ? "high"
    :                                 "medium";
  const schedule: ParsedScheduleItem = { ...item, confidence };
  return { type: "schedule", confidence, content, rawText: line, schedule };
}

// ─── Hybrid phase resolution 정책 (Option D) ──────────────────
//
// 운영 의도:
//   - Release / Launch / Kick-Off 같은 milestone phase는 활동의 본질 → 자체 매칭 우선.
//   - QA / 기획 / 디자인 / 개발은 운영 단계 컨텍스트 → 부모 inheritance 우선.
//
// 효과:
//   - "잔여 개발 사항(parent=개발) → CEE 피처플래그 적용 배포(self=Release)"
//     → milestone이므로 self 우선 → Release, phaseSource="lineBody"
//   - "QA(parent=QA) → 5/19 파트너 어드민 작업(self=기타)"
//     → self 매칭 실패 → parent 상속 → QA, phaseSource="parentInheritance"
//   - "기획 : 5/21 리뷰 예정(roleRaw=기획)"
//     → roleRaw 매칭, non-milestone, parent 없음 → 기획, phaseSource="roleRaw"
//
// phaseSource 메타는 ParsedScheduleItem에 옵셔널로 노출되어 UI/debug에서
// "왜 이 phase로 분류됐는가"를 즉시 확인할 수 있게 한다.

export const MILESTONE_PHASES = new Set<SchedulePhase>(["Release", "Launch", "Kick-Off"]);

/**
 * Hybrid 정책에 따라 phase / resourceTeam / phaseSource를 결정.
 *
 * 우선순위 chain:
 *   1) roleRaw 매칭 — milestone이면 그대로, non-milestone + parentPhase 있으면 parent
 *   2) lineBody 매칭 — milestone이면 그대로, non-milestone + parentPhase 있으면 parent
 *   3) parentPhase 있으면 그대로 상속 (자체 매칭 모두 실패)
 *   4) 그 외 — "기타"로 결정 (schedule 자격 박탈)
 *
 * resourceTeam은 자체 매칭(roleRaw / lineBody)일 때만 그 매칭 결과로 채워지고,
 * parent inheritance인 경우 null (부모는 phase만 전달, resourceTeam은 자식 고유 정보가
 * 없으면 부여하지 않음 — 향후 stable identity 단계에서 자식 raw text 기반으로 도출).
 */
export function resolvePhaseWithContext(
  roleRaw: string,
  lineFull: string,
  parentPhase: SchedulePhase | undefined,
): { phase: SchedulePhase; resourceTeam: string | null; phaseSource: PhaseSource; inheritedFromParentText: string | null } {
  // 1. roleRaw
  if (roleRaw && roleRaw.trim()) {
    const r = extractPhaseAndResource(roleRaw);
    if (r.phase !== "기타") {
      if (MILESTONE_PHASES.has(r.phase)) {
        return { phase: r.phase, resourceTeam: r.resourceTeam, phaseSource: "roleRaw", inheritedFromParentText: null };
      }
      if (parentPhase) {
        return { phase: parentPhase, resourceTeam: null, phaseSource: "parentInheritance", inheritedFromParentText: null /* 호출자가 채움 */ };
      }
      return { phase: r.phase, resourceTeam: r.resourceTeam, phaseSource: "roleRaw", inheritedFromParentText: null };
    }
  }
  // 2. lineBody
  const b = extractPhaseAndResource(lineFull);
  if (b.phase !== "기타") {
    if (MILESTONE_PHASES.has(b.phase)) {
      return { phase: b.phase, resourceTeam: b.resourceTeam, phaseSource: "lineBody", inheritedFromParentText: null };
    }
    if (parentPhase) {
      return { phase: parentPhase, resourceTeam: null, phaseSource: "parentInheritance", inheritedFromParentText: null };
    }
    return { phase: b.phase, resourceTeam: b.resourceTeam, phaseSource: "lineBody", inheritedFromParentText: null };
  }
  // 3. parent fallback
  if (parentPhase) {
    return { phase: parentPhase, resourceTeam: null, phaseSource: "parentInheritance", inheritedFromParentText: null };
  }
  // 4. nothing matched
  return { phase: "기타", resourceTeam: lineFull.trim() || null, phaseSource: "lineBody", inheritedFromParentText: null };
}

/**
 * parseScheduleLine의 context-aware 버전. AST traversal에서 사용.
 *
 * ctx?.parentPhase가 주어지면 Hybrid 정책(Option D)에 따라 phase 결정.
 * ctx가 undefined이면 기존 parseScheduleLine과 동일 동작 (parentPhase = undefined).
 */
export function parseScheduleLineWithCtx(
  line: string,
  ctx: { parentPhase?: SchedulePhase; parentText?: string } | undefined,
  fallbackYear?: number,
): ParsedScheduleItem | null {
  if (!line.trim()) return null;

  const isCancelled = CANCEL_KEYWORDS.some(kw => line.includes(kw));

  let roleRaw = "";
  let rest = line.trim();
  const colon = rest.indexOf(":");
  if (colon > 0 && colon < 40) {
    roleRaw = rest.slice(0, colon).trim();
    rest = rest.slice(colon + 1).trim();
  }

  let datePart = "";
  let statusRaw = "";
  let assigneeRaw = "";

  const SLASH_SEP = /\s+\/\s+/;
  if (SLASH_SEP.test(rest)) {
    const parts = rest.split(SLASH_SEP).map(p => p.trim());
    datePart = parts[0] ?? "";
    statusRaw = parts[1] ?? "";
    assigneeRaw = parts[2] ?? "";
  }
  if (!datePart && !statusRaw) {
    const dr = extractDateRange(rest, fallbackYear);
    if (dr) datePart = dr.raw;
    const sk = findStatusKeyword(rest);
    if (sk) statusRaw = sk.kw;
  }

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

  if (!roleRaw && !startDate && !statusRaw) return null;

  const resolved = resolvePhaseWithContext(roleRaw, line, ctx?.parentPhase);
  const inheritedFromParentText = resolved.phaseSource === "parentInheritance"
    ? (ctx?.parentText ?? null)
    : null;
  const normalizedRole = deriveNormalizedRole(resolved.phase, resolved.resourceTeam);

  return {
    role: roleRaw,
    normalizedRole,
    phase: resolved.phase,
    resourceTeam: resolved.resourceTeam,
    startDate,
    endDate,
    status: normalizeStatus(statusRaw),
    assignee: assigneeRaw ? assigneeRaw.trim() : null,
    rawText: line,
    isCancelled,
    phaseSource: resolved.phaseSource,
    inheritedFromParentText,
  };
}

/**
 * Backward-compat wrapper. ctx 없이 호출되면 parent context 없는 상태로 처리되어
 * 기존 동작과 동일. AST 경로는 parseScheduleLineWithCtx를 직접 호출.
 *
 * 단, phase 정책은 새 Hybrid 정책(Option D)을 따른다 — 기존 코드의 fallback chain
 * (roleRaw → lineBody)이 parent inheritance 없이 그대로 동작하므로 회귀 없음.
 *
 * @deprecated 외부 호출자가 없음. 향후 정리 가능.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function parseScheduleLine(line: string, fallbackYear?: number): ParsedScheduleItem | null {
  return parseScheduleLineWithCtx(line, undefined, fallbackYear);
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
//
// 운영 흐름:
//   1. 입력 text를 AST(buildAstFromPlainText)로 변환 — bullet hierarchy + indent 보존.
//   2. partitionBySections로 section marker 기준 분할:
//        - marker 있는 경우: 각 section의 노드만 해당 카테고리 추출
//        - marker 없는 경우: 전체 AST를 classifyLineWithCtx로 fallback 분류
//   3. 각 section/fallback에서 traverseAst로 item을 방문하면서
//        parent phase context를 자식 item에 propagate (Hybrid 정책: Option D).
//   4. ParsedWeekly schema 동일 — 기존 호출자(weekly-sync route, mergeWeeklySync) 변경 없음.
//
// 회귀 방지:
//   - section marker가 있는 weekly는 기존 동작과 동일한 결과 (단, hierarchy가 있다면 더 정확).
//   - 자유형식 weekly는 fallback path가 동일하게 classifyLineWithCtx를 사용 (ctx는 빈 값).
//   - phase 정책 차이: Hybrid 정책 적용 — 부모 inheritance가 추가됐을 뿐 기존 매칭은 그대로 통과.

export function parseWeekly(text: string, ticketKey: string): ParsedWeekly {
  const now = new Date().toISOString();
  const sourceWeek = parseWeekNumber(text);
  const fallbackYear = new Date().getFullYear();
  const warnings: string[] = [];
  const sectionsFoundDebug: string[] = [];

  // ── 1. AST build ───────────────────────────────────────────
  const ast = buildAstFromPlainText(text);
  const { sections, unsectioned, hasAnyMarker } = partitionBySections(ast);

  if (hasAnyMarker) {
    for (const g of ["progress", "schedule", "risk", "nextAction"] as const) {
      if (sections[g].length > 0) sectionsFoundDebug.push(g);
    }
  }

  // ── 2. progressItems — progress section의 item.text + para.text 모두 ──
  const progressItems: string[] = [];
  if (hasAnyMarker) {
    for (const root of sections.progress) {
      collectAllItemTexts(root).forEach(t => progressItems.push(t));
    }
  }

  // ── 3. scheduleItems — schedule section traversal with context ──
  const scheduleItems: ParsedScheduleItem[] = [];

  function emitScheduleFromItem(node: AstNode, ctx: AstContext): SchedulePhase | undefined {
    const item = parseScheduleLineWithCtx(
      node.text,
      { parentPhase: ctx.parentPhase as SchedulePhase | undefined, parentText: ctx.parentText },
      fallbackYear,
    );
    if (item && item.phase && ALLOWED_PHASES.has(item.phase) && item.startDate) {
      scheduleItems.push(item);
    }
    // 자식에게 propagate할 phase 결정:
    //   - 본인이 허용 phase로 잡혔으면 그 phase
    //   - 자식이 이미 effective ctx를 받았으면 그대로 (resolvePhaseWithContext가 처리)
    if (item && item.phase && item.phase !== "기타") return item.phase;
    return undefined;
  }

  if (hasAnyMarker) {
    for (const root of sections.schedule) {
      traverseAst(root, { itemPath: [], parentPhase: undefined, parentText: undefined }, (n, ctx) => {
        const propagatePhase = emitScheduleFromItem(n, ctx);
        return propagatePhase ? { propagatePhase } : undefined;
      });
    }
    // 기존 운영 정책 유지: schedule section이 비었으면 progress section에서도 일정 후보 추출
    if (scheduleItems.length === 0 && sections.progress.length > 0) {
      for (const root of sections.progress) {
        traverseAst(root, { itemPath: [], parentPhase: undefined, parentText: undefined }, (n, ctx) => {
          const item = parseScheduleLineWithCtx(
            n.text,
            { parentPhase: ctx.parentPhase as SchedulePhase | undefined, parentText: ctx.parentText },
            fallbackYear,
          );
          if (item && (item.startDate || item.status !== "확인필요")
              && item.phase && ALLOWED_PHASES.has(item.phase)) {
            scheduleItems.push(item);
          }
          return item && item.phase && item.phase !== "기타" ? { propagatePhase: item.phase } : undefined;
        });
      }
    }
  }

  // ── 4. risks — risk section traversal ─────────────────────
  const risks: ParsedRisk[] = [];
  let noIssues = false;
  if (hasAnyMarker) {
    for (const root of sections.risk) {
      for (const t of collectAllItemTexts(root)) {
        const sev = inferRiskSeverity(t);
        if (sev === null) { noIssues = true; continue; }
        risks.push({ content: t, severity: sev, rawText: t });
      }
    }
  }

  // ── 5. nextActions — nextAction section traversal ─────────
  const nextActions: ParsedNextAction[] = [];
  if (hasAnyMarker) {
    for (const root of sections.nextAction) {
      for (const t of collectAllItemTexts(root)) {
        nextActions.push({ content: t, actionCategory: inferActionCategory(t), rawText: t });
      }
    }
  }

  // ── 6. classifiedLines + section marker 없는 경우 fallback ─
  const classifiedLines: NonNullable<ParsedWeekly["classifiedLines"]> = [];

  if (!hasAnyMarker) {
    // section marker가 전혀 없으면 전체 AST(=unsectioned)를 classifyLineWithCtx로 분류
    for (const root of unsectioned) {
      traverseAst(root, { itemPath: [], parentPhase: undefined, parentText: undefined }, (n, ctx) => {
        const cls = classifyLineWithCtx(
          n.text,
          { parentPhase: ctx.parentPhase as SchedulePhase | undefined, parentText: ctx.parentText },
          fallbackYear,
        );
        classifiedLines.push({
          type: cls.type,
          confidence: cls.confidence,
          content: cls.content,
          rawText: cls.rawText,
          schedule: cls.schedule,
          declineReason: cls.declineReason,
        });
        if (cls.type === "schedule" && cls.schedule) {
          scheduleItems.push(cls.schedule);
        } else if (cls.type === "risk") {
          risks.push({ content: cls.content, severity: "medium", rawText: cls.rawText });
        } else if (cls.type === "action") {
          nextActions.push({
            content: cls.content,
            actionCategory: inferActionCategory(cls.content),
            rawText: cls.rawText,
          });
        }
        // schedule로 잡힌 경우 자식에게 phase propagate (운영 단계 컨텍스트 유지)
        if (cls.type === "schedule" && cls.schedule?.phase && cls.schedule.phase !== "기타") {
          return { propagatePhase: cls.schedule.phase };
        }
        // schedule이 아니어도 본인 text에서 phase가 잡히면 propagate (헤더성 line이라도)
        const own = extractPhaseAndResource(n.text);
        if (own.phase !== "기타") return { propagatePhase: own.phase };
        return undefined;
      });
    }
    warnings.push(
      `no_section_marker — AST fallback: schedule ${scheduleItems.length} / ` +
      `action ${nextActions.length} / risk ${risks.length} (note ignored)`,
    );
  }

  // ── 7. ignored lines + debug (간소화 — AST 도입으로 line-level tracking 불필요) ──
  // 운영자가 "추출 안 된 line"을 확인하고 싶을 때 AST tree에서 직접 확인 가능.
  // 기존 ignoredLines 의미를 유지하려면 unsectioned section의 first-level item 중
  // schedule/risk/action으로 분류되지 않은 line을 모은다.
  const ignoredLines: string[] = [];
  for (const c of classifiedLines) {
    if (c.type === "note" && ignoredLines.length < 5) ignoredLines.push(c.content);
  }

  // ── 8. phaseSource breakdown (debug) ──
  const phaseSourceCounts: Record<string, number> = {};
  for (const s of scheduleItems) {
    const k = s.phaseSource ?? "unknown";
    phaseSourceCounts[k] = (phaseSourceCounts[k] ?? 0) + 1;
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
    classifiedLines,
    debug: {
      sectionsFound: sectionsFoundDebug,
      ignoredLines,
      warnings,
      // 확장 debug 정보 — UI/로그용. 기존 schema와 호환 (debug는 free-form).
      ...(({
        astTree: printAstTree(ast),
        astTopLevelChildren: ast.children.length,
        hasAnyMarker,
        phaseSourceCounts,
      } as unknown) as Record<string, unknown>),
    },
  };
}

/**
 * AST subtree에서 모든 item.text와 standalone para.text를 수집.
 * progress/risk/nextAction section처럼 hierarchy를 schedule처럼 살리지 않고
 * 단순히 텍스트를 모으는 케이스에서 사용.
 */
function collectAllItemTexts(node: AstNode): string[] {
  const out: string[] = [];
  function walk(n: AstNode): void {
    if (n.kind === "item" && n.text) out.push(n.text);
    if (n.kind === "para" && n.text) out.push(n.text);
    for (const c of n.children) walk(c);
  }
  walk(node);
  return out;
}
