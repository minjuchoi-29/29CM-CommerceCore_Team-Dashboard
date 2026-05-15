import { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

export function SectionHeader({
  title,
  subtitle,
  actions,
  className = "",
}: SectionHeaderProps) {
  return (
    <div className={`flex items-start justify-between mb-3 ${className}`}>
      <div>
        <h3
          className="text-sm font-semibold"
          style={{ color: "var(--text-secondary)" }}
        >
          {title}
        </h3>
        {subtitle && (
          <p
            className="text-[12px] mt-0.5"
            style={{ color: "var(--text-muted)" }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
