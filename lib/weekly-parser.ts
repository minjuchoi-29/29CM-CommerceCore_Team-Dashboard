/**
 * Weekly 공유사항 파서
 * 순수 함수만 포함. KV/Redis 접근 없음.
 */
import type {
  ParsedWeekly, ParsedScheduleItem, ParsedRisk, ParsedNextAction,
  ScheduleStatus, ActionCategory, NoteSeverity,
} from "./weekly-types";

// ─── 정규화 ────────────────────────────────────────────────────

export function normalizeStatus(raw: string): ScheduleStatus {
  const s = raw.trim();
  if (/^(진행\s*중|in\s*progress)$/i.test(s)) return "진행중";
  if (/^(완료\s*됨?|done|completed)$/i.test(s)) return "완료";
  if (/^(미정|tbd|확인\s*필요|unknown)$/i.test(s)) return "확인필요";
  if (/^(지연\s*중?|delayed)$/i.test(s)) return "지연";
  if (/^(보류|on\s*hold|hold)$/i.test(s)) return "보류";
  if (/^예정$/i.test(s)) return "예정";
  // exact matches
  const map: Record<string, ScheduleStatus> = {
    "진행중": "진행중", "완료": "완료", "예정": "예정",
    "미정": "확인필요", "확인필요": "확인필요", "지연": "지연", "보류": "보류",
  };
  return map[s] ?? "확인필요";
}

export function normalizeRole(raw: string): string {
  const s = raw.trim();
  if (/^(kick-?off|킥\s*오프)$/i.test(s)) return "Kick-Off";
  if (/^(개발|development|dev|be|fe|be-pp|pp)$/i.test(s)) return s.toUpperCase() === s ? s : "개발";
  if (/^(qa|qc|테스트|test)$/i.test(s)) return "QA";
  if (/^(release|릴리즈|배포)$/i.test(s)) return "Release";
  if (/^(launch|론치|런치|오픈)$/i.test(s)) return "Launch";
  if (/^(기획|planning)$/i.test(s)) return "기획";
  if (/^(디자인|design|ui)$/i.test(s)) return "디자인";
  return s;
}

const CANCEL_KEYWORDS = ["취소", "제외", "보류", "중단", "범위 제외", "진행 안 함", "대상 아님"];

// ─── 날짜 파싱 ─────────────────────────────────────────────────

function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s || /^(미정|tbd|확인\s*필요|-|없음)$/i.test(s)) return null;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // YYYY/MM/DD
  const slash = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (slash) return `${slash[1]}-${slash[2]}-${slash[3]}`;
  return null;
}

// ─── 섹션 분리 ─────────────────────────────────────────────────

function extractSection(text: string, sectionName: string): string {
  // [섹션명] 이후 다음 [섹션] 또는 끝까지
  const pattern = new RegExp(
    `\\[${sectionName}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n\\[|$)`,
    "i"
  );
  const m = text.match(pattern);
  return m ? m[1].trim() : "";
}

function extractBullets(section: string): string[] {
  return section
    .split("\n")
    .map(l => l.replace(/^[\s\-*•]+/, "").trim())
    .filter(l => l.length > 0);
}

// ─── 일정 파싱 ─────────────────────────────────────────────────

function parseScheduleLine(line: string): ParsedScheduleItem | null {
  // 패턴: {role}: {date_or_미정} [~ {endDate}] / {status} [/ {assignee}]
  // 예: "개발: 2026-04-28 ~ 2026-05-07 / 완료 / BE-PP"
  // 예: "Release: 미정 / 확인필요"
  const colon = line.indexOf(":");
  if (colon < 0) return null;

  const roleRaw = line.slice(0, colon).trim();
  const rest = line.slice(colon + 1).trim();
  const parts = rest.split("/").map(p => p.trim());

  // date part (parts[0])
  let startDate: string | null = null;
  let endDate: string | null = null;
  const datePart = parts[0] ?? "";
  if (datePart.includes("~")) {
    const [s, e] = datePart.split("~").map(p => p.trim());
    startDate = parseDate(s);
    endDate = parseDate(e);
  } else {
    startDate = parseDate(datePart);
    endDate = startDate;  // single date
  }

  const statusRaw = parts[1] ?? "확인필요";
  const assigneeRaw = parts[2] ?? null;

  const isCancelled = CANCEL_KEYWORDS.some(kw => line.includes(kw));
  const normalizedRole = normalizeRole(roleRaw);

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

// ─── Risk severity ─────────────────────────────────────────────

export function inferRiskSeverity(content: string): NoteSeverity | null {
  const c = content.toLowerCase();
  if (/없음|주요\s*이슈\s*없음|이슈\s*없음/.test(c)) return null;  // noIssues
  if (/blocker|차단|일정\s*영향|론치\s*영향|배포\s*불가|승인\s*지연/.test(c)) return "high";
  if (/지연/.test(c)) return "high";  // "지연" 자체가 high
  if (/확인\s*필요|추가\s*검토|스펙\s*확인|의존성|리소스\s*부족/.test(c)) return "medium";
  if (/참고/.test(c)) return "low";
  return "medium";  // default
}

// ─── Action category ──────────────────────────────────────────

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
  ticketKey: string, sourceWeek: string, type: string, content: string
): string {
  // 단순 hash: 내용 앞 40자 기반 (crypto 없이)
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
  // fallback: 오늘 날짜 기반
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
  return `${week}주차`;
}

// ─── 메인 파서 ─────────────────────────────────────────────────

export function parseWeekly(text: string, ticketKey: string): ParsedWeekly {
  const now = new Date().toISOString();
  const sourceWeek = parseWeekNumber(text);

  // 진행상황
  const progressSection = extractSection(text, "진행상황");
  const progressItems = extractBullets(progressSection);

  // 일정
  const scheduleSection = extractSection(text, "일정");
  const scheduleItems: ParsedScheduleItem[] = [];
  for (const line of extractBullets(scheduleSection)) {
    const item = parseScheduleLine(line);
    if (item) scheduleItems.push(item);
  }

  // 이슈/리스크
  const riskSection = extractSection(text, "이슈/리스크") || extractSection(text, "이슈·리스크");
  const risks: ParsedRisk[] = [];
  let noIssues = false;
  for (const line of extractBullets(riskSection)) {
    const sev = inferRiskSeverity(line);
    if (sev === null) {
      noIssues = true;
      continue;
    }
    risks.push({ content: line, severity: sev, rawText: line });
  }

  // 다음 액션
  const actionSection = extractSection(text, "다음 액션") || extractSection(text, "다음액션");
  const nextActions: ParsedNextAction[] = [];
  for (const line of extractBullets(actionSection)) {
    nextActions.push({
      content: line,
      actionCategory: inferActionCategory(line),
      rawText: line,
    });
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
  };
}
