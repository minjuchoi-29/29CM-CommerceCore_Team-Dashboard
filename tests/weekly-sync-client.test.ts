import assert from "node:assert/strict";
import test from "node:test";

import { postWeeklySyncBatchWithRetry, postWeeklySyncWithRetry } from "../lib/weekly-sync-client";

const payload = { ticketKey: "TM-2922", weeklyText: "31주차", sourceId: "schedule-v3:test" };

test("Redis lock 503은 지수 간격으로 재시도한 뒤 성공", async () => {
  let calls = 0;
  const waits: number[] = [];
  const result = await postWeeklySyncWithRetry(
    async () => {
      calls += 1;
      return calls < 3
        ? Response.json({ code: "redis_lock_timeout", error: "locked" }, { status: 503 })
        : Response.json({ ok: true });
    },
    payload,
    { baseDelayMs: 100, wait: async ms => { waits.push(ms); } },
  );

  assert.equal(result.ok, true);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [100, 200]);
});

test("재시도 후에도 503이면 티켓·source·시도 횟수를 반환", async () => {
  const result = await postWeeklySyncWithRetry(
    async () => Response.json({ code: "redis_lock_timeout", error: "locked" }, { status: 503 }),
    payload,
    { baseDelayMs: 0, wait: async () => undefined },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.ticketKey, "TM-2922");
  assert.equal(result.failure.sourceId, "schedule-v3:test");
  assert.equal(result.failure.status, 503);
  assert.equal(result.failure.attempts, 3);
});

test("재시도 불가능한 500은 즉시 실패", async () => {
  let calls = 0;
  const result = await postWeeklySyncWithRetry(async () => {
    calls += 1;
    return Response.json({ error: "unexpected" }, { status: 500 });
  }, payload);

  assert.equal(result.ok, false);
  assert.equal(calls, 1);
});

test("batch sync는 여러 source를 한 요청으로 전송", async () => {
  const requestBodies: Record<string, unknown>[] = [];
  const result = await postWeeklySyncBatchWithRetry(async (_input, init) => {
    requestBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return Response.json({
      ok: true,
      results: [],
      failures: [],
      summary: {
        sources: 2,
        attemptedTickets: 1,
        appliedTickets: 1,
        failedTickets: 0,
        schedulesUpdated: 2,
        updateCandidates: 0,
      },
    });
  }, {
    items: [payload, { ...payload, sourceId: "schedule-v3:test-2" }],
    attempts: [{ ticketKey: payload.ticketKey }],
    sourceTexts: {},
  });

  assert.equal(result.ok, true);
  assert.equal(Array.isArray(requestBodies[0]?.items), true);
  assert.equal((requestBodies[0]?.items as unknown[]).length, 2);
});

test("batch sync도 Redis lock 503만 재시도", async () => {
  let calls = 0;
  const result = await postWeeklySyncBatchWithRetry(async () => {
    calls += 1;
    return calls === 1
      ? Response.json({ code: "redis_lock_timeout", error: "locked" }, { status: 503 })
      : Response.json({
          ok: true,
          results: [],
          failures: [],
          summary: {
            sources: 0,
            attemptedTickets: 0,
            appliedTickets: 0,
            failedTickets: 0,
            schedulesUpdated: 0,
            updateCandidates: 0,
          },
        });
  }, {
    items: [],
    attempts: [],
    sourceTexts: {},
  }, { baseDelayMs: 0, wait: async () => undefined });

  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});
