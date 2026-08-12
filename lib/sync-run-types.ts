import type { JiraFilter } from "@/lib/filter-types";

export type SyncRunKind = "daily-refresh" | "filter" | "jira";
export type SyncRunTrigger = "cron" | "manual" | "dashboard";
export type SyncRunStatus = "running" | "success" | "partial" | "failed";

export interface SyncRunStage {
  key: string;
  label: string;
  status: "success" | "skipped" | "failed";
  durationMs: number;
  counts?: Record<string, number>;
  error?: string;
}

export interface SyncRunRecord {
  id: string;
  kind: SyncRunKind;
  trigger: SyncRunTrigger;
  status: SyncRunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  stages: SyncRunStage[];
  counts?: Record<string, number>;
  error?: string;
  context?: Record<string, string>;
}

export type DataSourceHealthStatus = "current" | "stale" | "error" | "pending";

export interface DataSourceHealth {
  status: DataSourceHealthStatus;
  label: string;
  lastSuccessAt: string | null;
  ageMs: number | null;
}

/** 매일 실행되는 소스가 하루 한 번 지연되어도 오탐하지 않도록 36시간을 허용한다. */
export const DATA_SOURCE_STALE_AFTER_MS = 36 * 60 * 60 * 1_000;

export function getFilterLastSuccessAt(filter: JiraFilter): string | null {
  if (filter.lastSuccessAt) return filter.lastSuccessAt;
  // 하위 호환: 과거 레코드는 성공/시도 시각이 lastSyncAt 하나뿐이었다.
  return filter.lastSyncError ? null : filter.lastSyncAt;
}

export function getDataSourceHealth(
  filter: JiraFilter,
  nowMs = Date.now(),
  staleAfterMs = DATA_SOURCE_STALE_AFTER_MS,
): DataSourceHealth {
  const lastSuccessAt = getFilterLastSuccessAt(filter);
  if (filter.lastSyncError) {
    return { status: "error", label: "오류", lastSuccessAt, ageMs: null };
  }
  if (!lastSuccessAt) {
    return { status: "pending", label: "동기화 전", lastSuccessAt: null, ageMs: null };
  }

  const timestamp = new Date(lastSuccessAt).getTime();
  if (!Number.isFinite(timestamp)) {
    return { status: "pending", label: "동기화 전", lastSuccessAt: null, ageMs: null };
  }
  const ageMs = Math.max(0, nowMs - timestamp);
  if (ageMs > staleAfterMs) {
    return { status: "stale", label: "갱신 지연", lastSuccessAt, ageMs };
  }
  return { status: "current", label: "최신", lastSuccessAt, ageMs };
}
