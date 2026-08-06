export type WeeklySyncPayload = {
  ticketKey: string;
  weeklyText: string;
  sourceId: string;
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
