"use client";

import React from "react";

type Tone = "default" | "success" | "warning" | "danger" | "info";

const TONE_STYLES: Record<Tone, { bg: string; border: string; valueColor: string }> = {
  default:  { bg: "var(--bg-overlay)",          border: "var(--border)",                valueColor: "var(--text-primary)" },
  success:  { bg: "rgba(34,197,94,0.07)",        border: "rgba(34,197,94,0.25)",         valueColor: "#4ade80" },
  warning:  { bg: "rgba(251,146,60,0.07)",       border: "rgba(251,146,60,0.25)",        valueColor: "#fb923c" },
  danger:   { bg: "rgba(239,68,68,0.07)",        border: "rgba(239,68,68,0.25)",         valueColor: "#f87171" },
  info:     { bg: "rgba(99,102,241,0.07)",       border: "rgba(99,102,241,0.2)",         valueColor: "#818cf8" },
};

type TrendDir = "up" | "down" | "neutral";

interface MetricCardProps {
  label: string;
  value: number | string;
  /** 직접 색 지정 (tone보다 우선) */
  color?: string;
  sublabel?: string;
  /** @deprecated — tone으로 대체. 하위 호환 유지. */
  highlight?: boolean;
  tone?: Tone;
  /** 상단 우측 아이콘 SVG 문자열 또는 React 엘리먼트 */
  icon?: React.ReactNode;
  /** 값 아래 보조 텍스트 */
  helperText?: string;
  /** 추세 방향 */
  trend?: TrendDir;
  /** 추세 숫자 (예: "+3", "-1") */
  trendValue?: string;
  className?: string;
}

function TrendChip({ dir, value }: { dir: TrendDir; value?: string }) {
  if (dir === "neutral") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
        style={{ background: "var(--bg-item)", color: "var(--text-muted)" }}>
        {value ?? "—"}
      </span>
    );
  }
  const isUp = dir === "up";
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5"
      style={{
        background: isUp ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
        color: isUp ? "#4ade80" : "#f87171",
      }}>
      {isUp ? "▲" : "▼"} {value}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  color,
  sublabel,
  highlight,
  tone,
  icon,
  helperText,
  trend,
  trendValue,
  className = "",
}: MetricCardProps) {
  // highlight (legacy) → info tone
  const resolvedTone: Tone = tone ?? (highlight ? "info" : "default");
  const ts = TONE_STYLES[resolvedTone];

  return (
    <div
      className={`rounded-xl px-4 py-3 flex flex-col gap-0.5 ${className}`}
      style={{ background: ts.bg, border: `1px solid ${ts.border}` }}
    >
      {/* 라벨 행 */}
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
          {label}
        </p>
        {icon && (
          <span className="opacity-60 text-[14px]">{icon}</span>
        )}
      </div>

      {/* 값 행 */}
      <div className="flex items-end gap-2">
        <p
          className="text-2xl font-bold leading-none"
          style={{ color: color ?? ts.valueColor }}
        >
          {value}
        </p>
        {trend && <TrendChip dir={trend} value={trendValue} />}
      </div>

      {/* 보조 텍스트 */}
      {(sublabel || helperText) && (
        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-subtle)" }}>
          {sublabel ?? helperText}
        </p>
      )}
    </div>
  );
}
