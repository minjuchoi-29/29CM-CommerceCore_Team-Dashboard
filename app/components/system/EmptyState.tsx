interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({
  icon = "□",
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-10 px-4 text-center ${className}`}
    >
      <span className="text-3xl mb-3 opacity-30">{icon}</span>
      <p
        className="text-sm font-medium mb-1"
        style={{ color: "var(--text-secondary)" }}
      >
        {title}
      </p>
      {description && (
        <p
          className="text-[12px] mb-3"
          style={{ color: "var(--text-muted)" }}
        >
          {description}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
          style={{
            background: "rgba(99,102,241,0.12)",
            color: "#818cf8",
            border: "1px solid rgba(99,102,241,0.25)",
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
