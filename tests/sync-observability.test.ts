import assert from "node:assert/strict";
import test from "node:test";
import type { JiraFilter } from "../lib/filter-types";
import {
  DATA_SOURCE_STALE_AFTER_MS,
  getDataSourceHealth,
  getFilterLastSuccessAt,
} from "../lib/sync-run-types";
import {
  addSyncRunStage,
  completeSyncRun,
  createSyncRun,
} from "../lib/sync-runs";

function filter(overrides: Partial<JiraFilter> = {}): JiraFilter {
  return {
    id: "filter-1",
    jiraFilterId: "12345",
    name: "test",
    jql: "project = TM",
    createdAt: "2026-08-01T00:00:00.000Z",
    lastSyncAt: null,
    lastSyncCount: null,
    lastSyncError: null,
    ...overrides,
  };
}

test("legacy lastSyncAt is treated as a successful sync when there is no error", () => {
  const value = filter({ lastSyncAt: "2026-08-10T00:00:00.000Z" });
  assert.equal(getFilterLastSuccessAt(value), "2026-08-10T00:00:00.000Z");
});

test("stale data sources are distinguished from current sources", () => {
  const now = new Date("2026-08-12T00:00:00.000Z").getTime();
  const recent = filter({ lastSuccessAt: new Date(now - 60_000).toISOString() });
  const stale = filter({ lastSuccessAt: new Date(now - DATA_SOURCE_STALE_AFTER_MS - 1).toISOString() });

  assert.equal(getDataSourceHealth(recent, now).status, "current");
  assert.equal(getDataSourceHealth(stale, now).status, "stale");
});

test("a failed attempt is shown as an error without losing the stored success time", () => {
  const value = filter({
    lastSyncAt: "2026-08-10T00:00:00.000Z",
    lastSuccessAt: "2026-08-10T00:00:00.000Z",
    lastAttemptAt: "2026-08-12T00:00:00.000Z",
    lastSyncError: "Jira timeout",
  });
  const health = getDataSourceHealth(value, new Date("2026-08-12T00:01:00.000Z").getTime());

  assert.equal(health.status, "error");
  assert.equal(health.lastSuccessAt, "2026-08-10T00:00:00.000Z");
});

test("sync run records keep stage timing and final totals", () => {
  const run = createSyncRun("daily-refresh", "cron");
  addSyncRunStage(run, {
    key: "jira-filters",
    label: "Jira 데이터 소스 갱신",
    status: "success",
    durationMs: 1_250,
    counts: { syncedFilters: 4 },
  });
  completeSyncRun(run, "success", {
    counts: { syncedFilters: 4 },
    finishedAt: new Date(new Date(run.startedAt).getTime() + 1_500).toISOString(),
  });

  assert.equal(run.status, "success");
  assert.equal(run.durationMs, 1_500);
  assert.equal(run.stages[0].durationMs, 1_250);
  assert.equal(run.counts?.syncedFilters, 4);
});
