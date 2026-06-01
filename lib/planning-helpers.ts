/**
 * Planning 상태 단일 source of truth (2026-06-01)
 *
 * 운영 원칙:
 *   TicketBoard 간략/집중보기, Q2 Initiative, Roadmap 등 모든 화면이
 *   "같은 ticket"의 Planning 상태를 **항상 같은 값**으로 보여줘야 한다.
 *
 * 이전 문제:
 *   각 화면이 자체 getPlanningVal / getPlanningEntry를 별도 정의했고,
 *   - TicketBoard: devTracks 있으면 aggregateDevState로 자동 집계 (v.dev 무시)
 *   - q2-initiative: v.dev 그대로 (devTracks 무시)
 *   - roadmap: v.dev 그대로 (devTracks 보존하지만 집계 없음)
 *   → 같은 KV 값을 보고도 화면마다 Dev 상태가 다르게 표시될 수 있었음.
 *
 * 본 모듈은 단일 helper(getPlanningView)를 export하고,
 * 모든 화면이 이걸 import해서 같은 결과를 보장한다.
 *
 * 정책 변경 없음 — TicketBoard에 있던 기존 로직을 그대로 이동.
 */

// ─── Types ────────────────────────────────────────────────────

export type TrackState = "대기중" | "검토중" | "완료" | "대상아님";
export const TRACK_STATES: TrackState[] = ["대기중", "검토중", "완료", "대상아님"];

export type DevTrackKey = "SP" | "PP" | "CFE" | "Mobile" | "DFE" | "QA" | "기타";
export const DEV_TRACK_KEYS: DevTrackKey[] = ["SP", "PP", "CFE", "Mobile", "DFE", "QA", "기타"];

export interface PlanningView {
  design: TrackState;
  dev: TrackState;
  devTracks: Partial<Record<DevTrackKey, TrackState>>;
  reviewNeeded: boolean;
}

export type PlanningSummaryState = "확인필요" | "검토중" | "플래닝 완료" | "대기중" | "대상아님";

// ─── Aggregation 정책 ─────────────────────────────────────────

/**
 * devTracks(SP/PP/CFE 등 sub-track)을 Dev 상위 행의 단일 상태로 집계.
 *
 * 정책 (가장 보수적인 값 우선):
 *   - 비어있음 → "대기중"
 *   - 전부 "대상아님" → "대상아님"
 *   - 하나라도 "대기중" → "대기중"
 *   - 그 외 "검토중" 있으면 → "검토중"
 *   - 나머지 → "완료"
 *
 * 운영 의도: 한 sub-track이라도 대기 중이면 전체가 대기 중. Dev 상위 행의
 *   "완료" 표시는 모든 active sub-track이 완료됐을 때만.
 */
export function aggregateDevState(devTracks: Partial<Record<DevTrackKey, TrackState>>): TrackState {
  const values = Object.values(devTracks).filter(Boolean) as TrackState[];
  if (values.length === 0) return "대기중";
  if (values.every(v => v === "대상아님")) return "대상아님";
  const active = values.filter(v => v !== "대상아님");
  if (active.length === 0) return "대상아님";
  if (active.some(v => v === "대기중")) return "대기중";
  if (active.some(v => v === "검토중")) return "검토중";
  return "완료";
}

// ─── 핵심 helper: 단일 source of truth ────────────────────────

/**
 * Planning KV 값을 모든 화면이 동일하게 해석하기 위한 normalize.
 *
 * Dev 값 결정 정책:
 *   - devTracks에 entry가 있으면 → aggregateDevState(devTracks)
 *   - devTracks가 비어있으면 → v.dev (legacy 단일 상태)
 *
 * 사용처: TicketBoard 간략/집중보기, q2-initiative, roadmap 등.
 */
export function getPlanningView(val: unknown): PlanningView {
  if (!val || typeof val === "string") {
    return { design: "대기중", dev: "대기중", devTracks: {}, reviewNeeded: false };
  }
  const v = val as Record<string, unknown>;
  const devTracks = (v.devTracks as Partial<Record<DevTrackKey, TrackState>>) ?? {};
  const devTracksHasEntries = Object.keys(devTracks).length > 0;
  const dev = devTracksHasEntries
    ? aggregateDevState(devTracks)
    : ((v.dev as TrackState) ?? "대기중");

  const view: PlanningView = {
    design: (v.design as TrackState) ?? "대기중",
    dev,
    devTracks,
    reviewNeeded: (v.reviewNeeded as boolean) ?? false,
  };

  // dev 모드에서 mismatch trace — KV의 v.dev와 aggregate 결과가 다르면 경고.
  // (silent loss / 정책 위반 / KV 마이그레이션 누락 감지)
  // production에서는 비활성화 — 콘솔 노이즈 방지.
  if (devTracksHasEntries && typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
    const storedDev = v.dev as TrackState | undefined;
    if (storedDev && storedDev !== dev) {
      // eslint-disable-next-line no-console
      console.warn(
        `[planning-mismatch] stored v.dev="${storedDev}" but aggregate(devTracks)="${dev}". ` +
        `Auto-resolved to "${dev}" (aggregate policy). devTracks=${JSON.stringify(devTracks)}`,
      );
    }
  }

  return view;
}

// ─── 요약 상태 (TicketBoard의 PlanningBadge 등에서 사용) ──────

export function getPlanningStateSummary(val: unknown): PlanningSummaryState {
  const p = getPlanningView(val);
  if (p.reviewNeeded) return "확인필요";
  const allNA = p.design === "대상아님" && p.dev === "대상아님";
  if (allNA) return "대상아님";
  const allDone =
    (p.design === "완료" || p.design === "대상아님") &&
    (p.dev === "완료" || p.dev === "대상아님");
  if (allDone) return "플래닝 완료";
  if (p.design === "검토중" || p.dev === "검토중") return "검토중";
  return "대기중";
}

// ─── Mismatch detection helper (dev tool / 운영 모니터링 용) ──

/**
 * 두 view가 같은 의미의 Planning 상태인지 검사.
 * Roadmap/Q2/TicketBoard에서 동시에 같은 ticket을 표시할 때 검증용.
 *
 * 반환:
 *   { match: boolean, reason?: string }
 */
export function planningViewsMatch(a: PlanningView, b: PlanningView): { match: boolean; reason?: string } {
  if (a.design !== b.design) return { match: false, reason: `design: ${a.design} vs ${b.design}` };
  if (a.dev !== b.dev) return { match: false, reason: `dev: ${a.dev} vs ${b.dev}` };
  if (a.reviewNeeded !== b.reviewNeeded) {
    return { match: false, reason: `reviewNeeded: ${a.reviewNeeded} vs ${b.reviewNeeded}` };
  }
  const akeys = Object.keys(a.devTracks).sort().join(",");
  const bkeys = Object.keys(b.devTracks).sort().join(",");
  if (akeys !== bkeys) return { match: false, reason: `devTracks keys: ${akeys} vs ${bkeys}` };
  for (const k of Object.keys(a.devTracks) as DevTrackKey[]) {
    if (a.devTracks[k] !== b.devTracks[k]) {
      return { match: false, reason: `devTracks[${k}]: ${a.devTracks[k]} vs ${b.devTracks[k]}` };
    }
  }
  return { match: true };
}
