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

function identityFromSchedule(row: WorkstreamSchedule): TeamIdentity {
  const explicit = row.resourceTeam?.trim();
  if (explicit) return resolveTeamIdentity(explicit);

  // resourceTeam이 없는 legacy row는 role 전체가 합의된 alias일 때만 팀으로 해석한다.
  // 작업명처럼 보이는 임의 문자열을 팀 이름으로 오인하지 않는다.
  const roleIdentity = resolveTeamIdentity(row.role);
  return roleIdentity.mapped ? roleIdentity : resolveTeamIdentity("공통");
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
  const identity = identityFromSchedule(row);
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

  const sortedTeams = [...officialTeams.values()].sort((a, b) => {
    const aOrder = TEAM_ORDER.get(a.key) ?? 50;
    const bOrder = TEAM_ORDER.get(b.key) ?? 50;
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

      const item = [...team.items].sort((a, b) => {
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
