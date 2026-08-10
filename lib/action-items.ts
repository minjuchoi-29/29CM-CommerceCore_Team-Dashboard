/**
 * lib/action-items.ts
 *
 * Product OS — Action Guidance 시스템
 * 티켓의 현재 상태(planning, schedule, etr)를 분석해 담당자가 해야 할 액션을 반환.
 *
 * TicketBoard.tsx와 OwnerDashboard.tsx 양쪽에서 공유.
 */

import type { Ticket } from "@/app/jira-tickets/TicketBoard";

// ── 최소 타입 정의 (TicketBoard와 구조적으로 호환) ─────────────────────────

export type TrackState = "대기중" | "검토중" | "완료" | "대상아님";
export type DevTrackKey = "SP" | "PP" | "CFE" | "Mobile" | "DFE" | "QA" | "기타";

export type RoleScheduleMin = {
  role: string;
  start?: string;
  end?: string;
  status?: string;
  phase?: string;
  archivedAt?: string;
  source?: string;
  sourceWeek?: string;
};

export type EtrInfoMin = {
  // PR-X: source 일반화 — ETR / ELT / 자체발의 모두 동등 처리.
  source?: "자체발의" | "ELT" | "ETR";
  etrTickets?: { key: string }[];
  wikiLinks?: { url: string; title: string }[];
};

export type ActionItem = {
  id: string;
  /** 낮을수록 우선순위 높음 (1=critical~7=info) */
  priority: number;
  level: "critical" | "warning" | "info";
  /** 액션을 노출할 업무 화면. 서로 다른 성격의 신호를 한 건수로 합치지 않는다. */
  scope: "weekly" | "planning" | "data";
  label: string;
  /** 클릭 시 이동할 탭 */
  targetTab?: "ops";
};

export type ActionScope = ActionItem["scope"];

export type LaunchTargetSource = "schedule" | "weekly" | "jira_due" | "none";

export type LaunchReadiness = {
  targetDate?: string;
  source: LaunchTargetSource;
  confidence: "confirmed" | "target" | "unknown";
  attention: "none" | "warning" | "critical";
  reason?: "overdue" | "schedule_conflict" | "change_needed" | "near_tbd" | "missing";
  label?: string;
};

const LAUNCH_MARKER = /(?:launch|release|deploy|론치|런치|런칭|배포|릴리즈|릴리스|오픈)/i;
const LAUNCH_DATE = /(?:20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}|\d{1,2}월\s*(?:\d{1,2}일|초|중순?|말|말일|내)|\d{1,2}\s*주차)/i;
const STRONG_UNCERTAINTY = /(?:변경\s*(?:필요|예정)|재산정|지연|연기|확정\s*필요|조율\s*중|협의\s*중|산정\s*필요)/i;
const WEAK_UNCERTAINTY = /(?:\bTBD\b|미정|확정\s*전)/i;

function isIsoDate(value?: string): value is string {
  return !!value && /^20\d{2}-\d{2}-\d{2}$/.test(value);
}

function displayDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function daysUntil(date: string, today: string): number {
  const toUtc = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.floor((toUtc(date) - toUtc(today)) / 86_400_000);
}

function launchContexts(weeklyText?: string): string[] {
  if (!weeklyText) return [];
  const lines = weeklyText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const contexts: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!LAUNCH_MARKER.test(lines[index])) continue;
    contexts.push(lines.slice(index, index + 3).join(" "));
  }
  return contexts;
}

function toIsoDate(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseWeeklyLaunchDate(
  contexts: string[],
  dueDate: string | undefined,
  today: string,
): string | undefined {
  const text = contexts.join(" ");
  const full = text.match(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
  if (full) return toIsoDate(Number(full[1]), Number(full[2]), Number(full[3]));

  const baseYear = Number((dueDate ?? today).slice(0, 4));
  const slash = text.match(/(?:^|\s)(\d{1,2})[./-](\d{1,2})(?=\s|$|[),])/);
  if (slash) return toIsoDate(baseYear, Number(slash[1]), Number(slash[2]));

  const koreanDay = text.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (koreanDay) return toIsoDate(baseYear, Number(koreanDay[1]), Number(koreanDay[2]));

  const monthEnd = text.match(/(\d{1,2})월\s*(?:말|말일)/);
  if (monthEnd) {
    const month = Number(monthEnd[1]);
    const lastDay = new Date(Date.UTC(baseYear, month, 0)).getUTCDate();
    return toIsoDate(baseYear, month, lastDay);
  }

  return undefined;
}

function isLaunchSchedule(row: RoleScheduleMin): boolean {
  const phaseOrRole = `${row.phase ?? ""} ${row.role ?? ""}`;
  return LAUNCH_MARKER.test(phaseOrRole);
}

function sourceWeekNumber(sourceWeek?: string): number | undefined {
  const matched = sourceWeek?.match(/(\d{1,2})\s*주차/);
  return matched ? Number(matched[1]) : undefined;
}

/**
 * 자동 파싱된 jira_weekly 행은 가장 최신 주차만 판정에 사용한다.
 * 과거 주차에서 사라진 QA/Launch 행을 현재 일정과 충돌시키지 않기 위함이다.
 * manual/imported/confirmed/legacy 행은 사용자가 관리하는 기존 데이터이므로 보존한다.
 */
function currentScheduleRows(roles: RoleScheduleMin[]): RoleScheduleMin[] {
  const latestWeek = roles.reduce<number | undefined>((latest, row) => {
    if (row.source !== "jira_weekly" || row.archivedAt) return latest;
    const week = sourceWeekNumber(row.sourceWeek);
    if (week === undefined) return latest;
    return latest === undefined ? week : Math.max(latest, week);
  }, undefined);

  return roles.filter(row => {
    if (row.archivedAt) return false;
    if (row.source !== "jira_weekly" || latestWeek === undefined) return true;
    const week = sourceWeekNumber(row.sourceWeek);
    return week === undefined || week === latestWeek;
  });
}

/**
 * Launch/배포 목표일의 출처와 실제 주의 필요 여부를 파생한다.
 *
 * 우선순위: 명시적 일정 row > 최신 Weekly의 명시 날짜 > Jira 기한(ETA).
 * Jira 기한은 확정 Launch가 아니라 운영 목표일이지만, 별도 위험 신호가 없다면
 * "Launch 일정 미정" 경고를 대신할 수 있다.
 */
export function getLaunchReadiness(
  ticket: Pick<Ticket, "eta">,
  roles: RoleScheduleMin[],
  weeklyText?: string,
  today = new Date().toISOString().split("T")[0],
): LaunchReadiness {
  const activeRows = currentScheduleRows(roles);
  const launchRow = activeRows.find(row => isLaunchSchedule(row) && isIsoDate(row.start));
  const contexts = launchContexts(weeklyText);
  const weeklyHasDate = contexts.some(context => LAUNCH_DATE.test(context));
  const hasStrongUncertainty = contexts.some(context => STRONG_UNCERTAINTY.test(context));
  const hasWeakUncertainty = contexts.some(context => WEAK_UNCERTAINTY.test(context));
  const dueDate = isIsoDate(ticket.eta) ? ticket.eta : undefined;
  const weeklyDate = parseWeeklyLaunchDate(contexts, dueDate, today);

  const source: LaunchTargetSource = launchRow
    ? "schedule"
    : weeklyHasDate
      ? "weekly"
      : dueDate
        ? "jira_due"
        : "none";
  const targetDate = launchRow?.start ?? weeklyDate ?? dueDate;

  if (dueDate && targetDate && targetDate > dueDate) {
    return {
      targetDate,
      source,
      confidence: source === "jira_due" ? "target" : "confirmed",
      attention: "critical",
      reason: "schedule_conflict",
      label: `기한 이후 일정 확인 · 기준 ${displayDate(dueDate)}`,
    };
  }

  if (targetDate && targetDate < today) {
    return {
      targetDate,
      source,
      confidence: source === "jira_due" ? "target" : "confirmed",
      attention: "critical",
      reason: "overdue",
      label: `ETA 경과 (${targetDate})`,
    };
  }

  if (targetDate) {
    const conflictingRow = activeRows.find(row => {
      if (row === launchRow || !isIsoDate(row.end) || row.end <= targetDate || row.status === "완료") return false;
      const phaseOrRole = `${row.phase ?? ""} ${row.role ?? ""}`;
      return /(?:QA|QC|테스트|검수|검증|Release|Launch|배포|론치|런치)/i.test(phaseOrRole);
    });
    if (conflictingRow) {
      return {
        targetDate,
        source,
        confidence: source === "jira_due" ? "target" : "confirmed",
        attention: "critical",
        reason: "schedule_conflict",
        label: `기한 이후 일정 확인 · 기준 ${displayDate(targetDate)}`,
      };
    }

    if (hasStrongUncertainty) {
      return {
        targetDate,
        source,
        confidence: source === "jira_due" ? "target" : "confirmed",
        attention: "warning",
        reason: "change_needed",
        label: `론치 일정 재확인 · 기준 ${displayDate(targetDate)}`,
      };
    }

    if (hasWeakUncertainty && daysUntil(targetDate, today) <= 28) {
      return {
        targetDate,
        source,
        confidence: source === "jira_due" ? "target" : "confirmed",
        attention: "warning",
        reason: "near_tbd",
        label: `론치 확정 필요 · 기준 ${displayDate(targetDate)}`,
      };
    }

    return {
      targetDate,
      source,
      confidence: source === "jira_due" ? "target" : "confirmed",
      attention: "none",
    };
  }

  if (weeklyHasDate) {
    return { source: "weekly", confidence: "target", attention: "none" };
  }

  return {
    source: "none",
    confidence: "unknown",
    attention: "warning",
    reason: "missing",
    label: "론치 목표일 확인 필요",
  };
}

export function filterActionItemsByScope(
  items: ActionItem[],
  scope: ActionScope,
): ActionItem[] {
  return items.filter(item => item.scope === scope);
}

// ── Planning 상태 파싱 helper (TicketBoard.getPlanningVal과 동일 로직) ──────

function aggregateDevStateLocal(devTracks: Partial<Record<DevTrackKey, TrackState>>): TrackState {
  const values = Object.values(devTracks).filter(Boolean) as TrackState[];
  if (values.length === 0) return "대기중";
  if (values.every(v => v === "대상아님")) return "대상아님";
  const active = values.filter(v => v !== "대상아님");
  if (active.length === 0) return "대상아님";
  if (active.some(v => v === "대기중")) return "대기중";
  if (active.some(v => v === "검토중")) return "검토중";
  return "완료";
}

export function parsePlanningVal(val: unknown): {
  design: TrackState;
  dev: TrackState;
  devTracks: Partial<Record<DevTrackKey, TrackState>>;
  reviewNeeded: boolean;
} {
  if (!val || typeof val === "string")
    return { design: "대기중", dev: "대기중", devTracks: {}, reviewNeeded: false };
  const v = val as Record<string, unknown>;
  const devTracks = (v.devTracks as Partial<Record<DevTrackKey, TrackState>>) ?? {};
  const devTracksHasEntries = Object.keys(devTracks).length > 0;
  return {
    design: (v.design as TrackState) ?? "대기중",
    dev: devTracksHasEntries
      ? aggregateDevStateLocal(devTracks)
      : ((v.dev as TrackState) ?? "대기중"),
    devTracks,
    reviewNeeded: (v.reviewNeeded as boolean) ?? false,
  };
}

// ── 메인 함수 ───────────────────────────────────────────────────────────────

/**
 * 티켓 하나에 대한 Action Item 목록을 반환.
 * 완료 티켓은 빈 배열 반환.
 * priority 오름차순(1=가장 중요) 정렬.
 */
export function getActionItems(
  ticket: Ticket,
  planningVal: unknown,
  roles: RoleScheduleMin[],
  etrEntry: EtrInfoMin | undefined,
  weeklyText?: string,
): ActionItem[] {
  const items: ActionItem[] = [];
  const DONE = ["론치완료", "완료", "배포완료"];
  if (DONE.includes(ticket.status)) return [];

  const todayStr = new Date().toISOString().split("T")[0];
  const p = parsePlanningVal(planningVal);

  // 1. ETA 경과 (critical)
  if (ticket.eta && ticket.eta !== "-" && ticket.eta < todayStr) {
    items.push({
      id: "overdue",
      priority: 1,
      level: "critical",
      scope: "weekly",
      label: `ETA 경과 (${ticket.eta})`,
      targetTab: "ops",
    });
  }

  // 2. 플래닝 검토필요 (critical)
  if (p.reviewNeeded) {
    items.push({
      id: "review-needed",
      priority: 2,
      level: "critical",
      scope: "planning",
      label: "플래닝 검토 확인 필요",
      targetTab: "ops",
    });
  }

  // 3. 세부 작업 일정 미입력 (warning) — 마일스톤(Kick-Off/Release/Launch) 제외
  const MILESTONE_ROLES = ["Kick-Off", "Release", "Launch"];
  const workRoles = roles.filter(r => !MILESTONE_ROLES.includes(r.role));
  if (workRoles.length === 0) {
    items.push({
      id: "no-schedule",
      priority: 3,
      level: "warning",
      scope: "weekly",
      label: "세부 작업 일정 미입력",
      targetTab: "ops",
    });
  }

  // 4. Launch/배포 목표일 확인
  // Jira 기한(ETA)이 있으면 별도 Launch row가 없어도 목표일로 사용한다.
  // 단, 최신 Weekly가 변경/재산정 필요를 명시하거나 후속 일정과 충돌하면 주의로 남긴다.
  const launch = getLaunchReadiness(ticket, roles, weeklyText, todayStr);
  if (launch.attention !== "none" && launch.reason !== "overdue") {
    items.push({
      id: launch.reason === "missing" ? "no-launch" : "launch-attention",
      priority: launch.attention === "critical" ? 1 : 4,
      level: launch.attention,
      scope: "weekly",
      label: launch.label ?? "론치 목표일 확인 필요",
      targetTab: "ops",
    });
  }

  // 5. 플래닝 검토 중인 팀 (warning) — 검토중 = amber(attention) 계열
  const reviewingTeams: string[] = [];
  if (p.design === "검토중") reviewingTeams.push("디자인");
  for (const [tk, state] of Object.entries(p.devTracks)) {
    if (state === "검토중") reviewingTeams.push(tk);
  }
  if (reviewingTeams.length > 0) {
    items.push({
      id: "planning-reviewing",
      priority: 5,
      level: "warning",
      scope: "planning",
      label: `플래닝 검토 중 — ${reviewingTeams.join(", ")}`,
      targetTab: "ops",
    });
  }

  // 6. 요청사항 출처 (info) — PR-X: source 별 분기.
  //  - source 미설정 → "요청사항 출처 미선택" (참고)
  //  - source="ETR" 인데 etrTickets 비어있음 → "ETR 미연결" (참고)
  //  - source="ELT" → action 없음 (ELT F/U Wiki 는 PR-Z 에서 별도 안내)
  //  - source="자체발의" → action 없음 (외부 출처 없음)
  const src = etrEntry?.source;
  if (!src) {
    items.push({
      id: "no-source",
      priority: 6,
      level: "info",
      scope: "data",
      label: "요청사항 출처 미선택",
    });
  } else if (src === "ETR" && !etrEntry?.etrTickets?.length) {
    items.push({
      id: "no-etr",
      priority: 6,
      level: "info",
      scope: "data",
      label: "요청사항 출처(ETR) 미연결",
    });
  }

  // 7. 관련 문서 미연결 (info) — neutral: 참고 수준
  if (!etrEntry?.wikiLinks?.length && !ticket.prdUrl && !ticket.twoPagerUrl) {
    items.push({
      id: "no-docs",
      priority: 7,
      level: "info",
      scope: "data",
      label: "관련 문서 미연결",
    });
  }

  return items.sort((a, b) => a.priority - b.priority);
}

export function getActionItemsForScope(
  ticket: Ticket,
  planningVal: unknown,
  roles: RoleScheduleMin[],
  etrEntry: EtrInfoMin | undefined,
  scope: ActionScope,
  weeklyText?: string,
): ActionItem[] {
  return filterActionItemsByScope(
    getActionItems(ticket, planningVal, roles, etrEntry, weeklyText),
    scope,
  );
}

/**
 * 원격 운영 데이터가 hydrate되기 전에는 action을 계산하지 않는다.
 *
 * 티켓은 localStorage cache에서 먼저 복원될 수 있지만 schedule/planning/ETR은
 * KV 응답 후 도착한다. 이 사이 빈 데이터로 action을 계산하면
 * "세부 작업 일정 미입력" 같은 거짓 경고가 잠깐 노출된다.
 */
export function getActionItemsForScopeWhenReady(
  ready: boolean,
  ticket: Ticket,
  planningVal: unknown,
  roles: RoleScheduleMin[],
  etrEntry: EtrInfoMin | undefined,
  scope: ActionScope,
  weeklyText?: string,
): ActionItem[] {
  if (!ready) return [];
  return getActionItemsForScope(ticket, planningVal, roles, etrEntry, scope, weeklyText);
}
