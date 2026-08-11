import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTeamWorkstreamView,
  getTeamWorkstreamSignals,
  resolveTeamIdentity,
} from "../lib/team-workstreams";

describe("P1-1 팀 명칭 조회 매핑", () => {
  it("합의된 별칭만 저장값 변경 없이 같은 팀으로 묶는다", () => {
    assert.deepEqual(resolveTeamIdentity("Pricing"), {
      key: "SP", label: "BE - Pricing", rawLabel: "Pricing", mapped: true,
    });
    assert.deepEqual(resolveTeamIdentity("Purchase"), {
      key: "PP", label: "BE - Purchase", rawLabel: "Purchase", mapped: true,
    });
    assert.deepEqual(resolveTeamIdentity("CMFE"), {
      key: "CFE", label: "FE - Commerce", parentTeam: "FE", rawLabel: "CMFE", mapped: true,
    });
    assert.equal(resolveTeamIdentity("APP").key, "Mobile");
    assert.equal(resolveTeamIdentity("BE-SP").key, "SP");
    assert.equal(resolveTeamIdentity("BE-PP").key, "PP");
    assert.equal(resolveTeamIdentity("PM").label, "PM");
    assert.equal(resolveTeamIdentity("기획").label, "PM");
    assert.equal(resolveTeamIdentity("PD").label, "Design");
    assert.equal(resolveTeamIdentity("디자인").label, "Design");
    assert.equal(resolveTeamIdentity("BE - Pricing").key, "SP");
    assert.equal(resolveTeamIdentity("BE - Purchase").key, "PP");
    assert.equal(resolveTeamIdentity("FE - Commerce").label, "FE - Commerce");
  });

  it("합의되지 않은 QE/CBP 정산/MSS BE는 원문 그대로 둔다", () => {
    for (const raw of ["QE", "CBP 정산", "MSS BE"]) {
      const identity = resolveTeamIdentity(raw);
      assert.equal(identity.label, raw);
      assert.equal(identity.rawLabel, raw);
      assert.equal(identity.mapped, false);
    }
  });
});

describe("P1-1 TeamWorkstreamView", () => {
  it("플래닝 대기는 devTracks를 필요한 팀과 팀별 상태로 보여준다", () => {
    const view = buildTeamWorkstreamView({
      jiraStatus: "SUGGESTED",
      planning: {
        preplanningStatus: "검토 중",
        targetSprint: "35~36주차",
        devTracks: { SP: "검토중", PP: "대기중", CFE: "완료" },
      },
      schedules: [],
    });

    assert.equal(view.lifecycle, "planning");
    assert.equal(view.preplanningStatus, "검토 중");
    assert.equal(view.targetSprint, "35~36주차");
    assert.deepEqual(view.teams.map(team => [team.key, team.planningState]), [
      ["SP", "검토중"], ["PP", "대기중"], ["CFE", "완료"],
    ]);
  });

  it("초안 검토 중은 Jira 진행형 카테고리여도 플래닝 대기로 보여준다", () => {
    const view = buildTeamWorkstreamView({
      jiraStatus: "초안 검토 중",
      jiraStatusCategory: "indeterminate",
      planning: {
        preplanningStatus: "검토 대기",
        devTracks: { PP: "대기중" },
      },
      schedules: [],
    });

    assert.equal(view.lifecycle, "planning");
    assert.deepEqual(view.teams.map(team => [team.label, team.planningState]), [
      ["BE - Purchase", "대기중"],
    ]);
  });

  it("자유형 필요한 팀을 기존 devTracks와 충돌 없이 함께 보여준다", () => {
    const view = buildTeamWorkstreamView({
      jiraStatus: "Backlog",
      planning: {
        requiredTeams: ["Pricing", "FE", "CBP 정산"],
        devTracks: { SP: "검토중" },
        teamPlanningStates: { FE: "완료", "CBP 정산": "검토중" },
      },
      schedules: [],
    });
    assert.deepEqual(view.teams.map(team => [team.key, team.rawLabels, team.planningState]), [
      ["SP", ["SP", "Pricing"], "검토중"],
      ["FE", ["FE"], "완료"],
      ["raw:cbp 정산", ["CBP 정산"], "검토중"],
    ]);
  });

  it("진행 중은 schedule의 팀+phase+status를 묶되 raw label을 보존한다", () => {
    const view = buildTeamWorkstreamView({
      jiraStatus: "개발중",
      planning: { design: "완료", dev: "완료" },
      schedules: [
        { role: "개발", resourceTeam: "Pricing", phase: "개발", status: "진행중", detail: "가격 API", start: "2026-07-22", end: "2026-08-19" },
        { role: "개발", resourceTeam: "BE-SP", phase: "개발", status: "진행중", detail: "캐시 반영" },
        { role: "개발", resourceTeam: "CMFE", phase: "개발", status: "진행중", detail: "가격 UI" },
        { role: "개발", resourceTeam: "CBP 정산", phase: "개발", status: "진행중", detail: "정산 영향도" },
      ],
    });

    assert.equal(view.lifecycle, "active");
    const sp = view.teams.find(team => team.key === "SP");
    assert.deepEqual(sp?.rawLabels, ["Pricing", "BE-SP"]);
    assert.deepEqual(sp?.items.map(item => [item.phase, item.status]), [["개발", "진행중"], ["개발", "진행중"]]);
    assert.equal(view.teams.find(team => team.key === "CFE")?.parentTeam, "FE");
    assert.equal(view.teams.find(team => team.label === "CBP 정산")?.mapped, false);
    assert.deepEqual(getTeamWorkstreamSignals(view), [
      { team: "BE - Pricing", phase: "개발", status: "진행중" },
      { team: "FE - Commerce", phase: "개발", status: "진행중" },
    ]);
  });

  it("목록 요약은 진행중인 단계를 완료된 단계보다 우선한다", () => {
    const view = buildTeamWorkstreamView({
      jiraStatus: "In Progress",
      planning: undefined,
      schedules: [
        { role: "개발", resourceTeam: "PP", phase: "개발", status: "완료", end: "2026-08-01" },
        { role: "QA", resourceTeam: "PP", phase: "QA", status: "예정", start: "2026-08-12" },
      ],
    });
    assert.deepEqual(getTeamWorkstreamSignals(view, 1), [
      { team: "BE - Purchase", phase: "QA", status: "예정" },
    ]);
  });

  it("CFE와 DFE는 저장 키를 유지하면서 화면에서는 한 공식 팀으로 묶는다", () => {
    const view = buildTeamWorkstreamView({
      jiraStatus: "In Progress",
      planning: { devTracks: { CFE: "완료", DFE: "검토중" } },
      schedules: [
        { role: "개발", resourceTeam: "CFE", phase: "개발", status: "완료", detail: "공통 UI" },
        { role: "개발", resourceTeam: "DFE", phase: "개발", status: "진행중", detail: "전시 UI" },
      ],
    });

    assert.equal(view.teams.length, 1);
    assert.equal(view.teams[0].label, "FE - Commerce");
    assert.equal(view.teams[0].planningState, "검토중");
    assert.deepEqual(view.teams[0].rawLabels, ["CFE", "DFE"]);
    assert.deepEqual(view.teams[0].items.map(item => item.detail), ["공통 UI", "전시 UI"]);
  });

  it("배포완료·개발완료가 Jira 진행 중 카테고리이면 active를 유지한다", () => {
    for (const jiraStatus of ["배포완료", "개발완료"]) {
      const view = buildTeamWorkstreamView({
        jiraStatus,
        jiraStatusCategory: "indeterminate",
        planning: undefined,
        schedules: [],
      });
      assert.equal(view.lifecycle, "active");
    }
  });

  it("플래닝 완료 수동값이 있어도 Jira가 SUGGESTED이면 planning을 유지한다", () => {
    const view = buildTeamWorkstreamView({
      jiraStatus: "SUGGESTED",
      jiraStatusCategory: "new",
      planning: { design: "완료", dev: "완료" },
      schedules: [],
    });
    assert.equal(view.lifecycle, "planning");
    assert.equal(view.isPlanningDerivedComplete, false);
  });

  it("완료 후 14일 동안 최근 완료로 추적하고 이후 일반 완료로 전환한다", () => {
    const recent = buildTeamWorkstreamView({
      jiraStatus: "론치완료",
      jiraStatusCategory: "done",
      planning: undefined,
      schedules: [],
      resolutionDate: "2026-08-05T00:00:00.000Z",
      now: new Date("2026-08-10T00:00:00.000Z"),
    });
    assert.equal(recent.lifecycle, "recently_completed");
    assert.equal(recent.completedDaysAgo, 5);
    assert.equal(recent.trackingDaysRemaining, 9);

    const old = buildTeamWorkstreamView({
      jiraStatus: "론치완료",
      jiraStatusCategory: "done",
      planning: undefined,
      schedules: [],
      resolutionDate: "2026-07-20T00:00:00.000Z",
      now: new Date("2026-08-10T00:00:00.000Z"),
    });
    assert.equal(old.lifecycle, "completed");
    assert.equal(old.trackingDaysRemaining, 0);
  });

  it("완료 카테고리라도 resolutionDate가 없으면 최근 완료로 추정하지 않는다", () => {
    const view = buildTeamWorkstreamView({
      jiraStatus: "완료",
      jiraStatusCategory: "done",
      planning: undefined,
      schedules: [],
      updatedAt: "2026-08-09T00:00:00.000Z",
      now: new Date("2026-08-10T00:00:00.000Z"),
    });
    assert.equal(view.lifecycle, "completed");
    assert.equal(view.completedDaysAgo, undefined);
  });

  it("취소·반려 상태는 최근 완료 추적 없이 completed로 본다", () => {
    const view = buildTeamWorkstreamView({
      jiraStatus: "Dropped",
      jiraStatusCategory: "done",
      planning: undefined,
      schedules: [],
      resolutionDate: "2026-08-09T00:00:00.000Z",
      now: new Date("2026-08-10T00:00:00.000Z"),
    });
    assert.equal(view.lifecycle, "completed");
    assert.equal(view.completedDaysAgo, undefined);
  });

  it("resourceTeam 없는 임의 작업명은 팀으로 오인하지 않고 공통으로 묶는다", () => {
    const view = buildTeamWorkstreamView({
      jiraStatus: "개발중",
      planning: undefined,
      schedules: [{ role: "가이드 발행 예정", status: "예정", detail: "운영 가이드" }],
    });
    assert.equal(view.teams[0].label, "공통");
    assert.equal(view.teams[0].items[0].detail, "운영 가이드");
  });

  it("Kick-Off·Release·Launch 마일스톤은 팀별 실행 상태에서 제외한다", () => {
    const view = buildTeamWorkstreamView({
      jiraStatus: "개발중",
      jiraStatusCategory: "indeterminate",
      planning: undefined,
      schedules: [
        { role: "Kick-Off", phase: "Kick-Off", status: "완료", start: "2026-07-01", end: "2026-07-01" },
        { role: "Launch", phase: "Launch", status: "예정", start: "2026-08-20", end: "2026-08-20" },
        { role: "API 개발", resourceTeam: "Pricing", phase: "개발", status: "진행중" },
      ],
    });
    assert.deepEqual(view.teams.map(team => team.key), ["SP"]);
  });
});
