import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PREPLANNING_STATUSES,
  derivePreplanningStatus,
  getPreplanningView,
} from "../lib/preplanning";

describe("P1 프리플래닝 상태 정책", () => {
  it("운영에 진입한 과제는 저장값과 무관하게 플래닝 완료로 간주", () => {
    assert.equal(
      derivePreplanningStatus("개발중", { preplanningStatus: "검토 대기" }),
      "플래닝 완료",
    );
    assert.equal(
      derivePreplanningStatus("QA중", { preplanningStatus: "진행 불가" }),
      "플래닝 완료",
    );
    assert.equal(derivePreplanningStatus("In Review", undefined), "플래닝 완료");
    assert.equal(derivePreplanningStatus("검수중", undefined), "플래닝 완료");
  });

  it("완료 과제도 플래닝 완료로 간주", () => {
    assert.equal(derivePreplanningStatus("론치완료", undefined), "플래닝 완료");
  });

  it("대기 과제의 사용자가 저장한 상태를 우선 보존", () => {
    for (const status of PREPLANNING_STATUSES) {
      assert.equal(derivePreplanningStatus("Backlog", { preplanningStatus: status }), status);
    }
  });

  it("기존 HOLD 계열은 신규 필드가 없을 때 진행 불가로 안전하게 파생", () => {
    assert.equal(derivePreplanningStatus("HOLD", undefined), "진행 불가");
    assert.equal(derivePreplanningStatus("Postponed", undefined), "진행 불가");
    assert.equal(derivePreplanningStatus("Blocked", undefined), "진행 불가");
  });

  it("기존 검토 신호와 Design/Dev 완료 상태를 하위 호환", () => {
    assert.equal(derivePreplanningStatus("Backlog", { reviewNeeded: true }), "검토 중");
    assert.equal(
      derivePreplanningStatus("Backlog", { design: "검토중", dev: "대기중" }),
      "검토 중",
    );
    assert.equal(
      derivePreplanningStatus("Backlog", { design: "완료", dev: "대상아님" }),
      "플래닝 완료",
    );
  });

  it("기존 데이터가 없으면 검토 대기, 예정 스프린트는 빈 값", () => {
    assert.deepEqual(getPreplanningView("Backlog", undefined), {
      status: "검토 대기",
      targetSprint: "",
      isDerivedComplete: false,
    });
  });
});
