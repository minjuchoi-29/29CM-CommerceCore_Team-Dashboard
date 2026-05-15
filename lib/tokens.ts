/**
 * Product OS Design Tokens
 *
 * CSS custom property 이름을 상수로 관리합니다.
 * 컴포넌트에서 style={{ color: T.text.primary }} 형태로 사용하세요.
 *
 * 실제 값은 app/globals.css의 :root / [data-theme="dark"] 블록에 정의됩니다.
 */

// ─── Surface ────────────────────────────────────────────────────────────────
export const surface = {
  /** 최상위 캔버스 배경 (페이지 배경) */
  canvas:   "var(--bg-canvas)",
  /** 카드/패널 등 overlay 레이어 */
  overlay:  "var(--bg-overlay)",
  /** 행/아이템 단위 배경 */
  item:     "var(--bg-item)",
  /** 행 호버/포커스 강조 배경 (item보다 한 단계 밝음) */
  itemAlt:  "var(--bg-item-alt)",
} as const;

// ─── Border ─────────────────────────────────────────────────────────────────
export const border = {
  /** 기본 구분선 */
  default:  "var(--border)",
  /** 보조 구분선 (더 얇게) */
  subtle:   "var(--border-2)",
} as const;

// ─── Text ────────────────────────────────────────────────────────────────────
export const text = {
  /** 최우선 텍스트 (제목, 중요 수치) */
  primary:  "var(--text-primary)",
  /** 일반 본문 텍스트 */
  secondary: "var(--text-secondary)",
  /** 보조 설명, 레이블 */
  muted:    "var(--text-muted)",
  /** 비활성·placeholder */
  subtle:   "var(--text-subtle)",
} as const;

// ─── Accent ──────────────────────────────────────────────────────────────────
export const accent = {
  /** 주요 강조색 (인디고) — 선택 상태, 포커스 링 */
  indigo:        "#6366f1",
  indigoLight:   "rgba(99,102,241,0.09)",
  indigoBorder:  "rgba(99,102,241,0.25)",

  /** 성공 (그린) */
  success:       "#10b981",
  successLight:  "rgba(16,185,129,0.08)",

  /** 경고 (앰버) */
  warning:       "#f59e0b",
  warningLight:  "rgba(245,158,11,0.08)",

  /** 위험/초과 (레드) */
  danger:        "#f87171",
  dangerLight:   "rgba(239,68,68,0.06)",

  /** 보라 — 마일스톤 */
  violet:        "#818cf8",
  violetLight:   "rgba(129,140,248,0.08)",
} as const;

// ─── Interaction ─────────────────────────────────────────────────────────────
export const interaction = {
  /** 선택된 행 배경 */
  selectedRowBg:     accent.indigoLight,
  /** 선택된 행 left border */
  selectedRowBorder: `3px solid ${accent.indigo}`,
  /** 호버 배경 */
  hoverBg:           "var(--bg-item)",
} as const;

// ─── Shorthand export ────────────────────────────────────────────────────────
export const T = { surface, border, text, accent, interaction } as const;
export default T;
