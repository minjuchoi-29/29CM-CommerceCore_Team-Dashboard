/**
 * search-target — set / read / clear + TTL + schema 검증.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string): void { this.store.set(k, v); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
  get length(): number { return this.store.size; }
  key(i: number): string | null { return [...this.store.keys()][i] ?? null; }
}

// 테스트 전용 mock window — 헬퍼 가 사용하는 sessionStorage 만 노출.
// 실제 Window 인터페이스 전체를 구현하지 않으므로 unknown 캐스팅.
type MockWindow = { sessionStorage: MemoryStorage };
const g = globalThis as unknown as { window?: MockWindow };
g.window = { sessionStorage: new MemoryStorage() };

import {
  setSearchTarget,
  readSearchTarget,
  clearSearchTarget,
  SEARCH_TARGET_STORAGE_KEY,
  SEARCH_TARGET_MAX_AGE_MS,
} from "../lib/search-target";

describe("search-target — set / read round-trip", () => {
  beforeEach(() => g.window!.sessionStorage.clear());

  it("set 후 read 동일 payload 반환", () => {
    const t = { kind: "ticket" as const, key: "TM-2745", query: "TM-2745", focus: true, createdAt: 1_700_000_000_000 };
    setSearchTarget(t);
    const got = readSearchTarget(t.createdAt + 1);
    assert.deepEqual(got, t);
  });

  it("kind=etr 도 동일 round-trip", () => {
    const t = { kind: "etr" as const, key: "ETR-3855", query: "ETR-3855", focus: false, createdAt: 1_700_000_000_000 };
    setSearchTarget(t);
    const got = readSearchTarget(t.createdAt + 1);
    assert.deepEqual(got, t);
  });
});

describe("search-target — TTL", () => {
  beforeEach(() => g.window!.sessionStorage.clear());

  it("createdAt 으로부터 30s 이내 → 유효", () => {
    const t = { kind: "ticket" as const, key: "TM-1", query: "", focus: true, createdAt: 1_700_000_000_000 };
    setSearchTarget(t);
    const got = readSearchTarget(t.createdAt + 29_000);
    assert.ok(got, "30s 이내 readable");
  });

  it("createdAt 으로부터 30s 초과 → null + storage clear", () => {
    const t = { kind: "ticket" as const, key: "TM-1", query: "", focus: true, createdAt: 1_700_000_000_000 };
    setSearchTarget(t);
    const got = readSearchTarget(t.createdAt + SEARCH_TARGET_MAX_AGE_MS + 1);
    assert.equal(got, null);
    assert.equal(g.window!.sessionStorage.getItem(SEARCH_TARGET_STORAGE_KEY), null, "stale target 은 storage 에서도 제거");
  });
});

describe("search-target — clear", () => {
  beforeEach(() => g.window!.sessionStorage.clear());

  it("clear 후 read → null", () => {
    setSearchTarget({ kind: "ticket", key: "TM-1", query: "TM", focus: true, createdAt: Date.now() });
    clearSearchTarget();
    assert.equal(readSearchTarget(), null);
  });

  it("storage 비어있을 때 clear → no-op (throw 없음)", () => {
    assert.doesNotThrow(() => clearSearchTarget());
  });
});

describe("search-target — schema 검증", () => {
  beforeEach(() => g.window!.sessionStorage.clear());

  it("kind 가 ticket / etr 아니면 null", () => {
    g.window!.sessionStorage.setItem(SEARCH_TARGET_STORAGE_KEY, JSON.stringify({ kind: "other", key: "X", query: "", focus: true, createdAt: Date.now() }));
    assert.equal(readSearchTarget(), null);
  });

  it("key 가 빈 문자열 / 누락 → null", () => {
    g.window!.sessionStorage.setItem(SEARCH_TARGET_STORAGE_KEY, JSON.stringify({ kind: "ticket", key: "", query: "", focus: true, createdAt: Date.now() }));
    assert.equal(readSearchTarget(), null);
  });

  it("createdAt 누락 → null", () => {
    g.window!.sessionStorage.setItem(SEARCH_TARGET_STORAGE_KEY, JSON.stringify({ kind: "ticket", key: "TM-1", query: "", focus: true }));
    assert.equal(readSearchTarget(), null);
  });

  it("JSON 깨짐 → null + storage clear", () => {
    g.window!.sessionStorage.setItem(SEARCH_TARGET_STORAGE_KEY, "{not json");
    assert.equal(readSearchTarget(), null);
    assert.equal(g.window!.sessionStorage.getItem(SEARCH_TARGET_STORAGE_KEY), null);
  });

  it("focus 누락 → 기본 false 로 normalize", () => {
    g.window!.sessionStorage.setItem(SEARCH_TARGET_STORAGE_KEY, JSON.stringify({ kind: "ticket", key: "TM-1", query: "", createdAt: Date.now() }));
    const got = readSearchTarget();
    assert.ok(got);
    assert.equal(got!.focus, false);
  });
});

describe("search-target — storage 없음", () => {
  let savedWindow: MockWindow | undefined;

  beforeEach(() => {
    savedWindow = g.window;
    delete (g as { window?: MockWindow }).window;
  });
  afterEach(() => {
    g.window = savedWindow;
  });

  it("window 없음 → set / read / clear 모두 throw 없음", () => {
    assert.doesNotThrow(() => setSearchTarget({ kind: "ticket", key: "TM-1", query: "", focus: true, createdAt: Date.now() }));
    assert.equal(readSearchTarget(), null);
    assert.doesNotThrow(() => clearSearchTarget());
  });
});
