"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

export type DashboardFilter = {
  domain: string | null;
  status: string | null;
  showHidden: boolean;
  month: string | null;      // YYYY-MM
  assignee: string | null;
  roadmapId: string | null;
  health: "Healthy" | "At Risk" | "Blocked" | null;
  search: string;
  /** deep-link: 선택된 티켓 키 */
  ticket: string | null;
};

const DEFAULT_FILTER: DashboardFilter = {
  domain: null,
  status: null,
  showHidden: false,
  month: null,
  assignee: null,
  roadmapId: null,
  health: null,
  search: "",
  ticket: null,
};

/** query param 이름 ↔ filter key 매핑 (값이 URL에 표시될 필드만) */
const QUERY_KEYS: Partial<Record<keyof DashboardFilter, string>> = {
  domain:    "domain",
  status:    "status",
  month:     "month",
  assignee:  "assignee",
  roadmapId: "roadmap",
  health:    "health",
  search:    "q",
  ticket:    "ticket",
  showHidden: "hidden",
};

function readFromParams(params: URLSearchParams): DashboardFilter {
  return {
    domain:    params.get("domain")   || null,
    status:    params.get("status")   || null,
    month:     params.get("month")    || null,
    assignee:  params.get("assignee") || null,
    roadmapId: params.get("roadmap")  || null,
    health:    (params.get("health") as DashboardFilter["health"]) || null,
    search:    params.get("q")        ?? "",
    ticket:    params.get("ticket")   || null,
    showHidden: params.get("hidden") === "1",
  };
}

function buildParams(
  filter: DashboardFilter,
  existing: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(existing.toString());

  for (const [fk, qk] of Object.entries(QUERY_KEYS) as [keyof DashboardFilter, string][]) {
    const val = filter[fk];
    if (val === null || val === undefined || val === "" || val === false) {
      next.delete(qk);
    } else if (val === true) {
      next.set(qk, "1");
    } else {
      next.set(qk, String(val));
    }
  }
  return next;
}

export function useDashboardFilter(overrides?: Partial<DashboardFilter>) {
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();

  // URL から現在のフィルタを読み取る（overrides はデフォルト値として使用）
  const filter = useMemo<DashboardFilter>(() => {
    const fromUrl = readFromParams(searchParams);
    // overrides は "まだ URL に何もないとき" のデフォルトとして機能
    const hasAny = [...searchParams.keys()].some((k) =>
      Object.values(QUERY_KEYS).includes(k)
    );
    if (!hasAny && overrides) {
      return { ...DEFAULT_FILTER, ...overrides };
    }
    return fromUrl;
  }, [searchParams, overrides]);

  const set = useCallback(
    <K extends keyof DashboardFilter>(key: K, value: DashboardFilter[K]) => {
      const next = buildParams({ ...filter, [key]: value }, searchParams);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [filter, searchParams, router, pathname]
  );

  const reset = useCallback(() => {
    const base = overrides ? { ...DEFAULT_FILTER, ...overrides } : DEFAULT_FILTER;
    const next = buildParams(base, new URLSearchParams());
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [overrides, router, pathname]);

  const isFiltered = useMemo(
    () =>
      filter.domain !== null ||
      filter.status !== null ||
      filter.showHidden ||
      filter.month !== null ||
      filter.assignee !== null ||
      filter.roadmapId !== null ||
      filter.health !== null ||
      filter.search !== "" ||
      filter.ticket !== null,
    [filter]
  );

  return { filter, set, reset, isFiltered };
}
