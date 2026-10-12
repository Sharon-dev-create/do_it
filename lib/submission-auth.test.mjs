import assert from "node:assert/strict";
import test from "node:test";
import { getTaskCreatorSubmissionError } from "./submission-auth.ts";

const creator = "0x4686a159487a97F8b2747485eF0653568aa6d521";
const otherWorker = "0x0000000000000000000000000000000000000001";

test("rejects the creator wallet regardless of address casing", () => {
  assert.equal(getTaskCreatorSubmissionError(creator.toUpperCase().replace("0X", "0x"), creator), "creator");
});

test("allows a different worker wallet", () => {
  assert.equal(getTaskCreatorSubmissionError(creator, otherWorker), null);
});

test("fails closed for missing or malformed creator addresses", () => {
  assert.equal(getTaskCreatorSubmissionError(null, otherWorker), "invalid_creator");
  assert.equal(getTaskCreatorSubmissionError("not-an-address", otherWorker), "invalid_creator");
});
