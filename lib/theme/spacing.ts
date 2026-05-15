/**
 * Product OS — Spacing & Layout Tokens
 *
 * 일관된 padding/gap/radius 값 정의.
 * Tailwind 클래스 또는 픽셀값으로 사용 가능.
 */

// ─── Border radius ─────────────────────────────────────────────────────────────
export const radius = {
  sm:  "6px",   // 작은 배지, 입력
  md:  "8px",   // 버튼, 소형 카드
  lg:  "12px",  // 카드, 패널
  xl:  "16px",  // 드로어, 모달
  full: "9999px", // pill 뱃지
} as const;

// ─── Padding (카드/섹션 내부) ──────────────────────────────────────────────────
export const padding = {
  cardX:    "16px",  // 카드 좌우
  cardY:    "12px",  // 카드 상하
  sectionX: "24px",  // 섹션 좌우
  sectionY: "20px",  // 섹션 상하
  rowX:     "16px",  // 행 좌우
  rowY:     "10px",  // 행 상하
  badgeX:   "6px",
  badgeY:   "2px",
} as const;

// ─── Gap (flex/grid spacing) ───────────────────────────────────────────────────
export const gap = {
  xs:  "4px",
  sm:  "8px",
  md:  "12px",
  lg:  "16px",
  xl:  "24px",
} as const;

// ─── Z-index ───────────────────────────────────────────────────────────────────
export const zIndex = {
  base:    0,
  row:     1,
  sticky:  10,
  overlay: 20,
  drawer:  30,
  modal:   40,
  toast:   50,
} as const;

// ─── Tailwind 단축 조합 ────────────────────────────────────────────────────────
export const spacingClass = {
  cardPadding:    "px-4 py-3",
  sectionPadding: "px-6 py-5",
  rowPadding:     "px-4 py-2.5",
  badgePadding:   "px-1.5 py-0.5",
  sectionGap:     "space-y-4",
  cardGap:        "space-y-3",
  rowGap:         "space-y-1",
} as const;
