import assert from "node:assert/strict";
import test from "node:test";
import { isValidTaskId } from "./task-id.ts";

test("accepts UUID task IDs", () => {
  assert.equal(isValidTaskId("3fdd9136-c666-4686-a8e4-5e73456dc0dd"), true);
});

test("rejects malformed route values before they can be fetched", () => {
  assert.equal(isValidTaskId("%%drp:id:3fdd9136c66668%%"), false);
  assert.equal(isValidTaskId("not-a-task-id"), false);
  assert.equal(isValidTaskId(undefined), false);
});
