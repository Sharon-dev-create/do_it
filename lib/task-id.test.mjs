import assert from "node:assert/strict";
import test from "node:test";
import { isValidTaskId } from "./task-id.ts";
import { fetchTaskDetails } from "./task-detail-request.ts";

test("accepts UUID task IDs", () => {
  assert.equal(isValidTaskId("3fdd9136-c666-4686-a8e4-5e73456dc0dd"), true);
});

test("rejects malformed route values before they can be fetched", () => {
  assert.equal(isValidTaskId("%%drp:id:3fdd9136c66668%%"), false);
  assert.equal(isValidTaskId("not-a-task-id"), false);
  assert.equal(isValidTaskId(undefined), false);
});

test("Next fallback route params never trigger a task API request", async () => {
  let requests = 0;
  const response = await fetchTaskDetails(
    "%%drp:id:3fdd9136c66668%%",
    "0x87E7048D1F27fc6dF2eC52a56e532d0d7F371Bbf",
    async () => {
      requests += 1;
      return new Response(null);
    },
  );

  assert.equal(response, null);
  assert.equal(requests, 0);
});
