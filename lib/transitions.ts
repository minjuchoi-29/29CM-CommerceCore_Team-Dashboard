/**
 * Transition Visibility — State Snapshot diff 기반 변화 감지
 *
 * 이 파일은 순수 로직(Pure TS)만 포함합니다.
 * KV 저장/조회는 app/api/transitions/route.ts 가 담당합니다.
 */

// ─── Transition 종류 ────────────────────────────────────────────
export type TransitionKind =
  | "lifecycle:started"        // 대기/준비 → 진행 시작
  | "lifecycle:completed"      // 진행 → 완료
  | "planning:design-start"    // 기획 → 디자인 착수
  | "planning:dev-start"       // 디자인 → 개발 착수
  | "planning:qa-start"        // 개발 → QA 진입
  | "attention:review-needed"  // reviewNeeded 새 발생
  | "attention:overdue";       // ETA overdue 새 진입

export interface TransitionMeta {
  label: string;
  emoji: string;
  color: string;
  bgColor: string;
  borderColor: string;
  category: "lifecycle" | "planning" | "attention";
}

export const TRANSITION_META: Record<TransitionKind, TransitionMeta> = {
  "lifecycle:started": {
    label: "진행 시작",
    emoji: "▶",
    color: "#34d399",
    bgColor: "rgba(52,211,153,0.12)",
    borderColor: "rgba(52,211,153,0.35)",
    category: "lifecycle",
  },
  "lifecycle:completed": {
    label: "완료",
    emoji: "✓",
    color: "#60a5fa",
    bgColor: "rgba(96,165,250,0.12)",
    borderColor: "rgba(96,165,250,0.35)",
    category: "lifecycle",
  },
  "planning:design-start": {
    label: "디자인 착수",
    emoji: "🎨",
    color: "#c084fc",
    bgColor: "rgba(192,132,252,0.12)",
    borderColor: "rgba(192,132,252,0.35)",
    category: "planning",
  },
  "planning:dev-start": {
    label: "개발 착수",
    emoji: "💻",
    color: "#818cf8",
    bgColor: "rgba(129,140,248,0.12)",
    borderColor: "rgba(129,140,248,0.35)",
    category: "planning",
  },
  "planning:qa-start": {
    label: "QA 진입",
    emoji: "🔍",
    color: "#fbbf24",
    bgColor: "rgba(251,191,36,0.12)",
    borderColor: "rgba(251,191,36,0.35)",
    category: "planning",
  },
  "attention:review-needed": {
    label: "검토 필요 발생",
    emoji: "⭐",
    color: "#f59e0b",
    bgColor: "rgba(245,158,11,0.12)",
    borderColor: "rgba(245,158,11,0.35)",
    category: "attention",
  },
  "attention:overdue": {
    label: "일정 초과",
    emoji: "⚠",
    color: "#ef4444",
    bgColor: "rgba(239,68,68,0.12)",
    borderColor: "rgba(239,68,68,0.35)",
    category: "attention",
  },
};

// ─── Snapshot 타입 ──────────────────────────────────────────────
/** 단일 티켓의 상태 스냅샷 */
export interface TicketSnapshot {
  ticketKey: string;
  status: string;               // TicketStatus 값
  reviewNeeded: boolean;
  eta: string | null;
  planningDesignState: string | null;  // TrackState | null ("대기중" | "검토중" | "완료" | "대상아님")
  planningDevActive: boolean;          // dev 트랙 중 하나라도 검토중/완료 이면 true
}

/** 특정 시점의 전체 티켓 스냅샷 집합 */
export interface SnapshotSet {
  takenAt: string;   // ISO datetime
  label: string;     // "5/12(월) 09:32" 형식
  tickets: Record<string, TicketSnapshot>;
}

/** KV 저장 구조 (key: cc-transition-snapshots) */
export interface StoredSnapshots {
  snapshots: SnapshotSet[];  // takenAt 오름차순, 최대 MAX_SNAPSHOTS
}

export const MAX_SNAPSHOTS = 14;  // 2주치 보관

// ─── Status 분류 ────────────────────────────────────────────────
const DONE_STATUSES = new Set([
  "론치완료", "완료", "배포완료", "개발완료",
]);

/** 대기/보류 상태 (진행 전) */
const IDLE_STATUSES = new Set([
  "준비중", "Backlog", "SUGGESTED", "HOLD", "Postponed",
]);

/** 활성 진행 상태 (완료 제외) */
const ACTIVE_STATUSES = new Set([
  "개발중", "In Progress", "QA중", "디자인중", "디자인완료",
  "기획중", "기획완료",
]);

// ─── 핵심 diff 함수 ─────────────────────────────────────────────
/**
 * 이전/현재 TicketSnapshot을 비교하여 발생한 Transition 목록 반환.
 * 순수 함수 — 외부 상태 없음.
 */
export function computeTransitions(
  prev: TicketSnapshot,
  curr: TicketSnapshot,
  now: Date = new Date(),
): TransitionKind[] {
  const kinds: TransitionKind[] = [];

  const prevDone   = DONE_STATUSES.has(prev.status);
  const currDone   = DONE_STATUSES.has(curr.status);
  const prevIdle   = IDLE_STATUSES.has(prev.status);
  const prevActive = ACTIVE_STATUSES.has(prev.status);
  const currActive = ACTIVE_STATUSES.has(curr.status);

  // lifecycle:started — 대기/준비 상태 → 진행 상태 (완료 아님)
  if ((prevIdle || (!prevActive && !prevDone)) && currActive && !currDone) {
    kinds.push("lifecycle:started");
  }

  // lifecycle:completed — 완료가 아니었다가 → 완료
  if (!prevDone && currDone) {
    kinds.push("lifecycle:completed");
  }

  // planning:design-start — design 트랙이 대기중/null → 검토중/완료
  const prevDesignIdle =
    !prev.planningDesignState ||
    prev.planningDesignState === "대기중" ||
    prev.planningDesignState === "대상아님";
  const currDesignActive =
    !!curr.planningDesignState &&
    curr.planningDesignState !== "대기중" &&
    curr.planningDesignState !== "대상아님";
  if (prevDesignIdle && currDesignActive) {
    kinds.push("planning:design-start");
  }

  // planning:dev-start — dev 트랙 비활성 → 활성
  if (!prev.planningDevActive && curr.planningDevActive) {
    kinds.push("planning:dev-start");
  }

  // planning:qa-start — QA중 신규 진입
  if (prev.status !== "QA중" && curr.status === "QA중") {
    kinds.push("planning:qa-start");
  }

  // attention:review-needed — reviewNeeded 새 발생
  if (!prev.reviewNeeded && curr.reviewNeeded) {
    kinds.push("attention:review-needed");
  }

  // attention:overdue — ETA가 처음으로 오버듀 진입
  const prevOverdue = !!prev.eta && new Date(prev.eta) < now;
  const currOverdue = !!curr.eta && new Date(curr.eta) < now;
  if (!prevOverdue && currOverdue) {
    kinds.push("attention:overdue");
  }

  return kinds;
}

/**
 * 스냅샷 집합과 현재 상태를 비교해 전체 Transition Map 반환.
 * hiddenKeys에 있는 티켓은 제외.
 */
export function computeAllTransitions(
  snapshot: SnapshotSet,
  currentSnapshots: Record<string, TicketSnapshot>,
  hiddenKeys: Set<string>,
  now: Date = new Date(),
): Map<string, TransitionKind[]> {
  const result = new Map<string, TransitionKind[]>();

  for (const [key, curr] of Object.entries(currentSnapshots)) {
    if (hiddenKeys.has(key)) continue;
    const prev = snapshot.tickets[key];
    if (!prev) continue; // 스냅샷 이후 신규 등록된 티켓 → 스킵

    const kinds = computeTransitions(prev, curr, now);
    if (kinds.length > 0) {
      result.set(key, kinds);
    }
  }

  return result;
}

// ─── 스냅샷 빌더 ────────────────────────────────────────────────
/**
 * 라이브 티켓 + 플래닝 데이터에서 TicketSnapshot 생성.
 * PlanningEntry는 unknown으로 받아 내부에서 안전하게 파싱.
 */
export function buildTicketSnapshot(
  ticketKey: string,
  status: string | null | undefined,
  eta: string | null | undefined,
  planningEntry: unknown,
): TicketSnapshot {
  const p = (planningEntry && typeof planningEntry === "object")
    ? (planningEntry as Record<string, unknown>)
    : {};

  const design = typeof p.design === "string" ? p.design : null;
  const dev    = typeof p.dev    === "string" ? p.dev    : null;
  const devTracks = (p.devTracks && typeof p.devTracks === "object")
    ? (p.devTracks as Record<string, string>)
    : {};
  const reviewNeeded = p.reviewNeeded === true;

  // dev 트랙 활성: dev 필드 또는 devTracks 중 하나라도 검토중/완료
  const devActive =
    (!!dev && dev !== "대기중" && dev !== "대상아님") ||
    Object.values(devTracks).some(v => v !== "대기중" && v !== "대상아님");

  return {
    ticketKey,
    status: status ?? "준비중",
    reviewNeeded,
    eta: eta ?? null,
    planningDesignState: design,
    planningDevActive: devActive,
  };
}

// ─── 헬퍼 ──────────────────────────────────────────────────────
/** ISO datetime → "5/12(월) 09:32" 형식 레이블 */
export function snapshotLabel(isoDate: string): string {
  const d = new Date(isoDate);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  const h   = d.getHours().toString().padStart(2, "0");
  const m   = d.getMinutes().toString().padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()}(${dow}) ${h}:${m}`;
}

/**
 * 저장된 스냅샷 목록에서 "N일 전" 비교 기준 스냅샷 선택.
 * 가장 오래된 것부터 최대 daysAgo 이내의 가장 먼 스냅샷 반환.
 */
export function selectCompareSnapshot(
  snapshots: SnapshotSet[],
  daysAgo = 7,
): SnapshotSet | null {
  if (snapshots.length === 0) return null;
  if (snapshots.length === 1) return snapshots[0];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysAgo);

  // cutoff 이전의 스냅샷 중 가장 최신 것 (= 비교 기준점)
  const older = snapshots.filter(s => new Date(s.takenAt) <= cutoff);
  if (older.length > 0) return older[older.length - 1];

  // cutoff 이전 스냅샷 없으면 가장 오래된 스냅샷 사용
  return snapshots[0];
}

/** Transition 카테고리별 카운트 요약 */
export function summarizeTransitions(
  transitionMap: Map<string, TransitionKind[]>,
): { kind: TransitionKind; count: number }[] {
  const counts: Partial<Record<TransitionKind, number>> = {};
  for (const kinds of transitionMap.values()) {
    for (const kind of kinds) {
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }

  // 표시 순서 고정
  const ORDER: TransitionKind[] = [
    "lifecycle:completed",
    "lifecycle:started",
    "planning:qa-start",
    "planning:dev-start",
    "planning:design-start",
    "attention:overdue",
    "attention:review-needed",
  ];

  return ORDER
    .filter(k => (counts[k] ?? 0) > 0)
    .map(k => ({ kind: k, count: counts[k]! }));
}
