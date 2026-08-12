import type {
  WeeklyDetectedSource,
  WeeklyReplaySource,
  WeeklySourceText,
} from "@/lib/weekly-types";

export type WeeklySyncPayload = {
  ticketKey: string;
  weeklyText: string;
  sourceId: string;
};

export type JiraWeeklySourceResponse = {
  foundMarker?: boolean;
  text?: string;
  source?: string;
  policyReason?: string;
  sourceUpdatedAt?: string;
  parseSummary?: {
    sourceWeek?: string;
    schedulesCount?: number;
  };
  sources?: WeeklyDetectedSource[];
  syncSources?: WeeklyReplaySource[];
  error?: string;
};

export type PreparedWeeklySync = {
  items: WeeklySyncPayload[];
  sourceText: WeeklySourceText;
};

/** 전체·개별 Weekly Sync가 같은 source replay 정책을 사용하도록 payload를 정규화한다. */
export function prepareWeeklySync(
  ticketKey: string,
  source: JiraWeeklySourceResponse,
  savedAt = new Date().toISOString(),
): PreparedWeeklySync | null {
  if (!source.foundMarker || !source.text) return null;

  const replaySources: WeeklyReplaySource[] = Array.isArray(source.syncSources) && source.syncSources.length > 0
    ? source.syncSources
    : [{
        sourceId: `${source.source ?? "unknown"}:${source.sourceUpdatedAt ?? ""}`,
        text: source.text,
        source: source.source === "customfield" || source.source === "description" || source.source === "comment"
          ? source.source
          : "comment",
        sourceWeek: source.parseSummary?.sourceWeek ?? "",
        sourceUpdatedAt: source.sourceUpdatedAt ?? "",
      }];

  return {
    items: replaySources.map(replaySource => ({
      ticketKey,
      weeklyText: replaySource.text,
      sourceId: replaySource.sourceId,
    })),
    sourceText: {
      ticketKey,
      text: source.text,
      source: source.source ?? "",
      policyReason: source.policyReason ?? "",
      sourceWeek: source.parseSummary?.sourceWeek ?? "",
      sourceUpdatedAt: source.sourceUpdatedAt ?? "",
      savedAt,
      detectedSources: Array.isArray(source.sources) ? source.sources : undefined,
    },
  };
}

export type WeeklySyncBatchPayload = {
  items: WeeklySyncPayload[];
  attempts: Array<{
    ticketKey: string;
    reason?: "no_marker" | "src_error";
  }>;
  sourceTexts: Record<string, unknown>;
  timings?: {
    metadataMs?: number;
    sourceCollectionMs?: number;
    targetCount?: number;
    skippedUnchanged?: number;
  };
};

export type WeeklySyncBatchResponse = {
  ok: boolean;
  results: Array<Record<string, unknown>>;
  failures: Array<{ ticketKey: string; sourceId: string; error: string }>;
  summary: {
    sources: number;
    attemptedTickets: number;
    appliedTickets: number;
    failedTickets: number;
    schedulesUpdated: number;
    updateCandidates: number;
  };
  syncRunId?: string;
};

export type WeeklySyncFailure = {
  ticketKey: string;
  sourceId: string;
  status: number;
  code?: string;
  error: string;
  attempts: number;
};

type FetchWeeklySync = (input: string, init: RequestInit) => Promise<Response>;
type Wait = (ms: number) => Promise<void>;

export type WeeklySyncPostResult =
  | { ok: true; data: Record<string, unknown>; attempts: number }
  | { ok: false; failure: WeeklySyncFailure };

export type WeeklySyncBatchPostResult =
  | { ok: true; data: WeeklySyncBatchResponse; attempts: number }
  | { ok: false; failure: WeeklySyncFailure };

const defaultWait: Wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Redis lock timeout(503)만 제한적으로 재시도한다. 그 외 오류는 즉시 반환한다. */
export async function postWeeklySyncWithRetry(
  fetchWeeklySync: FetchWeeklySync,
  payload: WeeklySyncPayload,
  options: { maxAttempts?: number; baseDelayMs?: number; wait?: Wait } = {},
): Promise<WeeklySyncPostResult> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const wait = options.wait ?? defaultWait;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchWeeklySync("/api/weekly-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.ok) return { ok: true, data: body, attempts: attempt };

      const code = typeof body.code === "string" ? body.code : undefined;
      const retryable = response.status === 503 && (code === undefined || code === "redis_lock_timeout");
      if (retryable && attempt < maxAttempts) {
        await wait(baseDelayMs * (2 ** (attempt - 1)));
        continue;
      }

      return {
        ok: false,
        failure: {
          ticketKey: payload.ticketKey,
          sourceId: payload.sourceId,
          status: response.status,
          code,
          error: typeof body.error === "string" ? body.error : `HTTP ${response.status}`,
          attempts: attempt,
        },
      };
    } catch (error) {
      return {
        ok: false,
        failure: {
          ticketKey: payload.ticketKey,
          sourceId: payload.sourceId,
          status: 0,
          error: error instanceof Error ? error.message : String(error),
          attempts: attempt,
        },
      };
    }
  }

  throw new Error("unreachable");
}

/** 여러 Weekly source를 한 번의 Redis lock/read/write로 저장한다. */
export async function postWeeklySyncBatchWithRetry(
  fetchWeeklySync: FetchWeeklySync,
  payload: WeeklySyncBatchPayload,
  options: { maxAttempts?: number; baseDelayMs?: number; wait?: Wait } = {},
): Promise<WeeklySyncBatchPostResult> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const wait = options.wait ?? defaultWait;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchWeeklySync("/api/weekly-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.ok) {
        return { ok: true, data: body as WeeklySyncBatchResponse, attempts: attempt };
      }

      const code = typeof body.code === "string" ? body.code : undefined;
      const retryable = response.status === 503 && (code === undefined || code === "redis_lock_timeout");
      if (retryable && attempt < maxAttempts) {
        await wait(baseDelayMs * (2 ** (attempt - 1)));
        continue;
      }
      return {
        ok: false,
        failure: {
          ticketKey: "batch",
          sourceId: "batch",
          status: response.status,
          code,
          error: typeof body.error === "string" ? body.error : `HTTP ${response.status}`,
          attempts: attempt,
        },
      };
    } catch (error) {
      return {
        ok: false,
        failure: {
          ticketKey: "batch",
          sourceId: "batch",
          status: 0,
          error: error instanceof Error ? error.message : String(error),
          attempts: attempt,
        },
      };
    }
  }

  throw new Error("unreachable");
}
