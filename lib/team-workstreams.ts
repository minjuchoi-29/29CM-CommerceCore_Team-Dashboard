import {
  DESIGN_TEAM_DISPLAY_NAME,
  PM_TEAM_DISPLAY_NAME,
  getDevTrackDisplayName,
  getPlanningView,
  type DevTrackKey,
  type TrackState,
} from "./planning-helpers";
import { getPreplanningView, type PreplanningStatus } from "./preplanning";
import {
  COMPLETED_WEEKLY_TRACKING_DAYS,
  classifyTicketLifecycle,
  getTicketViewLifecycle,
  type JiraStatusCategory,
} from "./weekly-targets";

export type WorkstreamLifecycle = "planning" | "active" | "recently_completed" | "completed";

export type WorkstreamSchedule = {
  role: string;
  person?: string;
  start?: string;
  end?: string;
  status?: string;
  detail?: string;
  phase?: string;
  resourceTeam?: string | null;
  archivedAt?: string;
};

export type TeamIdentity = {
  key: string;
  label: string;
  parentTeam?: "FE";
  rawLabel: string;
  mapped: boolean;
};

export type TeamWorkItem = {
  role: string;
  detail: string;
  person?: string;
  start?: string;
  end?: string;
  phase: string;
  status: string;
  rawTeam: string;
};

export type TeamWorkstream = {
  key: string;
  label: string;
  parentTeam?: "FE";
  rawLabels: string[];
  planningState?: TrackState;
  items: TeamWorkItem[];
  mapped: boolean;
};

export type TeamWorkstreamView = {
  lifecycle: WorkstreamLifecycle;
  preplanningStatus: PreplanningStatus;
  targetSprint: string;
  isPlanningDerivedComplete: boolean;
  teams: TeamWorkstream[];
  completedDaysAgo?: number;
  trackingDaysRemaining?: number;
};

export type TeamWorkstreamSignal = {
  team: string;
  phase: string;
  status: string;
};

export type TeamWorkstreamDisplayGroups = {
  teams: TeamWorkstream[];
  checkItems: TeamWorkItem[];
};

type BuildTeamWorkstreamInput = {
  jiraStatus: string;
  jiraStatusCategory?: JiraStatusCategory;
  planning: unknown;
  schedules: WorkstreamSchedule[];
  resolutionDate?: string;
  updatedAt?: string;
  now?: Date;
};

const TEAM_ALIASES: Record<string, Omit<TeamIdentity, "rawLabel">> = {
  SP: { key: "SP", label: getDevTrackDisplayName("SP"), mapped: true },
  "BE-SP": { key: "SP", label: getDevTrackDisplayName("SP"), mapped: true },
  PRICING: { key: "SP", label: getDevTrackDisplayName("SP"), mapped: true },
  "BE - PRICING": { key: "SP", label: getDevTrackDisplayName("SP"), mapped: true },
  "29CM PRICING BE": { key: "SP", label: getDevTrackDisplayName("SP"), mapped: true },
  PP: { key: "PP", label: getDevTrackDisplayName("PP"), mapped: true },
  "BE-PP": { key: "PP", label: getDevTrackDisplayName("PP"), mapped: true },
  PURCHASE: { key: "PP", label: getDevTrackDisplayName("PP"), mapped: true },
  "BE - PURCHASE": { key: "PP", label: getDevTrackDisplayName("PP"), mapped: true },
  "29CM PURCHASE BE": { key: "PP", label: getDevTrackDisplayName("PP"), mapped: true },
  CFE: { key: "CFE", label: getDevTrackDisplayName("CFE"), parentTeam: "FE", mapped: true },
  CMFE: { key: "CFE", label: getDevTrackDisplayName("CFE"), parentTeam: "FE", mapped: true },
  "FE-CFE": { key: "CFE", label: getDevTrackDisplayName("CFE"), parentTeam: "FE", mapped: true },
  DFE: { key: "DFE", label: getDevTrackDisplayName("DFE"), parentTeam: "FE", mapped: true },
  "FE-DFE": { key: "DFE", label: getDevTrackDisplayName("DFE"), parentTeam: "FE", mapped: true },
  FE: { key: "FE", label: getDevTrackDisplayName("CFE"), mapped: true },
  "FE - COMMERCE": { key: "FE", label: getDevTrackDisplayName("CFE"), mapped: true },
  "29CM FE": { key: "FE", label: getDevTrackDisplayName("CFE"), mapped: true },
  "29CM COMMERCE FE": { key: "FE", label: getDevTrackDisplayName("CFE"), mapped: true },
  PM: { key: "PM", label: PM_TEAM_DISPLAY_NAME, mapped: true },
  PRODUCT: { key: "PM", label: PM_TEAM_DISPLAY_NAME, mapped: true },
  "기획": { key: "PM", label: PM_TEAM_DISPLAY_NAME, mapped: true },
  "ORDERS N PRICING": { key: "PM", label: PM_TEAM_DISPLAY_NAME, mapped: true },
  "29CM ORDERS N PRICING": { key: "PM", label: PM_TEAM_DISPLAY_NAME, mapped: true },
  PD: { key: "Design", label: DESIGN_TEAM_DISPLAY_NAME, mapped: true },
  DESIGN: { key: "Design", label: DESIGN_TEAM_DISPLAY_NAME, mapped: true },
  "디자인": { key: "Design", label: DESIGN_TEAM_DISPLAY_NAME, mapped: true },
  "COMMERCE DESIGN": { key: "Design", label: DESIGN_TEAM_DISPLAY_NAME, mapped: true },
  MOBILE: { key: "Mobile", label: "Mobile", mapped: true },
  APP: { key: "Mobile", label: "Mobile", mapped: true },
  QA: { key: "QA", label: "QA", mapped: true },
  "기타": { key: "기타", label: "기타", mapped: true },
};

const TEAM_ORDER = new Map([
  ["PM", 0],
  ["Design", 1],
  ["SP", 2],
  ["PP", 3],
  ["CFE", 4],
  ["DFE", 5],
  ["FE", 6],
  ["Mobile", 7],
  ["QA", 8],
  ["기타", 98],
]);

const MILESTONE_PHASES = new Set(["Kick-Off", "Release", "Launch"]);

function normalizeTeamAlias(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("en-US");
}

/**
 * 저장된 팀 이름을 바꾸지 않고 조회 화면에서만 같은 조직 단위로 묶는다.
 * 합의되지 않은 이름(QE, CBP 정산, MSS BE 등)은 원문 그대로 독립 표시한다.
 */
export function resolveTeamIdentity(rawValue: string): TeamIdentity {
  const rawLabel = rawValue.trim() || "공통";
  const mapped = TEAM_ALIASES[normalizeTeamAlias(rawLabel)];
  if (mapped) return { ...mapped, rawLabel };
  return {
    key: `raw:${rawLabel.toLocaleLowerCase("ko-KR")}`,
    label: rawLabel,
    rawLabel,
    mapped: false,
  };
}

const TEAM_RESOURCE_HINT = /(?:^|[\s/_-])(be|fe|qa|qe|pm|pd|cfe|dfe|sp|pp|mobile|app|design|pricing|purchase|mss|cbp|sotatek)(?:$|[\s/_-])|(?:팀|메가존|정산)/i;
const TASK_RESOURCE_HINT = /(eta|예정|진행\s*중|완료|착수|대응|연동|모니터링|위클리|weekly|일정|작업|성능|통합|확인)/i;

/**
 * parser의 자유형 resourceTeam 중 실제 팀처럼 보이는 값만 팀 축으로 사용한다.
 * 계획 화면의 requiredTeams 직접 입력값에는 적용하지 않으므로 수동 팀명은 그대로 보호된다.
 */
export function isLikelyScheduleTeamLabel(rawValue: string): boolean {
  const value = rawValue.trim();
  if (!value) return false;
  if (resolveTeamIdentity(value).mapped) return true;
  if (value.length > 32 || value.split(/\s+/).length > 5) return false;
  if (TASK_RESOURCE_HINT.test(value) || /[→]|\([^)]*\d/.test(value)) return false;
  return TEAM_RESOURCE_HINT.test(value);
}

function identityFromSchedule(row: WorkstreamSchedule, phase: string): TeamIdentity | null {
  const explicit = row.resourceTeam?.trim();
  if (explicit && isLikelyScheduleTeamLabel(explicit)) return resolveTeamIdentity(explicit);

  // resourceTeam이 없는 legacy row는 role 전체가 합의된 alias일 때만 팀으로 해석한다.
  // 작업명처럼 보이는 임의 문자열을 팀 이름으로 오인하지 않는다.
  const roleIdentity = resolveTeamIdentity(row.role);
  if (roleIdentity.mapped) return roleIdentity;
  const phaseIdentity = resolveTeamIdentity(phase);
  return phaseIdentity.mapped && phase !== "기타"
    ? phaseIdentity
    : resolveTeamIdentity("공통");
}

function inferPhase(row: WorkstreamSchedule): string {
  if (row.phase?.trim()) return row.phase.trim();
  const text = `${row.role} ${row.detail ?? ""}`;
  if (/kick[-\s]?off|킥\s*오프/i.test(text)) return "Kick-Off";
  if (/release|릴리즈|릴리스|배포/i.test(text)) return "Release";
  if (/launch|론치|런치|오픈/i.test(text)) return "Launch";
  if (/\bqa\b|qc|테스트|test|검수|검증/i.test(text)) return "QA";
  if (/디자인|design|\bui\b|\bux\b/i.test(text)) return "디자인";
  if (/개발|development|api|\bbe\b|\bfe\b/i.test(text)) return "개발";
  if (/기획|planning|요구사항|정책/i.test(text)) return "기획";
  return "기타";
}

function completedTracking(completedAt: string | undefined, now: Date) {
  if (!completedAt) return undefined;
  const timestamp = new Date(completedAt).getTime();
  if (!Number.isFinite(timestamp)) return undefined;
  const elapsedMs = now.getTime() - timestamp;
  if (elapsedMs < 0) return undefined;
  const completedDaysAgo = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  return {
    completedDaysAgo,
    trackingDaysRemaining: Math.max(0, COMPLETED_WEEKLY_TRACKING_DAYS - completedDaysAgo),
    isWithinTrackingWindow: elapsedMs <= COMPLETED_WEEKLY_TRACKING_DAYS * 24 * 60 * 60 * 1000,
  };
}

function getLifecycle(input: BuildTeamWorkstreamInput): WorkstreamLifecycle {
  const lifecycle = getTicketViewLifecycle({
    key: "workstream-view",
    status: input.jiraStatus,
    statusCategory: input.jiraStatusCategory,
    resolutionDate: input.resolutionDate,
    updatedAt: input.updatedAt,
  }, input.now ?? new Date());
  if (lifecycle === "recently_completed") return "recently_completed";
  if (lifecycle === "completed" || lifecycle === "terminal") return "completed";
  return lifecycle;
}

function addPlanningTeam(
  teams: Map<string, TeamWorkstream>,
  rawTeam: string,
  planningState: TrackState,
) {
  const identity = resolveTeamIdentity(rawTeam);
  const existing = teams.get(identity.key) ?? {
    key: identity.key,
    label: identity.label,
    parentTeam: identity.parentTeam,
    rawLabels: [],
    items: [],
    mapped: identity.mapped,
  };
  if (!existing.rawLabels.includes(identity.rawLabel)) existing.rawLabels.push(identity.rawLabel);
  existing.planningState = planningState;
  teams.set(identity.key, existing);
}

function addScheduleItem(teams: Map<string, TeamWorkstream>, row: WorkstreamSchedule) {
  if (row.archivedAt) return;
  const phase = inferPhase(row);
  // 마일스톤은 Gantt에서 확인하며, 실행 팀이 아니므로 팀별 현재 단계 집계에서는 제외한다.
  if (MILESTONE_PHASES.has(phase)) return;
  const identity = identityFromSchedule(row, phase);
  if (!identity) return;
  const existing = teams.get(identity.key) ?? {
    key: identity.key,
    label: identity.label,
    parentTeam: identity.parentTeam,
    rawLabels: [],
    items: [],
    mapped: identity.mapped,
  };
  if (!existing.rawLabels.includes(identity.rawLabel)) existing.rawLabels.push(identity.rawLabel);
  existing.items.push({
    role: row.role,
    detail: row.detail?.trim() || row.role,
    person: row.person?.trim() || undefined,
    start: row.start || undefined,
    end: row.end || undefined,
    phase,
    status: row.status?.trim() || "미정",
    rawTeam: identity.rawLabel,
  });
  teams.set(identity.key, existing);
}

const CURRENT_STAGE_STATUSES = new Set(["진행중", "확인필요", "지연", "보류"]);

function stageItemDate(item: TeamWorkItem): string {
  return item.start || item.end || "9999-12-31";
}

function compareStageItems(a: TeamWorkItem, b: TeamWorkItem): number {
  return stageItemDate(a).localeCompare(stageItemDate(b), "ko-KR")
    || (a.end || "9999-12-31").localeCompare(b.end || "9999-12-31", "ko-KR")
    || a.phase.localeCompare(b.phase, "ko-KR")
    || a.detail.localeCompare(b.detail, "ko-KR");
}

function isMeaningfulStageItem(item: TeamWorkItem): boolean {
  const detail = item.detail.trim();
  if (!detail || /^[\s•·\-–—,./:;()[\]{}]+$/.test(detail)) return false;
  return !/(위클리|weekly).*(후속|일정).*(확인|완료)/i.test(detail);
}

/**
 * 팀별 현재 단계에는 전체 일정 대신 현재 작업 1건과 다음 작업 1건만 노출한다.
 * 데이터는 변경하지 않고 화면용으로만 선택한다.
 */
export function selectTeamCurrentStageItems(
  items: TeamWorkItem[],
  limit = 2,
): TeamWorkItem[] {
  if (limit <= 0) return [];
  const ordered = items.filter(isMeaningfulStageItem).sort(compareStageItems);
  if (ordered.length === 0) return [];

  const current = ordered.filter(item => CURRENT_STAGE_STATUSES.has(item.status)).at(-1);
  const planned = ordered.filter(item => item.status === "예정");
  const currentDate = current ? stageItemDate(current) : "";
  const next = planned.find(item => !current || stageItemDate(item) >= currentDate)
    ?? planned.at(-1);
  const latestCompleted = [...ordered].reverse().find(item => item.status === "완료");
  const selected = [current, next]
    .filter((item): item is TeamWorkItem => !!item)
    .filter((item, index, list) => list.indexOf(item) === index);
  if (selected.length === 0 && latestCompleted) selected.push(latestCompleted);

  return selected.slice(0, limit).sort(compareStageItems);
}

/**
 * 팀을 확인할 수 없는 Weekly 실행 문장은 팀별 현재 단계에서 반복하지 않는다.
 * 원문은 최근 Weekly와 세부 일정에 유지하고, 팀 요약에는 건수 안내만 제공한다.
 */
export function getTeamWorkstreamDisplayGroups(
  teams: TeamWorkstream[],
): TeamWorkstreamDisplayGroups {
  const namedTeams: TeamWorkstream[] = [];
  const checkItems: TeamWorkItem[] = [];

  for (const team of teams) {
    if (team.label === "공통") {
      checkItems.push(...selectTeamCurrentStageItems(team.items));
    } else {
      namedTeams.push(team);
    }
  }

  return { teams: namedTeams, checkItems: checkItems.sort(compareStageItems) };
}

/**
 * KV 원본을 수정하지 않는 P1-1 통합 조회 모델.
 * planning/devTracks와 schedule을 한 화면에서 읽을 수 있도록 파생한다.
 */
export function buildTeamWorkstreamView(input: BuildTeamWorkstreamInput): TeamWorkstreamView {
  const planning = getPlanningView(input.planning);
  const preplanning = getPreplanningView(input.jiraStatus, input.planning);
  const lifecycle = getLifecycle(input);
  const teams = new Map<string, TeamWorkstream>();

  for (const [track, state] of Object.entries(planning.devTracks) as [DevTrackKey, TrackState][]) {
    addPlanningTeam(teams, track, state);
  }
  for (const rawTeam of planning.requiredTeams) {
    const identity = resolveTeamIdentity(rawTeam);
    const devTrackState = planning.devTracks[identity.key as DevTrackKey];
    const state = devTrackState
      ?? planning.teamPlanningStates[rawTeam]
      ?? planning.teamPlanningStates[identity.key]
      ?? "대기중";
    addPlanningTeam(teams, rawTeam, state);
  }
  for (const schedule of input.schedules) addScheduleItem(teams, schedule);

  const tracking = (lifecycle === "recently_completed" || lifecycle === "completed")
    && classifyTicketLifecycle({
      status: input.jiraStatus,
      statusCategory: input.jiraStatusCategory,
    }) === "done"
    ? completedTracking(input.resolutionDate, input.now ?? new Date())
    : undefined;
  // CFE/DFE/FE처럼 내부 저장 키가 달라도 공식 팀명이 같으면 조회 화면에서 한 팀으로 묶는다.
  const officialTeams = new Map<string, TeamWorkstream>();
  for (const team of teams.values()) {
    const existing = officialTeams.get(team.label);
    if (!existing) {
      officialTeams.set(team.label, { ...team, rawLabels: [...team.rawLabels], items: [...team.items] });
      continue;
    }
    existing.rawLabels = [...new Set([...existing.rawLabels, ...team.rawLabels])];
    existing.items.push(...team.items);
    existing.mapped = existing.mapped && team.mapped;
    if (team.planningState) {
      const states = [existing.planningState, team.planningState].filter(Boolean) as TrackState[];
      existing.planningState = states.includes("대기중")
        ? "대기중"
        : states.includes("검토중")
          ? "검토중"
          : states.includes("완료")
            ? "완료"
            : "대상아님";
    }
  }

  const teamOrder = (team: TeamWorkstream) => TEAM_ORDER.get(team.key) ?? 50;
  const teamStageDate = (team: TeamWorkstream) => {
    const firstItem = selectTeamCurrentStageItems(team.items, 1)[0];
    return firstItem ? stageItemDate(firstItem) : "9999-12-31";
  };
  const sortedTeams = [...officialTeams.values()].sort((a, b) => {
    if (lifecycle !== "planning") {
      const aDate = teamStageDate(a);
      const bDate = teamStageDate(b);
      if (aDate !== bDate) return aDate.localeCompare(bDate, "ko-KR");
    }
    const aOrder = teamOrder(a);
    const bOrder = teamOrder(b);
    return aOrder - bOrder || a.label.localeCompare(b.label, "ko-KR");
  });

  return {
    lifecycle,
    preplanningStatus: preplanning.status,
    targetSprint: preplanning.targetSprint,
    isPlanningDerivedComplete: preplanning.isDerivedComplete,
    teams: sortedTeams,
    completedDaysAgo: tracking?.completedDaysAgo,
    trackingDaysRemaining: tracking?.trackingDaysRemaining,
  };
}

const EXECUTION_STATUS_ORDER = new Map([
  ["진행중", 0],
  ["예정", 1],
  ["확인필요", 2],
  ["미정", 3],
  ["보류", 4],
  ["지연", 5],
  ["완료", 6],
]);

function displayTeamLabel(team: TeamWorkstream): string {
  return team.label;
}

/** 목록용 팀·단계 요약. 저장값을 만들거나 변경하지 않는 파생 정보다. */
export function getTeamWorkstreamSignals(
  view: TeamWorkstreamView,
  limit = 2,
): TeamWorkstreamSignal[] {
  if (limit <= 0) return [];

  return view.teams
    .map((team): TeamWorkstreamSignal | null => {
      if (view.lifecycle === "planning") {
        if (!team.planningState) return null;
        return {
          team: displayTeamLabel(team),
          phase: "플래닝",
          status: team.planningState,
        };
      }

      const item = selectTeamCurrentStageItems(team.items, 1)[0]
        ?? [...team.items].sort((a, b) => {
          const statusDelta = (EXECUTION_STATUS_ORDER.get(a.status) ?? 50)
            - (EXECUTION_STATUS_ORDER.get(b.status) ?? 50);
          if (statusDelta !== 0) return statusDelta;
          return (b.end || b.start || "").localeCompare(a.end || a.start || "");
        })[0];
      if (!item) return null;
      return {
        team: displayTeamLabel(team),
        phase: item.phase,
        status: item.status,
      };
    })
    .filter((signal): signal is TeamWorkstreamSignal => signal !== null)
    .slice(0, limit);
}
