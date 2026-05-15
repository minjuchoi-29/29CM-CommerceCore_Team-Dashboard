"use client";

/**
 * Product OS — StatusBadge
 *
 * 운영형 상태 배지. 완료/진행/경고/위험/neutral 5단계 계층.
 * Jira 상태 + 내부 운영 상태 모두 커버.
 */

// ── 운영 상태 분류 ───────────────────────────────────────────────────────────
// success  = 완료됨 (론치완료, 완료, 배포완료)
// info     = 진행 중, 예정 (개발중, QA중, 디자인중 ...)
// warning  = 주의 필요 (확인필요, 미정, 검토중, HOLD)
// danger   = 위험/차단 (overdue, Blocked, 철회)
// neutral  = 미시작/아카이브 (Backlog, SUGGESTED)

const STATUS_CLASSES: Record<string, string> = {
  // ── success ──────────────────────────────────────────
  "론치완료":   "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "완료":       "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "배포완료":   "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "개발완료":   "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-500",
  "기획완료":   "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-500",
  // ── info ─────────────────────────────────────────────
  "개발중":     "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "In Progress":"bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "QA중":       "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  "디자인완료": "bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400",
  "기획중":     "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  "준비중":     "bg-sky-50 text-sky-600 dark:bg-sky-900/20 dark:text-sky-400",
  "디자인중":   "bg-violet-50 text-violet-500 dark:bg-violet-900/20 dark:text-violet-300",
  // ── warning ──────────────────────────────────────────
  "확인필요":   "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  "HOLD":       "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  "Postponed":  "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400",
  "검토중":     "bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400",
  "미정":       "bg-orange-50 text-orange-500 dark:bg-orange-900/20 dark:text-orange-400",
  // ── danger ───────────────────────────────────────────
  "overdue":    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-semibold",
  "Blocked":    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-semibold",
  "철회/반려/취소": "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400",
  "취소":       "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400",
  // ── neutral / archive ────────────────────────────────
  "SUGGESTED":  "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
  "Backlog":    "bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500",
  "아카이브":   "bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500",
};

/** 도트 아이콘 — 운영 판단 빠른 시각화 */
const STATUS_DOT: Record<string, string> = {
  "론치완료": "●", "완료": "●", "배포완료": "●",
  "개발중": "◉", "In Progress": "◉", "QA중": "◉",
  "확인필요": "◐", "HOLD": "◐", "미정": "◐",
  "overdue": "◆", "Blocked": "◆",
  "Backlog": "○", "SUGGESTED": "○",
};

interface StatusBadgeProps {
  status: string;
  size?: "xs" | "sm" | "md";
  /** 상태 도트 아이콘 표시 여부 */
  showDot?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  size = "xs",
  showDot = false,
  className = "",
}: StatusBadgeProps) {
  const colorClass =
    STATUS_CLASSES[status] ??
    "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400";

  const sizeClass =
    size === "xs"  ? "text-[10px] px-1.5 py-0.5" :
    size === "sm"  ? "text-xs px-2 py-0.5" :
                     "text-sm px-2.5 py-1";

  const dot = STATUS_DOT[status];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded font-medium whitespace-nowrap ${sizeClass} ${colorClass} ${className}`}
    >
      {showDot && dot && (
        <span className="text-[8px] leading-none opacity-80">{dot}</span>
      )}
      {status}
    </span>
  );
}

/** 상태 → 운영 attention 레벨 분류 (row highlight 등에서 활용) */
export function statusAttentionLevel(
  status: string,
  isEtaOverdue?: boolean
): "danger" | "warning" | "info" | "success" | null {
  if (isEtaOverdue) return "danger";
  if (["론치완료", "완료", "배포완료", "개발완료"].includes(status)) return "success";
  if (["개발중", "In Progress", "QA중", "디자인중"].includes(status)) return "info";
  if (["확인필요", "HOLD", "Postponed", "미정", "검토중"].includes(status)) return "warning";
  if (["Blocked", "철회/반려/취소", "취소"].includes(status)) return "danger";
  return null;
}
