/**
 * Product OS — Theme Primitives
 *
 * 신규 컴포넌트에서 다크/라이트 테마를 지원할 때 이 파일을 참조하세요.
 *
 * ## 사용법
 *
 * ### Tailwind className (권장)
 * ```tsx
 * <div className={tw.surface.page}>...</div>
 * <p className={tw.text.muted}>...</p>
 * ```
 *
 * ### inline style (CSS variable 직접 참조)
 * ```tsx
 * <div style={{ background: css.surface.canvas, color: css.text.primary }}>...</div>
 * ```
 *
 * ## Theme 시스템 구조
 * - `data-theme="dark"` / `data-theme="light"` 속성이 `<html>` 태그에 설정됨
 * - CSS 변수는 globals.css에서 정의 (`var(--bg-canvas)` 등)
 * - Tailwind `dark:` variant는 `[data-theme="dark"]` 기반
 */

// ─── CSS variable 레퍼런스 (inline style 전용) ────────────────────────────────
export const css = {
  surface: {
    canvas:  "var(--bg-canvas)",   // 페이지 배경
    overlay: "var(--bg-overlay)",  // 카드/패널 배경
    sidebar: "var(--bg-sidebar)",  // 사이드바 배경
    item:    "var(--bg-item)",     // 행/아이템 배경
    itemAlt: "var(--bg-item-alt)", // 행 hover 배경
  },
  border: {
    default: "var(--border)",
    subtle:  "var(--border-2)",
  },
  text: {
    primary:   "var(--text-primary)",
    secondary: "var(--text-secondary)",
    muted:     "var(--text-muted)",
    subtle:    "var(--text-subtle)",
  },
} as const;

// ─── Tailwind className 조합 (className 전용) ─────────────────────────────────
export const tw = {
  surface: {
    /** 페이지 최상위 래퍼 */
    page:    "bg-neutral-50 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-100",
    /** 카드/패널 */
    panel:   "bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800",
    /** 사이드바 */
    sidebar: "bg-white dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-800",
    /** 행/아이템 */
    item:    "bg-neutral-100 dark:bg-neutral-800",
  },
  text: {
    primary:   "text-neutral-950 dark:text-neutral-100",
    secondary: "text-neutral-700 dark:text-neutral-300",
    muted:     "text-neutral-500 dark:text-neutral-400",
    subtle:    "text-neutral-400 dark:text-neutral-600",
  },
  border: {
    default: "border-neutral-200 dark:border-neutral-800",
    subtle:  "border-neutral-100 dark:border-neutral-900",
  },
  /** 선택 상태 (row/card) */
  selected: "bg-violet-50 border-l-2 border-l-violet-400 dark:bg-violet-500/10 dark:border-l-violet-500/50",
  /** hover */
  hover:    "hover:bg-neutral-100 dark:hover:bg-neutral-800/60",
  /** 비활성 */
  disabled: "opacity-50 cursor-not-allowed",
  /** 포커스 링 */
  focusRing: "focus:outline-none focus:ring-2 focus:ring-violet-500/50",
} as const;

// ─── Accent 팔레트 (테마 무관, 고정값) ───────────────────────────────────────
export const accent = {
  indigo: {
    solid:  "#6366f1",
    light:  "rgba(99,102,241,0.09)",
    border: "rgba(99,102,241,0.25)",
  },
  success: {
    solid:  "#10b981",
    light:  "rgba(16,185,129,0.08)",
    border: "rgba(16,185,129,0.25)",
  },
  warning: {
    solid:  "#f59e0b",
    light:  "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.25)",
  },
  danger: {
    solid:  "#f87171",
    light:  "rgba(239,68,68,0.06)",
    border: "rgba(239,68,68,0.2)",
  },
  violet: {
    solid:  "#818cf8",
    light:  "rgba(129,140,248,0.08)",
    border: "rgba(129,140,248,0.25)",
  },
} as const;
