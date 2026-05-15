/**
 * Product OS — Surface Primitive
 *
 * 화면 레이어별 시맨틱 컨테이너.
 * 기존 코드를 깨지 않고 신규 컴포넌트에서 점진 적용.
 *
 * @example
 * <Surface variant="card" className="p-4">...</Surface>
 * <Surface variant="page">페이지 래퍼</Surface>
 */
import { forwardRef, HTMLAttributes, ElementType, ComponentPropsWithRef } from "react";

type SurfaceVariant =
  | "page"      // 페이지 최상위
  | "section"   // 섹션 구분 컨테이너
  | "card"      // 카드/패널
  | "item"      // 행/아이템
  | "drawer"    // 사이드 드로어
  | "archive"   // 지난 완료/아카이브
  | "selected"  // 선택 상태
  | "danger"    // 위험 강조 row
  | "warning"   // 경고 강조 row
  | "inset";    // 내부 들여쓰기 영역

interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SurfaceVariant;
  as?: ElementType;
}

const VARIANT_STYLES: Record<SurfaceVariant, React.CSSProperties> = {
  page: {
    background: "var(--bg-canvas)",
    color: "var(--text-primary)",
  },
  section: {
    background: "var(--bg-overlay)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
  },
  card: {
    background: "var(--bg-overlay)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
  },
  item: {
    background: "var(--bg-item)",
    borderRadius: "8px",
  },
  drawer: {
    background: "var(--bg-canvas)",
    borderLeft: "1px solid var(--border)",
  },
  archive: {
    background: "var(--bg-overlay)",
    border: "1px dashed var(--border)",
    borderRadius: "8px",
    opacity: 0.65,
  },
  selected: {
    background: "rgba(99,102,241,0.09)",
    borderLeft: "3px solid #6366f1",
  },
  danger: {
    background: "rgba(239,68,68,0.06)",
    borderLeft: "3px solid var(--accent-danger, #f87171)",
  },
  warning: {
    background: "rgba(245,158,11,0.06)",
    borderLeft: "3px solid var(--accent-warning, #f59e0b)",
  },
  inset: {
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-2)",
    borderRadius: "8px",
  },
};

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { variant = "card", as: Tag = "div", style, className = "", children, ...props },
  ref
) {
  const variantStyle = VARIANT_STYLES[variant];
  const Comp = Tag as "div";

  return (
    <Comp
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      style={{ ...variantStyle, ...style }}
      className={className}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...(props as any)}
    >
      {children}
    </Comp>
  );
});

Surface.displayName = "Surface";
