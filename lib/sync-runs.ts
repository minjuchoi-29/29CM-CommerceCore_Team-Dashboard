import { redis } from "@/lib/redis";
import type {
  SyncRunKind,
  SyncRunRecord,
  SyncRunStage,
  SyncRunStatus,
  SyncRunTrigger,
} from "@/lib/sync-run-types";

const SYNC_RUN_INDEX_KEY = "cc-sync-run-ids";
const SYNC_RUN_KEY_PREFIX = "cc-sync-run:";
const MAX_SYNC_RUNS = 80;
const RUN_TTL_SECONDS = 60 * 60 * 24 * 60;

export function createSyncRun(
  kind: SyncRunKind,
  trigger: SyncRunTrigger,
  context?: Record<string, string>,
): SyncRunRecord {
  return {
    id: crypto.randomUUID(),
    kind,
    trigger,
    status: "running",
    startedAt: new Date().toISOString(),
    stages: [],
    context,
  };
}

export function addSyncRunStage(
  run: SyncRunRecord,
  stage: SyncRunStage,
): SyncRunRecord {
  run.stages = [...run.stages.filter(item => item.key !== stage.key), stage];
  return run;
}

export function completeSyncRun(
  run: SyncRunRecord,
  status: Exclude<SyncRunStatus, "running">,
  options: { counts?: Record<string, number>; error?: string; finishedAt?: string } = {},
): SyncRunRecord {
  const finishedAt = options.finishedAt ?? new Date().toISOString();
  run.status = status;
  run.finishedAt = finishedAt;
  run.durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(run.startedAt).getTime());
  run.counts = options.counts;
  run.error = options.error;
  return run;
}

export async function startSyncRun(run: SyncRunRecord): Promise<void> {
  await Promise.all([
    redis.set(`${SYNC_RUN_KEY_PREFIX}${run.id}`, run, { ex: RUN_TTL_SECONDS }),
    redis.lpush(SYNC_RUN_INDEX_KEY, run.id),
  ]);
  await redis.ltrim(SYNC_RUN_INDEX_KEY, 0, MAX_SYNC_RUNS - 1);
}

export async function saveSyncRun(run: SyncRunRecord): Promise<void> {
  await redis.set(`${SYNC_RUN_KEY_PREFIX}${run.id}`, run, { ex: RUN_TTL_SECONDS });
}

export async function listSyncRuns(
  limit = 20,
  kind?: SyncRunKind,
): Promise<SyncRunRecord[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  // kind 필터가 있으면 오래된 항목을 건너뛸 수 있으므로 여유 있게 읽는다.
  const ids = await redis.lrange<string>(SYNC_RUN_INDEX_KEY, 0, kind ? MAX_SYNC_RUNS - 1 : safeLimit - 1);
  if (ids.length === 0) return [];
  const runs = await Promise.all(ids.map(id => redis.get<SyncRunRecord>(`${SYNC_RUN_KEY_PREFIX}${id}`)));
  return runs
    .filter((run): run is SyncRunRecord => Boolean(run) && (!kind || run?.kind === kind))
    .slice(0, safeLimit);
}
