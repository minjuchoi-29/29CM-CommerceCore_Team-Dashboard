/**
 * Global Search Target — Overlay 가 명시적으로 기록하고 도착 화면이 우선 처리하는 sessionStorage payload.
 *
 * URL param 만으로는 deep-link 보장이 불안정한 환경 (브라우저별 URL 정규화 / 캐시 / popstate 경합) 을
 * 대비하여, **선택 시점에 sessionStorage 에 명시 target 을 기록** → 도착 페이지가 mount 후
 * 이 target 을 최우선으로 읽어 selected / Focus Mode / detailTab / scroll 까지 동기 처리.
 *
 *  - sessionStorage 는 같은 tab 안에서 window.location.href 전환 후에도 보존됨
 *  - 단일 key 사용 — 동시에 둘 이상의 target 없음
 *  - createdAt 30s TTL — stale 진입 차단
 *  - 처리 성공 후 즉시 clear → 다른 페이지로 이동 시 잔존 진입 방지
 */

export type SearchTargetKind = "ticket" | "etr";

export type SearchTarget = {
  kind: SearchTargetKind;
  key: string;
  query: string;
  focus: boolean;
  createdAt: number;
};

export const SEARCH_TARGET_STORAGE_KEY = "dashboard-search-target";
export const SEARCH_TARGET_MAX_AGE_MS = 30_000;

function isStorageAvailable(): boolean {
  return typeof window !== "undefined" && !!window.sessionStorage;
}

export function setSearchTarget(t: SearchTarget): void {
  if (!isStorageAvailable()) return;
  try {
    window.sessionStorage.setItem(SEARCH_TARGET_STORAGE_KEY, JSON.stringify(t));
  } catch {
    // QuotaExceededError / Safari private mode — 무시
  }
}

export function readSearchTarget(now: number = Date.now()): SearchTarget | null {
  if (!isStorageAvailable()) return null;
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(SEARCH_TARGET_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearSearchTarget();
    return null;
  }
  const t = parsed as Partial<SearchTarget> | null;
  if (!t || typeof t !== "object") return null;
  if (t.kind !== "ticket" && t.kind !== "etr") return null;
  if (typeof t.key !== "string" || t.key.length === 0) return null;
  if (typeof t.query !== "string") return null;
  if (typeof t.createdAt !== "number" || !Number.isFinite(t.createdAt)) return null;
  if (now - t.createdAt > SEARCH_TARGET_MAX_AGE_MS) {
    clearSearchTarget();
    return null;
  }
  return {
    kind: t.kind,
    key: t.key,
    query: t.query,
    focus: !!t.focus,
    createdAt: t.createdAt,
  };
}

export function clearSearchTarget(): void {
  if (!isStorageAvailable()) return;
  try {
    window.sessionStorage.removeItem(SEARCH_TARGET_STORAGE_KEY);
  } catch {
    // 무시
  }
}
