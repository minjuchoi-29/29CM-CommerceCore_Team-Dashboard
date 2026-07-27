type RedisLockClient = {
  set(
    key: string,
    value: string,
    options: { nx: true; px: number },
  ): Promise<"OK" | string | null>;
  eval<TArgs extends unknown[], TResult>(
    script: string,
    keys: string[],
    args: TArgs,
  ): Promise<TResult>;
};

const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

export class RedisLockTimeoutError extends Error {
  constructor(lockKey: string) {
    super(`Timed out waiting for Redis lock: ${lockKey}`);
    this.name = "RedisLockTimeoutError";
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Serialize read-modify-write operations that touch shared JSON Redis keys.
 *
 * The unique token and compare-and-delete Lua script prevent an expired lock
 * holder from deleting a lock acquired by a newer request.
 */
export async function withRedisLock<T>(
  client: RedisLockClient,
  lockKey: string,
  operation: () => Promise<T>,
  options: { ttlMs?: number; waitTimeoutMs?: number; retryMs?: number } = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? 15_000;
  const waitTimeoutMs = options.waitTimeoutMs ?? 10_000;
  const retryMs = options.retryMs ?? 50;
  const token = crypto.randomUUID();
  const deadline = Date.now() + waitTimeoutMs;

  while (true) {
    const acquired = await client.set(lockKey, token, { nx: true, px: ttlMs });
    if (acquired === "OK") break;
    if (Date.now() >= deadline) throw new RedisLockTimeoutError(lockKey);
    await wait(retryMs);
  }

  try {
    return await operation();
  } finally {
    await client.eval<[string], number>(RELEASE_LOCK_SCRIPT, [lockKey], [token]);
  }
}
