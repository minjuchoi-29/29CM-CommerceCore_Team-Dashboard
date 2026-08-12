import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverEtrLinkedTicketKeys,
  mergeLinkedTicketRegistry,
} from "../lib/linked-ticket-discovery";

test("ETR에서 연결된 실행 티켓을 한 단계 발견", () => {
  const result = discoverEtrLinkedTicketKeys([
    { key: "ETR-100", jiraLinks: [{ key: "TM-200" }, { key: "ETR-101" }] },
  ], new Set(["ETR-100"]));

  assert.deepEqual(result.keys, ["TM-200"]);
  assert.deepEqual(result.linkedFromByKey["TM-200"], ["ETR-100"]);
  assert.equal(result.linkedFromByKey["ETR-101"], undefined);
});

test("실행 티켓에서 연결된 ETR도 역방향으로 발견", () => {
  const result = discoverEtrLinkedTicketKeys([
    { key: "TM-200", jiraLinks: [{ key: "ETR-100" }, { key: "TM-201" }] },
  ], new Set(["TM-200"]));

  assert.deepEqual(result.keys, ["ETR-100"]);
  assert.equal(result.linkedFromByKey["TM-201"], undefined);
});

test("이미 관리 중인 티켓은 재조회하지 않아도 연결 출처는 기록", () => {
  const result = discoverEtrLinkedTicketKeys([
    { key: "ETR-100", jiraLinks: [{ key: "TM-200" }] },
  ], new Set(["ETR-100", "TM-200"]));

  assert.deepEqual(result.keys, []);
  assert.deepEqual(result.linkedFromByKey["TM-200"], ["ETR-100"]);
});

test("기존 연결 출처와 최초 발견 시각을 보존해 병합", () => {
  const merged = mergeLinkedTicketRegistry({
    "TM-200": {
      key: "TM-200",
      linkedFrom: ["ETR-100"],
      addedAt: "2026-08-01T00:00:00.000Z",
      lastSeenAt: "2026-08-01T00:00:00.000Z",
      reason: "etr-link",
    },
  }, { "TM-200": ["ETR-101"] }, "2026-08-12T00:00:00.000Z");

  assert.deepEqual(merged["TM-200"].linkedFrom, ["ETR-100", "ETR-101"]);
  assert.equal(merged["TM-200"].addedAt, "2026-08-01T00:00:00.000Z");
  assert.equal(merged["TM-200"].lastSeenAt, "2026-08-12T00:00:00.000Z");
});
