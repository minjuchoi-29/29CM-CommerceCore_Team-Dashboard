"use client";

interface FilterChipProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
  onClear?: () => void;
  disabled?: boolean;
}

export function FilterChip({
  label,
  active,
  onClick,
  onClear,
  disabled,
}: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all"
      style={
        active
          ? {
              background: "rgba(99,102,241,0.15)",
              color: "#818cf8",
              border: "1px solid rgba(99,102,241,0.35)",
            }
          : {
              background: "var(--bg-overlay)",
              color: "var(--text-muted)",
              border: "1px solid var(--border-2)",
            }
      }
    >
      {label}
      {active && onClear && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="ml-0.5 text-[10px] opacity-70 hover:opacity-100"
        >
          ×
        </span>
      )}
    </button>
  );
}
