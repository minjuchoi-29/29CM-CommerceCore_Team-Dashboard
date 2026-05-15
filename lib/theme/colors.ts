/**
 * Product OS — Semantic Color Tokens
 *
 * CSS 변수 기반. 다크/라이트 모드 모두 동일하게 사용.
 * accent 색상은 테마 무관 고정값.
 */

// ─── Semantic CSS Variable refs ───────────────────────────────────────────────
export const color = {
  text: {
    primary:   "var(--text-primary)",    // 제목, 중요 수치
    secondary: "var(--text-secondary)",  // 본문
    muted:     "var(--text-muted)",      // 레이블, 보조 설명
    subtle:    "var(--text-subtle)",     // placeholder, 비활성
  },
  surface: {
    canvas:  "var(--bg-canvas)",    // 페이지 배경
    overlay: "var(--bg-overlay)",   // 카드/패널
    sidebar: "var(--bg-sidebar)",   // 사이드바
    item:    "var(--bg-item)",      // 행/아이템
    itemAlt: "var(--bg-item-alt)",  // 행 hover
  },
  border: {
    default: "var(--border)",
    subtle:  "var(--border-2)",
  },
} as const;

// ─── Attention / Operational accent (테마 무관 고정값) ────────────────────────
export const attention = {
  /** 🔴 Danger — blocked, overdue, critical */
  danger: {
    solid:  "#f87171",
    light:  "rgba(239,68,68,0.07)",
    border: "rgba(239,68,68,0.25)",
    bar:    "3px solid #f87171",
  },
  /** 🟡 Warning — at risk, imminent, review needed */
  warning: {
    solid:  "#f59e0b",
    light:  "rgba(245,158,11,0.07)",
    border: "rgba(245,158,11,0.25)",
    bar:    "3px solid #f59e0b",
  },
  /** 🔵 Info — in progress, scheduled */
  info: {
    solid:  "#60a5fa",
    light:  "rgba(96,165,250,0.07)",
    border: "rgba(96,165,250,0.2)",
    bar:    "3px solid #60a5fa",
  },
  /** 🟢 Success — done, launched, healthy */
  success: {
    solid:  "#34d399",
    light:  "rgba(52,211,153,0.07)",
    border: "rgba(52,211,153,0.2)",
    bar:    "3px solid #34d399",
  },
  /** 🟣 Selected / Primary — 선택 상태, focus */
  primary: {
    solid:  "#818cf8",
    light:  "rgba(99,102,241,0.09)",
    border: "rgba(99,102,241,0.28)",
    bar:    "3px solid #6366f1",
  },
  /** ⚫ Neutral — archive, backlog, muted */
  neutral: {
    solid:  "var(--text-subtle)",
    light:  "var(--bg-overlay)",
    border: "var(--border)",
    bar:    "3px solid var(--border-2)",
  },
} as const;

/** Attention 레벨 → 색상 매핑 (row tint용) */
export function attentionTint(level: "danger" | "warning" | "info" | "success" | "selected" | null): string | undefined {
  switch (level) {
    case "danger":   return "rgba(239,68,68,0.06)";
    case "warning":  return "rgba(245,158,11,0.06)";
    case "info":     return "rgba(96,165,250,0.05)";
    case "success":  return "rgba(52,211,153,0.05)";
    case "selected": return "rgba(99,102,241,0.09)";
    default:         return undefined;
  }
}
