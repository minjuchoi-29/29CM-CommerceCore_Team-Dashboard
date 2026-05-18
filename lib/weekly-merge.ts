/**
 * Weekly Delta Merge 로직
 * append-only, missing != removed, idempotent
 */
import type {
  ParsedWeekly, WeeklyNote, UpdateCandidate,
  ScheduleSourceMeta,
} from "./weekly-types";
import { buildNoteId, buildMergeKey } from "./weekly-parser";

// ─── 로컬 RoleSchedule 정의 (TicketBoard.tsx와 KV 호환) ────────
interface RoleSchedule {
  role: string;
  person: string;
  start: string;
  end: string;
  status: "완료" | "진행중" | "예정" | "미정" | "확인필요";
  detail?: string;
  detailPerson?: string;
  vacationDays?: number;
}

export type ExtendedSchedule = RoleSchedule & ScheduleSourceMeta;

export interface MergeResult {
  updatedSchedules: ExtendedSchedule[];
  updateCandidates: UpdateCandidate[];
  newNotes: WeeklyNote[];
  staleCandidates: string[];
  isIdempotent: boolean;
}

// ─── 날짜 비교 헬퍼 ────────────────────────────────────────────

function daysBefore(isoDate: string | undefined, now: Date): number {
  if (!isoDate) return 0;
  return Math.floor((now.getTime() - new Date(isoDate).getTime()) / 86400000);
}

// ─── Candidate ID ─────────────────────────────────────────────

function buildCandidateId(
  ticketKey: string, mergeKey: string, field: string, sourceWeek: string
): string {
  return `${ticketKey}::${mergeKey}::${field}::${sourceWeek}`.replace(/\s+/g, "_");
}

// ─── 메인 merge ──────────────────────────────────────────────

export function mergeWeeklySync(
  ticketKey: string,
  parsed: ParsedWeekly,
  existingSchedules: ExtendedSchedule[],
  existingNotes: WeeklyNote[],
  now: Date = new Date(),
): MergeResult {
  const nowIso = now.toISOString();
  const updateCandidates: UpdateCandidate[] = [];
  const newNotes: WeeklyNote[] = [];
  const staleCandidates: string[] = [];
  let isIdempotent = true;

  // ── 1. Schedule merge ───────────────────────────────────────
  // 기존 rows를 mergeKey로 index
  const existingByMergeKey = new Map<string, ExtendedSchedule>();
  for (const row of existingSchedules) {
    const mk = row.mergeKey ?? buildMergeKey(ticketKey, row.role);
    existingByMergeKey.set(mk, row);
  }

  // 이번 Weekly에서 처리된 mergeKey 집합
  const processedMergeKeys = new Set<string>();

  // 업데이트된 schedules (기존 rows + append)
  const scheduleMap = new Map<string, ExtendedSchedule>();
  for (const row of existingSchedules) {
    const mk = row.mergeKey ?? buildMergeKey(ticketKey, row.role);
    scheduleMap.set(mk, row);
  }

  for (const item of parsed.scheduleItems) {
    const mk = buildMergeKey(ticketKey, item.normalizedRole);
    processedMergeKeys.add(mk);

    const existing = scheduleMap.get(mk);

    if (!existing) {
      // 신규 append
      isIdempotent = false;
      const newRow: ExtendedSchedule = {
        role: item.normalizedRole,
        person: item.assignee ?? "",
        start: item.startDate ?? "",
        end: item.endDate ?? item.startDate ?? "",
        status: (item.status === "지연" || item.status === "보류")
          ? "확인필요"
          : item.status as RoleSchedule["status"],
        source: "jira_weekly",
        sourceWeek: parsed.sourceWeek,
        sourceUpdatedAt: nowIso,
        confidence: "high",
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        mergeKey: mk,
        cancelledCandidate: item.isCancelled,
      };
      scheduleMap.set(mk, newRow);
    } else {
      // 동일 sourceWeek + 동일 내용 → idempotent (lastSeenAt만 갱신)
      const sameWeek = existing.sourceWeek === parsed.sourceWeek;
      const sameStart = (existing.start || "") === (item.startDate ?? "");
      const sameEnd = (existing.end || "") === (item.endDate ?? item.startDate ?? "");
      const sameStatus = existing.status === item.status;
      const samePerson = (existing.person || "") === (item.assignee ?? "");

      if (sameWeek && sameStart && sameEnd && sameStatus && samePerson) {
        // idempotent — just update lastSeenAt
        scheduleMap.set(mk, { ...existing, lastSeenAt: nowIso });
        continue;
      }

      isIdempotent = false;

      // manualLocked → candidate만, auto-apply 금지
      const isLocked = existing.manualLocked === true;
      const conflicts: Array<{ field: UpdateCandidate["field"]; oldV: string; newV: string }> = [];

      if (!sameStart) conflicts.push({ field: "start", oldV: existing.start, newV: item.startDate ?? "" });
      if (!sameEnd) conflicts.push({ field: "end", oldV: existing.end, newV: item.endDate ?? "" });
      if (!sameStatus && item.status !== "확인필요") conflicts.push({ field: "status", oldV: existing.status, newV: item.status });
      if (!samePerson && item.assignee) conflicts.push({ field: "person", oldV: existing.person, newV: item.assignee });

      const autoApply = !isLocked && conflicts.length <= 1;

      for (const c of conflicts) {
        const cid = buildCandidateId(ticketKey, mk, c.field, parsed.sourceWeek);
        updateCandidates.push({
          id: cid,
          ticketKey,
          mergeKey: mk,
          sourceWeek: parsed.sourceWeek,
          field: c.field,
          oldValue: c.oldV,
          newValue: c.newV,
          autoApply,
          resolved: false,
          createdAt: nowIso,
        });
      }

      if (autoApply) {
        // 자동 적용
        const updated: ExtendedSchedule = { ...existing };
        for (const c of conflicts) {
          (updated as unknown as Record<string, unknown>)[c.field] = c.newV;
        }
        updated.sourceWeek = parsed.sourceWeek;
        updated.sourceUpdatedAt = nowIso;
        updated.lastSeenAt = nowIso;
        if (existing.source === "legacy" || existing.source === undefined) {
          updated.source = "jira_weekly";
        }
        scheduleMap.set(mk, updated);
      } else {
        // lastSeenAt + sourceWeek만 갱신 (값은 유지)
        scheduleMap.set(mk, { ...existing, lastSeenAt: nowIso });
      }
    }
  }

  // ── 2. Stale detection ──────────────────────────────────────
  for (const [mk, row] of scheduleMap.entries()) {
    if (processedMergeKeys.has(mk)) continue;  // 이번 Weekly에 있었음
    // 진행중 + lastSeenAt > 14일
    if (row.status === "진행중" && daysBefore(row.lastSeenAt, now) > 14) {
      staleCandidates.push(mk);
    }
    // 예정 + endDate 지남
    if (row.status === "예정" && row.end && new Date(row.end) < now) {
      staleCandidates.push(mk);
    }
  }

  // ── 3. Weekly Notes merge (idempotent append-only) ──────────
  const existingNoteIds = new Set(existingNotes.map(n => n.id));
  const mergedNotes: WeeklyNote[] = [...existingNotes];

  // progress
  for (const content of parsed.progressItems) {
    const id = buildNoteId(ticketKey, parsed.sourceWeek, "progress", content);
    if (existingNoteIds.has(id)) {
      // idempotent — update lastSeenAt
      const idx = mergedNotes.findIndex(n => n.id === id);
      if (idx >= 0) mergedNotes[idx] = { ...mergedNotes[idx], lastSeenAt: nowIso };
    } else {
      const note: WeeklyNote = {
        id,
        ticketKey,
        source: "jira_weekly",
        sourceWeek: parsed.sourceWeek,
        type: "progress",
        content,
        status: "open",
        createdAt: nowIso,
        sourceUpdatedAt: nowIso,
        lastSeenAt: nowIso,
      };
      mergedNotes.push(note);
      newNotes.push(note);
      existingNoteIds.add(id);
    }
  }

  // risks
  for (const risk of parsed.risks) {
    const id = buildNoteId(ticketKey, parsed.sourceWeek, "risk", risk.content);
    if (existingNoteIds.has(id)) {
      const idx = mergedNotes.findIndex(n => n.id === id);
      if (idx >= 0) mergedNotes[idx] = { ...mergedNotes[idx], lastSeenAt: nowIso };
    } else {
      const note: WeeklyNote = {
        id,
        ticketKey,
        source: "jira_weekly",
        sourceWeek: parsed.sourceWeek,
        type: "risk",
        content: risk.content,
        severity: risk.severity,
        status: "open",
        createdAt: nowIso,
        sourceUpdatedAt: nowIso,
        lastSeenAt: nowIso,
      };
      mergedNotes.push(note);
      newNotes.push(note);
      existingNoteIds.add(id);
    }
  }

  // next actions
  for (const action of parsed.nextActions) {
    const id = buildNoteId(ticketKey, parsed.sourceWeek, "next_action", action.content);
    if (existingNoteIds.has(id)) {
      const idx = mergedNotes.findIndex(n => n.id === id);
      if (idx >= 0) mergedNotes[idx] = { ...mergedNotes[idx], lastSeenAt: nowIso };
    } else {
      const note: WeeklyNote = {
        id,
        ticketKey,
        source: "jira_weekly",
        sourceWeek: parsed.sourceWeek,
        type: "next_action",
        content: action.content,
        actionCategory: action.actionCategory,
        status: "open",
        createdAt: nowIso,
        sourceUpdatedAt: nowIso,
        lastSeenAt: nowIso,
      };
      mergedNotes.push(note);
      newNotes.push(note);
      existingNoteIds.add(id);
    }
  }

  return {
    updatedSchedules: Array.from(scheduleMap.values()),
    updateCandidates,
    newNotes: mergedNotes,  // 전체 merged notes (newNotes만 따로도 있음)
    staleCandidates,
    isIdempotent,
  };
}
