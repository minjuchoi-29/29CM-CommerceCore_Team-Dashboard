import assert from "node:assert/strict";
import test from "node:test";
import type { JiraFiltersStore } from "../lib/filter-types";
import {
  buildSourceFiltersMap,
  mergeTicketKeyLists,
} from "../lib/ticket-sources";

const filters: JiraFiltersStore = {
  active: {
    id: "active",
    jiraFilterId: "1",
    name: "사용 중",
    jql: "project = TM",
    enabled: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    lastSyncAt: null,
    lastSyncCount: null,
    lastSyncError: null,
  },
  disabled: {
    id: "disabled",
    jiraFilterId: "2",
    name: "중지됨",
    jql: "project = ETR",
    enabled: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    lastSyncAt: null,
    lastSyncCount: null,
    lastSyncError: null,
  },
};

test("중지된 데이터 소스는 수동 티켓과 활성 소스의 합집합에서 제외", () => {
  const merged = mergeTicketKeyLists(
    ["TM-1"],
    { active: ["TM-1", "TM-2"], disabled: ["ETR-1"] },
    filters,
  );

  assert.deepEqual(merged.allKeys, ["TM-1", "TM-2"]);
  assert.deepEqual(merged.filterOnlyKeys, ["TM-2"]);
});

test("중지된 데이터 소스는 티켓의 현재 포함 출처에도 표시하지 않음", () => {
  assert.deepEqual(
    buildSourceFiltersMap(
      { active: ["TM-1"], disabled: ["TM-1", "ETR-1"] },
      filters,
    ),
    { "TM-1": ["사용 중"] },
  );
});
