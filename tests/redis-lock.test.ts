import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RedisLockTimeoutError, withRedisLock } from "../lib/redis-lock";

class FakeRedisLockClient {
  private locks = new Map<string, string>();

  async set(key: string, value: string): Promise<"OK" | null> {
    if (this.locks.has(key)) return null;
    this.locks.set(key, value);
    return "OK";
  }

  async eval<TArgs extends unknown[], TResult>(
    _script: string,
    keys: string[],
    args: TArgs,
  ): Promise<TResult> {
    if (this.locks.get(keys[0]) === args[0]) this.locks.delete(keys[0]);
    return 1 as TResult;
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("withRedisLock", () => {
  it("동시에 시작한 read-modify-write 작업을 직렬화", async () => {
    const client = new FakeRedisLockClient();
    const events: string[] = [];

    await Promise.all([
      withRedisLock(client, "weekly", async () => {
        events.push("first:start");
        await delay(20);
        events.push("first:end");
      }, { retryMs: 1 }),
      withRedisLock(client, "weekly", async () => {
        events.push("second:start");
        events.push("second:end");
      }, { retryMs: 1 }),
    ]);

    assert.deepEqual(events, [
      "first:start", "first:end", "second:start", "second:end",
    ]);
  });

  it("대기 제한을 넘으면 명시적인 timeout error", async () => {
    const client = new FakeRedisLockClient();

    await assert.rejects(
      () => withRedisLock(client, "weekly", async () => {
        await withRedisLock(client, "weekly", async () => undefined, {
          waitTimeoutMs: 2,
          retryMs: 1,
        });
      }),
      RedisLockTimeoutError,
    );
  });
});
