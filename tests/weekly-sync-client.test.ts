import assert from "node:assert/strict";
import test from "node:test";

import { postWeeklySyncBatchWithRetry, postWeeklySyncWithRetry, prepareWeeklySync } from "../lib/weekly-sync-client";

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

test("개별 Weekly 갱신은 API가 제공한 replay source를 같은 티켓 batch로 변환", () => {
  const prepared = prepareWeeklySync("TM-2215", {
    foundMarker: true,
    text: "33주차 Weekly 공유사항\n- 개발중",
    source: "customfield",
    policyReason: "customfield-first",
    sourceUpdatedAt: "2026-08-12T01:00:00.000Z",
    parseSummary: { sourceWeek: "33주차", schedulesCount: 1 },
    syncSources: [
      {
        sourceId: "comment:32:v1",
        text: "32주차 Weekly 공유사항\n- 개발 착수",
        source: "comment",
        sourceWeek: "32주차",
        sourceUpdatedAt: "2026-08-05T01:00:00.000Z",
      },
      {
        sourceId: "customfield:33:v1",
        text: "33주차 Weekly 공유사항\n- 개발중",
        source: "customfield",
        sourceWeek: "33주차",
        sourceUpdatedAt: "2026-08-12T01:00:00.000Z",
      },
    ],
  }, "2026-08-12T02:00:00.000Z");

  assert.ok(prepared);
  assert.deepEqual(prepared.items.map(item => item.sourceId), ["comment:32:v1", "customfield:33:v1"]);
  assert.equal(prepared.items.every(item => item.ticketKey === "TM-2215"), true);
  assert.equal(prepared.sourceText.sourceWeek, "33주차");
  assert.equal(prepared.sourceText.savedAt, "2026-08-12T02:00:00.000Z");
});

test("Weekly marker가 없으면 기존 내용을 지울 payload를 만들지 않음", () => {
  assert.equal(prepareWeeklySync("TM-2215", { foundMarker: false, text: "일반 본문" }), null);
});
