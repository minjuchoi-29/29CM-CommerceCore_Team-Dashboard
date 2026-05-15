/**
 * Product OS — StickyHeader Primitive
 *
 * 페이지 상단 sticky 헤더. title + subtitle + actions 구성.
 *
 * @example
 * <StickyHeader
 *   title="전체 과제 현황"
 *   subtitle="팀 전체 과제의 실행 현황"
 *   actions={<RefreshButton />}
 * />
 */
import { ReactNode, CSSProperties } from "react";

interface StickyHeaderProps {
  title: string;
  subtitle?: string;
  /** 우측 영역 (버튼, 필터 등) */
  actions?: ReactNode;
  /** 제목 하단 정보 행 (badge, stat 등) */
  infoRow?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function StickyHeader({
  title,
  subtitle,
  actions,
  infoRow,
  className = "",
  style,
}: StickyHeaderProps) {
  return (
    <div
      className={`sticky top-0 z-10 px-6 py-3.5 shrink-0 ${className}`}
      style={{
        background: "var(--bg-canvas)",
        borderBottom: "1px solid var(--border)",
        ...style,
      }}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Title block */}
        <div className="min-w-0">
          <h1
            className="text-[15px] font-semibold leading-snug truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              className="text-[11px] mt-0.5"
              style={{ color: "var(--text-muted)" }}
            >
              {subtitle}
            </p>
          )}
        </div>

        {/* Actions */}
        {actions && (
          <div className="flex items-center gap-2 shrink-0 mt-0.5">
            {actions}
          </div>
        )}
      </div>

      {/* Info row (optional, below title) */}
      {infoRow && (
        <div className="mt-2.5">
          {infoRow}
        </div>
      )}
    </div>
  );
}
