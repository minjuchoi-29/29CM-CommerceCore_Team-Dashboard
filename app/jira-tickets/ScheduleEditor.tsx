"use client";

import type { MutableRefObject } from "react";
import {
  DESIGN_TEAM_DISPLAY_NAME,
  DEV_TRACK_DISPLAY_NAMES,
  PM_TEAM_DISPLAY_NAME,
} from "@/lib/planning-helpers";
import type { SchedulePhase, ScheduleSource } from "@/lib/weekly-types";

export type EditableScheduleRow = {
  role: string;
  person: string;
  start: string;
  end: string;
  status: "완료" | "진행중" | "예정" | "미정" | "확인필요";
  detail?: string;
  detailPerson?: string;
  vacationDays?: number;
  source?: ScheduleSource;
  sourceWeek?: string;
  manualLocked?: boolean;
  mergeKey?: string;
  lastSeenAt?: string;
  confidence?: "high" | "medium" | "low";
  phase?: SchedulePhase;
  resourceTeam?: string | null;
  archivedAt?: string;
  archiveReason?: string;
};

type ScheduleEditorProps = {
  rows: EditableScheduleRow[];
  editError: string | null;
  focusKey: string | null;
  saving: boolean;
  preservedLegacyCount: number;
  rowRefs: MutableRefObject<(HTMLDivElement | null)[]>;
  makeFocusKey: (row: EditableScheduleRow) => string;
  onChangeRow: (index: number, patch: Partial<EditableScheduleRow>) => void;
  onRemoveRow: (index: number) => void;
  onAddWork: () => void;
  onAddMilestone: (phase: "Kick-Off" | "Release" | "Launch") => void;
  onSort: (direction: "oldest" | "latest") => void;
  onSave: () => void;
  onCancel: () => void;
};

const PHASE_OPTIONS: SchedulePhase[] = [
  "Kick-Off", "기획", "디자인", "개발", "QA", "Release", "Launch", "기타",
];
const STATUS_OPTIONS: EditableScheduleRow["status"][] = ["확인필요", "미정", "예정", "진행중", "완료"];
const MILESTONE_PHASES = new Set<SchedulePhase>(["Kick-Off", "Release", "Launch"]);
const TEAM_SUGGESTIONS = [
  PM_TEAM_DISPLAY_NAME,
  DESIGN_TEAM_DISPLAY_NAME,
  DEV_TRACK_DISPLAY_NAMES.SP,
  DEV_TRACK_DISPLAY_NAMES.PP,
  DEV_TRACK_DISPLAY_NAMES.CFE,
];

function statusStyle(status: EditableScheduleRow["status"]) {
  if (status === "완료") return { background: "#eaf6f1", border: "#b9dfd0", color: "#24735d" };
  if (status === "진행중") return { background: "#eaf1fa", border: "#bdd0e8", color: "#315b91" };
  if (status === "예정") return { background: "#fff5e5", border: "#e8ca98", color: "#936520" };
  if (status === "확인필요") return { background: "#fff0ed", border: "#e8c2ba", color: "#9b4c3f" };
  return { background: "#f3f5f8", border: "#d8dee8", color: "#68748a" };
}

export default function ScheduleEditor({
  rows,
  editError,
  focusKey,
  saving,
  preservedLegacyCount,
  rowRefs,
  makeFocusKey,
  onChangeRow,
  onRemoveRow,
  onAddWork,
  onAddMilestone,
  onSort,
  onSave,
  onCancel,
}: ScheduleEditorProps) {
  return (
    <div className="space-y-3 rounded-xl p-3" style={{ border: "1px solid var(--border)", background: "var(--bg-canvas)" }}>
      <datalist id="schedule-team-suggestions">
        {TEAM_SUGGESTIONS.map(team => <option key={team} value={team} />)}
      </datalist>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAddWork}
            className="rounded-md px-2.5 py-1.5 text-[12px] font-medium"
            style={{ color: "#315b91", background: "#eaf1fa", border: "1px solid #bdd0e8" }}
          >
            + 작업 추가
          </button>
          <select
            aria-label="마일스톤 추가"
            defaultValue=""
            onChange={(event) => {
              const phase = event.target.value as "Kick-Off" | "Release" | "Launch";
              if (phase) onAddMilestone(phase);
              event.target.value = "";
            }}
            className="rounded-md px-2.5 py-1.5 text-[12px]"
            style={{ color: "var(--text-secondary)", background: "var(--bg-item)", border: "1px solid var(--border-2)" }}
          >
            <option value="">+ 마일스톤 추가</option>
            <option value="Kick-Off">Kick-Off</option>
            <option value="Release">Release</option>
            <option value="Launch">Launch</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => onSort("oldest")} className="rounded px-2 py-1 text-[11px]" style={{ color: "var(--text-muted)" }}>오래된순</button>
          <button type="button" onClick={() => onSort("latest")} className="rounded px-2 py-1 text-[11px]" style={{ color: "var(--text-muted)" }}>최신순</button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium disabled:cursor-wait disabled:opacity-50"
            style={{ color: "#ffffff", background: "#245d67" }}
          >
            {saving ? "저장 중…" : "저장"}
          </button>
          <button type="button" onClick={onCancel} disabled={saving} className="rounded px-2 py-1.5 text-[12px] disabled:opacity-50" style={{ color: "var(--text-muted)" }}>취소</button>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
        Weekly 자동 일정도 직접 수정하면 수동 일정으로 보호됩니다. Release와 Launch는 필요한 경우에만 추가합니다.
      </p>
      {preservedLegacyCount > 0 ? (
        <p className="rounded-md px-2.5 py-2 text-[11px] leading-relaxed" style={{ color: "#68748a", background: "#f3f5f8" }}>
          화면에서 정리된 과거 중복 마일스톤 {preservedLegacyCount}건은 원본을 유지하며 편집 목록에서만 숨겼습니다.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-lg px-3 py-5 text-center text-[12px]" style={{ color: "var(--text-muted)", background: "var(--bg-overlay)" }}>
          등록된 일정이 없습니다. 작업 또는 마일스톤을 추가해주세요.
        </div>
      ) : null}

      <div className="space-y-2">
        {rows.map((row, index) => {
          const phase = row.phase ?? "기타";
          const isMilestone = MILESTONE_PHASES.has(phase);
          const isFocused = focusKey === makeFocusKey(row);
          const style = statusStyle(row.status);
          const sourceLabel = row.source === "jira_weekly"
            ? `Weekly${row.sourceWeek ? ` · ${row.sourceWeek}` : ""}`
            : row.source === "manual" || row.manualLocked
              ? "수동 보호"
              : "기존 일정";

          return (
            <div
              key={row.mergeKey ?? `${row.role}-${row.start}-${row.end}-${index}`}
              ref={(element) => { rowRefs.current[index] = element; }}
              className={`space-y-2 rounded-lg p-3 ${isFocused ? "ring-2 ring-[#2b7480]" : ""}`}
              style={{ border: "1px solid var(--border-2)", background: row.status === "완료" ? "var(--bg-canvas)" : "var(--bg-overlay)", opacity: row.status === "완료" ? 0.68 : 1 }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={`${index + 1}번 일정 단계`}
                  value={phase}
                  onChange={(event) => {
                    const nextPhase = event.target.value as SchedulePhase;
                    const nextIsMilestone = MILESTONE_PHASES.has(nextPhase);
                    const resourceTeam = nextIsMilestone ? null : row.resourceTeam;
                    const nextRole = resourceTeam?.trim() || nextPhase;
                    onChangeRow(index, { phase: nextPhase, resourceTeam, role: nextRole });
                  }}
                  className="rounded-md px-2 py-1.5 text-[12px]"
                  style={{ color: "var(--text-primary)", background: "var(--bg-canvas)", border: "1px solid var(--border-2)" }}
                >
                  {PHASE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>

                {!isMilestone ? (
                  <input
                    aria-label={`${index + 1}번 일정 팀`}
                    value={row.resourceTeam ?? ""}
                    onChange={(event) => {
                      const resourceTeam = event.target.value;
                      onChangeRow(index, { resourceTeam: resourceTeam || null, role: resourceTeam.trim() || phase });
                    }}
                    list="schedule-team-suggestions"
                    placeholder="팀 (직접 입력 가능)"
                    className="min-w-40 flex-1 rounded-md px-2 py-1.5 text-[12px]"
                    style={{ color: "var(--text-primary)", background: "var(--bg-canvas)", border: "1px solid var(--border-2)" }}
                  />
                ) : null}

                <select
                  aria-label={`${index + 1}번 일정 상태`}
                  value={row.status}
                  onChange={(event) => onChangeRow(index, { status: event.target.value as EditableScheduleRow["status"] })}
                  className="rounded-md px-2 py-1.5 text-[12px] font-medium"
                  style={{ color: style.color, background: style.background, border: `1px solid ${style.border}` }}
                >
                  {STATUS_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>

                <span className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>{sourceLabel}</span>
                <button
                  type="button"
                  onClick={() => onRemoveRow(index)}
                  aria-label={`${index + 1}번 일정 삭제`}
                  className="ml-auto rounded px-2 py-1 text-[12px]"
                  style={{ color: "#9b4c3f" }}
                >
                  삭제
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={`${index + 1}번 일정 상세 작업`}
                  value={row.detail ?? ""}
                  onChange={(event) => onChangeRow(index, { detail: event.target.value })}
                  placeholder={isMilestone ? "마일스톤 설명 (선택)" : "상세 작업명"}
                  className="min-w-52 flex-1 rounded-md px-2 py-1.5 text-[12px]"
                  style={{ color: "var(--text-primary)", background: "var(--bg-canvas)", border: "1px solid var(--border-2)" }}
                />
                {!isMilestone ? (
                  <input
                    aria-label={`${index + 1}번 일정 담당자`}
                    value={row.person}
                    onChange={(event) => onChangeRow(index, { person: event.target.value })}
                    placeholder="담당자 (선택)"
                    className="w-36 rounded-md px-2 py-1.5 text-[12px]"
                    style={{ color: "var(--text-primary)", background: "var(--bg-canvas)", border: "1px solid var(--border-2)" }}
                  />
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex min-w-44 flex-1 items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  시작
                  <input
                    type="date"
                    value={row.start}
                    onChange={(event) => {
                      const start = event.target.value;
                      const end = !row.end || row.end < start ? start : row.end;
                      onChangeRow(index, { start, end });
                    }}
                    className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-[12px]"
                    style={{ color: "var(--text-primary)", background: "var(--bg-canvas)", border: "1px solid var(--border-2)" }}
                  />
                </label>
                <label className="flex min-w-44 flex-1 items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  종료
                  <input
                    type="date"
                    value={row.end}
                    min={row.start || undefined}
                    onChange={(event) => onChangeRow(index, { end: event.target.value })}
                    className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-[12px]"
                    style={{ color: "var(--text-primary)", background: "var(--bg-canvas)", border: "1px solid var(--border-2)" }}
                  />
                </label>
                <label className="flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  <input
                    type="checkbox"
                    checked={!!row.start && row.end === row.start}
                    onChange={(event) => {
                      if (event.target.checked && row.start) onChangeRow(index, { end: row.start });
                    }}
                  />
                  같은 날
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {editError ? (
        <p role="alert" className="rounded-lg px-3 py-2 text-[12px]" style={{ color: "#9b4c3f", background: "#fff0ed", border: "1px solid #e8c2ba" }}>
          {editError}
        </p>
      ) : null}
    </div>
  );
}
