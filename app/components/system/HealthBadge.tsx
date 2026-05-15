import { HealthStatus } from "@/lib/types";

const HEALTH_CONFIG: Record<
  HealthStatus,
  { label: string; bg: string; color: string; icon: string }
> = {
  Healthy: {
    label: "Healthy",
    bg: "rgba(34,197,94,0.12)",
    color: "#4ade80",
    icon: "●",
  },
  "At Risk": {
    label: "At Risk",
    bg: "rgba(251,191,36,0.15)",
    color: "#fbbf24",
    icon: "◐",
  },
  Blocked: {
    label: "Blocked",
    bg: "rgba(239,68,68,0.12)",
    color: "#f87171",
    icon: "◆",
  },
};

interface HealthBadgeProps {
  status: HealthStatus;
  score?: number;
  showScore?: boolean;
  size?: "xs" | "sm";
}

export function HealthBadge({
  status,
  score,
  showScore,
  size = "xs",
}: HealthBadgeProps) {
  const cfg = HEALTH_CONFIG[status];
  const sizeClass =
    size === "xs" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded font-semibold ${sizeClass}`}
      style={{ background: cfg.bg, color: cfg.color }}
    >
      <span>{cfg.icon}</span>
      <span>{cfg.label}</span>
      {showScore && score !== undefined && (
        <span className="opacity-70">({score})</span>
      )}
    </span>
  );
}
