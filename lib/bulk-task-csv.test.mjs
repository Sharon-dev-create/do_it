import test from "node:test";
import assert from "node:assert/strict";
import { parseBulkTaskCsv, BULK_TASK_MAX_ROWS, isValidRewardAmount } from "./bulk-task-csv.ts";
import { isValidBulkTask } from "./bulk-task-validation.ts";

test("CSV parser handles quoted commas, escaped quotes, and multiline descriptions", () => {
  const rows = parseBulkTaskCsv('title,description,reward_usdc,correct_answer\n"Task, one","Line one\nLine two with ""quotes""",1.000001,"yes, indeed"');
  assert.equal(rows[0].task.title, "Task, one");
  assert.equal(rows[0].task.description, 'Line one\nLine two with "quotes"');
  assert.equal(rows[0].task.correct_answer, "yes, indeed");
  assert.deepEqual(rows[0].errors, []);
});

test("CSV parser reports invalid fields and exact duplicate rows", () => {
  const rows = parseBulkTaskCsv("title,description,reward_usdc,correct_answer\nOk title,Long enough description,1.25,yes\nOk title,Long enough description,1.25,yes\nX,short,0,no");
  assert.equal(rows[1].duplicateOf, 2);
  assert.ok(rows[1].errors.some((error) => error.includes("Duplicate")));
  assert.ok(rows[2].errors.some((error) => error.includes("Title")));
  assert.ok(rows[2].errors.some((error) => error.includes("Description")));
  assert.ok(rows[2].errors.some((error) => error.includes("Reward")));
});

test("CSV parser enforces header and 250-row limit", () => {
  assert.throws(() => parseBulkTaskCsv("title,description,reward_usdc\na,b,c"), /header/);
  const content = "title,description,reward_usdc,correct_answer\n" + Array.from({ length: BULK_TASK_MAX_ROWS + 1 }, (_, i) => `Task ${i},Description long enough,1,answer`).join("\n");
  assert.throws(() => parseBulkTaskCsv(content), /at most 250/);
});

test("preview reward validation enforces NUMERIC(20,6) exactly without float rounding", () => {
  assert.equal(isValidRewardAmount("99999999999999.999999"), true);
  assert.equal(isValidRewardAmount("100000000000000"), false);
  assert.equal(isValidRewardAmount("0.000001"), true);
  assert.equal(isValidRewardAmount("0.0000001"), false);
});

test("server validator uses exact six-decimal integer token precision and rejects malformed inputs", () => {
  const row = { title: "Task title", description: "A description long enough", correct_answer: "ok" };
  assert.equal(isValidBulkTask({ ...row, reward_usdc: "0.000001" }), true);
  assert.equal(isValidBulkTask({ ...row, reward_usdc: "0.0000001" }), false);
  assert.equal(isValidBulkTask({ ...row, reward_usdc: "0" }), false);
  assert.equal(isValidBulkTask({ ...row, reward_usdc: "1e2" }), false);
  assert.equal(isValidBulkTask({ ...row, reward_usdc: "100000000000000" }), false);
});
