/**
 * Product OS — Typography Hierarchy Tokens
 *
 * 폰트 사이즈/웨이트/색상 조합.
 * 원칙: font-size 증가 자제, weight/contrast 중심으로 계층 표현.
 */

import type { CSSProperties } from "react";

// ─── Text style 조합 ──────────────────────────────────────────────────────────

/** 페이지/섹션 제목 */
export const titleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 600,
  lineHeight: 1.3,
  color: "var(--text-primary)",
};

/** 카드/패널 제목 */
export const sectionTitleStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 600,
  lineHeight: 1.4,
  color: "var(--text-secondary)",
};

/** 주요 본문 */
export const bodyStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 400,
  lineHeight: 1.5,
  color: "var(--text-secondary)",
};

/** 레이블 (form, table header) */
export const labelStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 500,
  lineHeight: 1.4,
  color: "var(--text-muted)",
};

/** 보조 설명, helper text */
export const helperStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 400,
  lineHeight: 1.4,
  color: "var(--text-subtle)",
};

/** 수치/metric */
export const metricStyle: CSSProperties = {
  fontSize: "22px",
  fontWeight: 700,
  lineHeight: 1,
  color: "var(--text-primary)",
};

/** 작은 배지/태그 */
export const badgeStyle: CSSProperties = {
  fontSize: "10px",
  fontWeight: 600,
  lineHeight: 1,
  letterSpacing: "0.01em",
};

/** ETA / 날짜 */
export const etaStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 500,
  color: "var(--text-muted)",
};

/** 위험 상태 텍스트 강조 */
export const dangerTextStyle: CSSProperties = {
  color: "#f87171",
  fontWeight: 600,
};

/** 경고 상태 텍스트 강조 */
export const warningTextStyle: CSSProperties = {
  color: "#f59e0b",
  fontWeight: 600,
};

// ─── Tailwind className 조합 ──────────────────────────────────────────────────
export const typographyClass = {
  pageTitle:     "text-[15px] font-semibold text-neutral-900 dark:text-neutral-100 leading-snug",
  sectionTitle:  "text-[13px] font-semibold text-neutral-700 dark:text-neutral-300 leading-snug",
  body:          "text-[13px] text-neutral-700 dark:text-neutral-300",
  label:         "text-[11px] font-medium text-neutral-500 dark:text-neutral-400",
  helper:        "text-[11px] text-neutral-400 dark:text-neutral-500",
  metric:        "text-[22px] font-bold leading-none",
  badge:         "text-[10px] font-semibold leading-none",
  monospace:     "font-mono text-[12px]",
} as const;
