import assert from "node:assert/strict";
import test from "node:test";
import { postTaskAnswer } from "./task-submission-client.ts";

test("task answer submission sends one API request without invoking wallet prompts", async () => {
  let requestCount = 0;
  let signMessageCalls = 0;
  let transactionCalls = 0;
  let captured;
  const fetcher = async (url, init) => {
    requestCount += 1;
    captured = { url, init };
    return new Response(JSON.stringify({ correct: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const response = await postTaskAnswer("task-123", {
    worker_address: "0x1111111111111111111111111111111111111111",
    answer: "the answer",
  }, fetcher);
  assert.equal(response.status, 200);
  assert.equal(requestCount, 1);
  assert.equal(signMessageCalls, 0);
  assert.equal(transactionCalls, 0);
  assert.equal(captured.url, "/api/tasks/task-123/submit");
  assert.equal(captured.init.method, "POST");
  assert.deepEqual(JSON.parse(captured.init.body), {
    worker_address: "0x1111111111111111111111111111111111111111",
    answer: "the answer",
  });
  assert.equal("worker_signature" in JSON.parse(captured.init.body), false);
});
