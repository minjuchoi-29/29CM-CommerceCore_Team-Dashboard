import assert from "node:assert/strict";
import test from "node:test";
import { fetchFilterIssueKeys } from "../lib/filter-sync";

test("Jira search/jql의 nextPageToken을 따라 전체 티켓을 조회", async () => {
  const originalFetch = globalThis.fetch;
  const requestedTokens: Array<string | null> = [];

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const token = url.searchParams.get("nextPageToken");
    requestedTokens.push(token);
    assert.equal(url.searchParams.get("maxResults"), "100");
    assert.equal(url.searchParams.get("fields"), "key");

    if (!token) {
      return Response.json({
        issues: [{ key: "TM-1" }, { key: "TM-2" }],
        nextPageToken: "page-2",
        isLast: false,
      });
    }
    assert.equal(token, "page-2");
    return Response.json({
      issues: [{ key: "TM-3" }],
      isLast: true,
    });
  };

  try {
    assert.deepEqual(await fetchFilterIssueKeys("27769", "project = TM"), ["TM-1", "TM-2", "TM-3"]);
    assert.deepEqual(requestedTokens, [null, "page-2"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Jira가 같은 pagination token을 반복하면 무한 조회를 차단", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    issues: [{ key: "TM-1" }],
    nextPageToken: "same-token",
    isLast: false,
  });

  try {
    await assert.rejects(
      () => fetchFilterIssueKeys("27769"),
      /pagination token이 반복/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
