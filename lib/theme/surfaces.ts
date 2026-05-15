/**
 * Product OS — Surface Hierarchy Tokens
 *
 * 화면 레이어별 배경/테두리 스타일 조합.
 * inline style 전용 (CSS variables 직접 참조).
 */

import type { CSSProperties } from "react";

// ─── Surface 레이어 정의 ──────────────────────────────────────────────────────

/** 페이지 최상위 래퍼 (min-h-screen wrapper) */
export const pageSurface: CSSProperties = {
  background: "var(--bg-canvas)",
  color: "var(--text-primary)",
};

/** 섹션 컨테이너 (카드/패널보다 한 단계 낮은 배경) */
export const sectionSurface: CSSProperties = {
  background: "var(--bg-overlay)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
};

/** 카드/패널 */
export const cardSurface: CSSProperties = {
  background: "var(--bg-overlay)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
};

/** 상세 패널 (사이드 드로어) */
export const drawerSurface: CSSProperties = {
  background: "var(--bg-canvas)",
  borderLeft: "1px solid var(--border)",
};

/** 행/아이템 배경 */
export const itemSurface: CSSProperties = {
  background: "var(--bg-item)",
};

/** 아카이브 영역 (지난 완료, muted) */
export const archiveSurface: CSSProperties = {
  background: "var(--bg-overlay)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  opacity: 0.6,
};

/** 선택된 row */
export const selectedRowSurface: CSSProperties = {
  background: "rgba(99,102,241,0.09)",
  borderLeft: "3px solid #6366f1",
};

/** 위험 상태 row */
export const dangerRowSurface: CSSProperties = {
  background: "rgba(239,68,68,0.06)",
  borderLeft: "3px solid #f87171",
};

/** 경고 상태 row */
export const warningRowSurface: CSSProperties = {
  background: "rgba(245,158,11,0.06)",
  borderLeft: "3px solid #f59e0b",
};

/** Sticky 헤더 배경 */
export const stickyHeaderSurface: CSSProperties = {
  background: "var(--bg-canvas)",
  borderBottom: "1px solid var(--border)",
};

// ─── Tailwind className 조합 (dark: variant 포함) ─────────────────────────────
export const surfaceClass = {
  page:    "bg-neutral-50 dark:bg-neutral-950 text-neutral-950 dark:text-neutral-100",
  panel:   "bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl",
  card:    "bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800",
  sidebar: "bg-white dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-800",
  item:    "bg-neutral-100 dark:bg-neutral-800",
  archive: "bg-neutral-50 dark:bg-neutral-900/60 border border-dashed border-neutral-200 dark:border-neutral-800",
  selected: "bg-violet-50 dark:bg-violet-500/10 border-l-2 border-l-violet-400 dark:border-l-violet-500/40",
  hover:   "hover:bg-neutral-100/80 dark:hover:bg-neutral-800/60",
} as const;
