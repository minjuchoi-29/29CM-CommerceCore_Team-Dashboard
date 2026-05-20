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
  SchedulePhase,
} from "./weekly-types";

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
  const content = line.trim();
  if (!content) {
    return { type: "note", confidence: "low", content, rawText: line };
  }

  const nonSchedule = matchesAny(content, NON_SCHEDULE_INDICATORS);
  const lowConf = matchesAny(content, LOW_CONFIDENCE_KEYWORDS);
  const isRisk = matchesAny(content, RISK_INDICATORS);

  // ── 분류 우선순위 (사용자 정책) ─────────────────────────────────
  //   schedule 자격 미달 line은 다음 순서로 분류:
  //     RISK_INDICATORS 매칭         → risk
  //     LOW_CONFIDENCE_KEYWORDS 매칭 → action (실제 follow-up 의미)
  //     그 외                        → note (UI 출력 안 함, 단순 설명/상황 line)
  //   "PTG plan ...", "yellow 유지" 같은 NON_SCHEDULE은 위 우선순위에 따라
  //   RISK도 LOW_CONF도 아니면 자동 ignored.
  const classifyDeclined = (declineReason: string) => ({
    type: (isRisk ? "risk" : lowConf ? "action" : "note") as LineClassification,
    confidence: "low" as Confidence,
    content, rawText: line,
    declineReason,
  });

  // 1) 설명/상태성 문장 (PTG plan / yellow 유지 / 정책 이슈 등)
  if (nonSchedule) {
    return classifyDeclined("non_schedule_indicator (PTG plan / 전환 조건 등)");
  }

  // 2) schedule line 시도
  const item = parseScheduleLine(content, fallbackYear);
  if (!item) {
    return classifyDeclined("schedule line parse failed");
  }

  // schedule 자격 판정은 phase taxonomy 기준 — resourceTeam(Core AI BE 등 자유 text)은 무관.
  const phaseOK = !!item.phase && ALLOWED_PHASES.has(item.phase);
  const hasDate = !!item.startDate;
  const hasClearStatus = item.status !== "확인필요";

  // 3) phase 화이트리스트 위반 → schedule 금지
  if (!phaseOK) {
    return classifyDeclined(`phase "${item.phase ?? "(none)"}" not in allowed phases`);
  }

  // 4) 날짜 없음 → schedule 금지
  if (!hasDate) {
    return classifyDeclined("no date");
  }

  // 5) low-confidence 키워드 매칭 → schedule 금지 (단, milestone phase는 예외)
  // 사용자 정책: Release/Launch/Kick-Off 같은 milestone은 조건부 표현이어도
  // medium confidence candidate로 허용 — "7/27 런칭 ETA 준수 가능 여부" 같은
  // 케이스도 일정 검토 대상이 되어야 함.
  const isMilestonePhase = item.phase === "Release" || item.phase === "Launch" || item.phase === "Kick-Off";
  if (lowConf && !isMilestonePhase) {
    return classifyDeclined("low_confidence keyword (follow-up 필요)");
  }

  // 6) 실행성 status 검증 — milestone phase는 status 비실행성이어도 허용 (조건부 일정도 candidate)
  if (!EXECUTABLE_STATUSES.has(item.status) && !isMilestonePhase) {
    return classifyDeclined(`status "${item.status}" not executable (need 예정/진행중/완료)`);
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

  // 정책: phase + resourceTeam 분리.
  // 1순위: 콜론 앞 role 텍스트에서 추출
  // 2순위: role이 비었거나 "기타"로만 잡히면, line 본문 전체에서 milestone 키워드 검색
  //         (예: "5/20 최종 론치 진행 예정" → phase=Launch, "7/1 일정 오픈" → Launch)
  let { phase, resourceTeam } = extractPhaseAndResource(roleRaw || "기타");
  if (phase === "기타") {
    const fullPR = extractPhaseAndResource(line);
    if (fullPR.phase !== "기타") {
      phase = fullPR.phase;
      resourceTeam = fullPR.resourceTeam;
    }
  }
  const normalizedRole = deriveNormalizedRole(phase, resourceTeam);

  return {
    role: roleRaw,
    normalizedRole,
    phase,
    resourceTeam,
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

  // ── Section header 없는 weekly 전체 fallback ──
  // customfield_10625처럼 PM이 자유롭게 적은 weekly는 [진행상황]/[일정] 같은 header가 없음.
  // 이 경우 전체 text의 모든 bullet/line을 classifyLine으로 분류:
  //   - 허용 role + 날짜 + non-low confidence  → schedule (high/medium)
  //   - 허용 role + 날짜 없음/low confidence  → action (low)
  //   - 허용 role 외                          → action 또는 note
  //   - 설명/상태성 문장 (PTG plan 등)         → note (또는 risk)
  // schedule이 되지 못한 candidate들은 classifiedLines에 보관 → UI에서 검토.
  const classifiedLines: NonNullable<ParsedWeekly["classifiedLines"]> = [];

  if (sectionsFound.length === 0) {
    const allBullets = extractBullets(text)
      // 첫 줄 marker는 제외
      .filter(l => !/^\s*(🧭|\d+\s*주차\s*Weekly\s*공유\s*사항)/.test(l));

    for (const line of allBullets) {
      consumedLines.add(line);
      try {
        const cls = classifyLine(line, fallbackYear);
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
        // 정책: type === "note"는 ignored — Weekly Summary 원문에만 남고,
        // 분리 영역(액션 박스) / progressItems에 push 안 함.
        // PTG plan / yellow 유지 같은 단순 설명 line이 복제되는 문제 방지.
      } catch (e) {
        warnings.push(`fallback classifyLine failed: "${line.slice(0, 60)}" — ${(e as Error).message}`);
      }
    }
    warnings.push(
      `no_section_marker — 전체 text fallback: schedule ${scheduleItems.length} / ` +
      `action ${nextActions.length} / risk ${risks.length} (note ignored)`,
    );
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
    debug: { sectionsFound, ignoredLines, warnings },
  };
}
