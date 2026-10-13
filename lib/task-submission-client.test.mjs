import assert from "node:assert/strict";
import test from "node:test";
import { getTaskSubmissionNotice, postTaskAnswer } from "./task-submission-client.ts";

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
  assert.equal(captured.init.credentials, "same-origin");
  assert.deepEqual(JSON.parse(captured.init.body), {
    worker_address: "0x1111111111111111111111111111111111111111",
    answer: "the answer",
  });
  assert.equal("worker_signature" in JSON.parse(captured.init.body), false);
});

test("a normal incorrect-answer API response is visible instead of silently resetting", () => {
  const response = { correct: false, message: "Incorrect answer" };
  assert.equal(getTaskSubmissionNotice(response), "Incorrect answer");
});

test("V2 claim rejection and API errors remain visible in the UI", () => {
  assert.equal(getTaskSubmissionNotice({ correct: true, error: "User rejected the request." }), "User rejected the request.");
  assert.equal(getTaskSubmissionNotice({ error: "Submission authorization expired." }), "Submission authorization expired.");
});
