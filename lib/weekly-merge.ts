/**
 * Weekly Delta Merge 로직
 * append-only, missing != removed, idempotent
 *
 * v2: stableTaskId 기반 row lookup + partial update + statusHistory
 */
import type {
  ParsedWeekly, WeeklyNote, UpdateCandidate,
  ScheduleSourceMeta, ScheduleStatus, StatusTransition,
} from "./weekly-types";
import {
  buildNoteId, buildMergeKey,
  buildStableTaskId, MILESTONE_PHASES, ALLOWED_PHASES,
  extractPhaseAndResource,
} from "./weekly-parser";

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
  ticketKey: string, rowKey: string, field: string, sourceWeek: string,
): string {
  return `${ticketKey}::${rowKey}::${field}::${sourceWeek}`.replace(/\s+/g, "_");
}

// ─── Row key: stableTaskId 우선, 없으면 legacy mergeKey ─────────

function getRowKey(ticketKey: string, row: ExtendedSchedule): string {
  if (row.stableTaskId) return row.stableTaskId;

  // phase가 없는 legacy row는 role에서 추론 (backward compat)
  let phase = row.phase;
  let resourceTeam = row.resourceTeam;
  if (!phase) {
    const inferred = extractPhaseAndResource(row.role);
    phase = inferred.phase;
    if (resourceTeam === undefined) resourceTeam = inferred.resourceTeam;
  }

  if (phase && phase !== "기타" && ALLOWED_PHASES.has(phase)) {
    const isMilestone = MILESTONE_PHASES.has(phase);
    return buildStableTaskId(
      ticketKey, phase, resourceTeam ?? null,
      isMilestone ? (row.start || null) : null,
    );
  }
  return row.mergeKey ?? buildMergeKey(ticketKey, row.role);
}

// ─── RoleSchedule 호환 status normalize ───────────────────────
// "지연"/"보류"는 TicketBoard RoleSchedule 타입에 없음 → "확인필요"로 저장.

function toStorageStatus(status: ScheduleStatus): RoleSchedule["status"] {
  if (status === "지연" || status === "보류") return "확인필요";
  return status as RoleSchedule["status"];
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
  // scheduleMap key: stableTaskId (when available) or legacy mergeKey.
  // 기존 rows 로드 — stableTaskId로 사후 계산하여 중복 없이 index.
  const scheduleMap = new Map<string, ExtendedSchedule>();
  for (const row of existingSchedules) {
    const key = getRowKey(ticketKey, row);
    scheduleMap.set(key, row);
  }

  // 이번 Weekly에서 처리된 key 집합 (stale detection용)
  const processedKeys = new Set<string>();

  for (const item of parsed.scheduleItems) {
    // 우선순위: parser가 계산한 stableTaskId → legacy mergeKey fallback
    const key = item.stableTaskId ?? buildMergeKey(ticketKey, item.normalizedRole);
    processedKeys.add(key);

    const existing = scheduleMap.get(key);

    if (!existing) {
      // ── 신규 row append ──────────────────────────────────────
      isIdempotent = false;
      const newRow: ExtendedSchedule = {
        role: item.normalizedRole,
        person: item.assignee ?? "",
        start: item.startDate ?? "",
        end: item.endDate ?? item.startDate ?? "",
        status: toStorageStatus(item.status),
        source: "jira_weekly",
        sourceWeek: parsed.sourceWeek,
        sourceUpdatedAt: nowIso,
        confidence: item.confidence ?? "high",
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        mergeKey: buildMergeKey(ticketKey, item.normalizedRole),
        stableTaskId: key,
        cancelledCandidate: item.isCancelled,
        phase: item.phase,
        resourceTeam: item.resourceTeam ?? null,
        statusHistory: [],
      };
      scheduleMap.set(key, newRow);
    } else {
      // ── Partial update ───────────────────────────────────────
      // dateMentioned: 어떤 필드가 이번 weekly에 실제로 명시됐는지.
      // 명시 안 된 필드는 기존 row 값 보존.
      const dm = item.dateMentioned ?? { start: true, end: true };

      const newStart = dm.start ? (item.startDate ?? existing.start) : existing.start;
      const newEnd   = dm.end   ? (item.endDate   ?? existing.end)   : existing.end;
      // status=확인필요는 파싱 실패로 간주 → 기존 status 보존
      const newStatus: ScheduleStatus = item.status !== "확인필요" ? item.status : existing.status;
      const newPerson = item.assignee ?? existing.person;

      // idempotent 판정: 동일 주차 + 동일 값이면 lastSeenAt만 갱신
      const sameWeek   = existing.sourceWeek === parsed.sourceWeek;
      const sameStart  = newStart  === existing.start;
      const sameEnd    = newEnd    === existing.end;
      const sameStatus = newStatus === existing.status;
      const samePerson = newPerson === existing.person;

      if (sameWeek && sameStart && sameEnd && sameStatus && samePerson) {
        scheduleMap.set(key, {
          ...existing,
          lastSeenAt: nowIso,
          stableTaskId: existing.stableTaskId ?? key,
        });
        continue;
      }

      isIdempotent = false;

      // statusHistory: 변경이 있을 때만 append
      const statusHistory: StatusTransition[] = [...(existing.statusHistory ?? [])];
      if (!sameStatus) {
        statusHistory.push({
          from: existing.status,
          to: newStatus,
          sourceWeek: parsed.sourceWeek,
          changedAt: nowIso,
        });
      }

      // conflict 감지 (candidate UI용)
      const isLocked = existing.manualLocked === true;
      const conflicts: Array<{ field: UpdateCandidate["field"]; oldV: string; newV: string }> = [];

      if (!sameStart && dm.start) conflicts.push({ field: "start",  oldV: existing.start,  newV: newStart });
      if (!sameEnd   && dm.end)   conflicts.push({ field: "end",    oldV: existing.end,    newV: newEnd });
      if (!sameStatus && item.status !== "확인필요") conflicts.push({ field: "status", oldV: existing.status, newV: toStorageStatus(newStatus) });
      if (!samePerson && item.assignee) conflicts.push({ field: "person", oldV: existing.person, newV: newPerson });

      const autoApply = !isLocked && conflicts.length <= 1;

      for (const c of conflicts) {
        const cid = buildCandidateId(ticketKey, key, c.field, parsed.sourceWeek);
        updateCandidates.push({
          id: cid,
          ticketKey,
          mergeKey: key,
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
        const updated: ExtendedSchedule = {
          ...existing,
          start:  newStart,
          end:    newEnd,
          status: toStorageStatus(newStatus),
          person: newPerson,
          sourceWeek: parsed.sourceWeek,
          sourceUpdatedAt: nowIso,
          lastSeenAt: nowIso,
          statusHistory,
          stableTaskId: existing.stableTaskId ?? key,
          mergeKey: existing.mergeKey ?? buildMergeKey(ticketKey, existing.role),
        };
        if (existing.source === "legacy" || existing.source === undefined) {
          updated.source = "jira_weekly";
        }
        scheduleMap.set(key, updated);
      } else {
        // manualLocked 또는 다중 충돌 → 값 유지, lastSeenAt + statusHistory만 갱신
        scheduleMap.set(key, {
          ...existing,
          lastSeenAt: nowIso,
          statusHistory,
          stableTaskId: existing.stableTaskId ?? key,
        });
      }
    }
  }

  // ── 2. Stale detection ──────────────────────────────────────
  for (const [key, row] of scheduleMap.entries()) {
    if (processedKeys.has(key)) continue;
    if (row.status === "진행중" && daysBefore(row.lastSeenAt, now) > 14) {
      staleCandidates.push(key);
    }
    if (row.status === "예정" && row.end && new Date(row.end) < now) {
      staleCandidates.push(key);
    }
  }

  // ── 3. Weekly Notes merge (idempotent append-only) ──────────
  const existingNoteIds = new Set(existingNotes.map(n => n.id));
  const mergedNotes: WeeklyNote[] = [...existingNotes];

  for (const content of parsed.progressItems) {
    const id = buildNoteId(ticketKey, parsed.sourceWeek, "progress", content);
    if (existingNoteIds.has(id)) {
      const idx = mergedNotes.findIndex(n => n.id === id);
      if (idx >= 0) mergedNotes[idx] = { ...mergedNotes[idx], lastSeenAt: nowIso };
    } else {
      const note: WeeklyNote = {
        id, ticketKey, source: "jira_weekly", sourceWeek: parsed.sourceWeek,
        type: "progress", content, status: "open",
        createdAt: nowIso, sourceUpdatedAt: nowIso, lastSeenAt: nowIso,
      };
      mergedNotes.push(note);
      newNotes.push(note);
      existingNoteIds.add(id);
    }
  }

  for (const risk of parsed.risks) {
    const id = buildNoteId(ticketKey, parsed.sourceWeek, "risk", risk.content);
    if (existingNoteIds.has(id)) {
      const idx = mergedNotes.findIndex(n => n.id === id);
      if (idx >= 0) mergedNotes[idx] = { ...mergedNotes[idx], lastSeenAt: nowIso };
    } else {
      const note: WeeklyNote = {
        id, ticketKey, source: "jira_weekly", sourceWeek: parsed.sourceWeek,
        type: "risk", content: risk.content, severity: risk.severity,
        status: "open", createdAt: nowIso, sourceUpdatedAt: nowIso, lastSeenAt: nowIso,
      };
      mergedNotes.push(note);
      newNotes.push(note);
      existingNoteIds.add(id);
    }
  }

  for (const action of parsed.nextActions) {
    const id = buildNoteId(ticketKey, parsed.sourceWeek, "next_action", action.content);
    if (existingNoteIds.has(id)) {
      const idx = mergedNotes.findIndex(n => n.id === id);
      if (idx >= 0) mergedNotes[idx] = { ...mergedNotes[idx], lastSeenAt: nowIso };
    } else {
      const note: WeeklyNote = {
        id, ticketKey, source: "jira_weekly", sourceWeek: parsed.sourceWeek,
        type: "next_action", content: action.content, actionCategory: action.actionCategory,
        status: "open", createdAt: nowIso, sourceUpdatedAt: nowIso, lastSeenAt: nowIso,
      };
      mergedNotes.push(note);
      newNotes.push(note);
      existingNoteIds.add(id);
    }
  }

  return {
    updatedSchedules: Array.from(scheduleMap.values()),
    updateCandidates,
    newNotes: mergedNotes,
    staleCandidates,
    isIdempotent,
  };
}
