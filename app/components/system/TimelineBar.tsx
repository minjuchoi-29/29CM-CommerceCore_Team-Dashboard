/**
 * Product OS — TimelineBar Primitive
 *
 * 기간형 일정 바 표시 컴포넌트.
 * GanttChart에서 사용하는 패턴을 독립 primitive로 추출.
 *
 * @example
 * <TimelineBar
 *   startDate="2026-02-03"
 *   endDate="2026-02-07"
 *   status="진행중"
 *   role="Design"
 *   viewStart={...}
 *   viewEnd={...}
 * />
 */
"use client";

import { useMemo } from "react";

export type ScheduleStatus = "진행중" | "예정" | "완료" | "미정" | "확인필요" | "overdue";

const STATUS_BAR_CLASS: Record<string, string> = {
  "진행중":   "bg-blue-500",
  "예정":     "bg-indigo-400 opacity-60",
  "완료":     "bg-emerald-500 opacity-40",
  "확인필요": "bg-violet-400 opacity-50",
};

const STATUS_TEXT_STYLE: Record<string, React.CSSProperties> = {
  "진행중":   { color: "#60a5fa" },
  "예정":     { color: "#818cf8" },
  "완료":     { color: "#34d399" },
  "미정":     { color: "#f59e0b" },
  "확인필요": { color: "#a78bfa" },
  "overdue":  { color: "#f87171" },
};

const ROLE_COLOR: Record<string, string> = {
  "Kick-Off": "bg-violet-500",
  "Release":  "bg-blue-500",
  "Launch":   "bg-emerald-500",
  "Design":   "bg-pink-400",
  "Dev":      "bg-blue-400",
  "QA":       "bg-orange-400",
  "기획":     "bg-indigo-400",
};

interface TimelineBarProps {
  startDate?: string;
  endDate?: string;
  status: string;
  role?: string;
  person?: string;
  viewStartMs: number;
  viewEndMs: number;
  workingDays?: number;
  vacationDays?: number;
  showLabel?: boolean;
  showDuration?: boolean;
  /** hover tooltip 표시 여부 */
  tooltip?: boolean;
  className?: string;
  todayMs?: number;
}

function pct(ms: number, viewStart: number, viewEnd: number): number {
  const range = viewEnd - viewStart;
  if (range <= 0) return 0;
  return Math.max(0, Math.min(100, ((ms - viewStart) / range) * 100));
}

export function TimelineBar({
  startDate,
  endDate,
  status,
  role,
  viewStartMs,
  viewEndMs,
  workingDays,
  vacationDays = 0,
  showLabel = true,
  showDuration = true,
  className = "",
  todayMs = Date.now(),
}: TimelineBarProps) {
  const { left, width, isOverdue } = useMemo(() => {
    if (!startDate || !endDate) return { left: 0, width: 0, isOverdue: false };
    const startMs = new Date(startDate + "T00:00:00").getTime();
    const endMs   = new Date(endDate + "T00:00:00").getTime();
    const isOver  = endMs < todayMs && status !== "완료";
    const l = pct(startMs, viewStartMs, viewEndMs);
    const w = pct(endMs, viewStartMs, viewEndMs) - l;
    return { left: l, width: Math.max(w, 0.5), isOverdue: isOver };
  }, [startDate, endDate, viewStartMs, viewEndMs, todayMs, status]);

  const roleColorClass = (role && ROLE_COLOR[role]) ?? "bg-gray-400";
  const todayPct = pct(todayMs, viewStartMs, viewEndMs);

  const barClass = isOverdue
    ? "bg-red-400 opacity-70"
    : STATUS_BAR_CLASS[status] ?? "bg-gray-400 opacity-50";

  const netDays = Math.max(0, (workingDays ?? 0) - vacationDays);

  if (status === "미정") {
    return (
      <div className={`relative h-5 rounded-sm overflow-hidden flex items-center justify-center ${className}`}
        style={{ background: "var(--bg-item)" }}>
        <span className="text-[10px] font-bold" style={{ color: "#f59e0b" }}>⚠</span>
        <span className="text-xs font-medium ml-1" style={{ color: "#f59e0b" }}>기간 산정 중</span>
      </div>
    );
  }

  if (status === "확인필요" && !startDate) {
    return (
      <div className={`relative h-5 rounded-sm overflow-hidden flex items-center justify-center ${className}`}
        style={{ background: "var(--bg-item)" }}>
        <span className="text-[10px] font-bold" style={{ color: "#a78bfa" }}>?</span>
        <span className="text-xs font-medium ml-1" style={{ color: "#a78bfa" }}>PM 확인 필요</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        {/* Gantt bar track */}
        <div
          className={`flex-1 relative h-5 rounded-sm overflow-hidden ${className}`}
          style={{ background: "var(--bg-item)" }}
        >
          {/* Today line */}
          <div className="absolute top-0 bottom-0 w-px bg-red-400 z-10"
            style={{ left: `${todayPct}%` }} />
          {/* Bar */}
          {width > 0 && (
            <div
              className={`absolute top-0.5 bottom-0.5 rounded-sm ${barClass} ${roleColorClass}`}
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          )}
        </div>

        {/* Status label */}
        {showLabel && (
          <span className="text-xs w-16 shrink-0 whitespace-nowrap"
            style={STATUS_TEXT_STYLE[isOverdue ? "overdue" : status] ?? { color: "var(--text-muted)" }}>
            {isOverdue ? "기한초과" : status}
          </span>
        )}
      </div>

      {/* Duration chip */}
      {showDuration && startDate && endDate && (
        <div className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded self-start"
          style={{ background: "var(--bg-overlay)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
          <span>{formatShortDate(startDate)}</span>
          <span style={{ color: "var(--text-subtle)" }}>~</span>
          <span>{formatShortDate(endDate)}</span>
          {workingDays !== undefined && workingDays > 0 && (
            <>
              <span className="ml-1 font-semibold" style={{ color: "#818cf8" }}>
                {netDays}영업일
              </span>
              {vacationDays > 0 && (
                <span style={{ color: "#fb923c", fontSize: "10px" }}>(-{vacationDays}휴가)</span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
}
