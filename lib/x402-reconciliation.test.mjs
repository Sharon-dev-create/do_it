import assert from "node:assert/strict";
import test from "node:test";

const {
  assessX402TransferEvidence,
  hasUniqueCompleteX402Candidate,
  lookupX402Transfers,
} =
  await import("./x402-reconciliation.ts");

const expected = {
  network: "eip155:5042002",
  payer: "0x1111111111111111111111111111111111111111",
  recipient: "0x2222222222222222222222222222222222222222",
  amountBaseUnits: "10000",
};

const candidate = {
  id: "provider-transfer-id",
  status: "received",
  token: "USDC",
  sendingNetwork: expected.network,
  recipientNetwork: expected.network,
  fromAddress: expected.payer,
  toAddress: expected.recipient,
  amount: "0.01",
};

test("transfer evidence reports a candidate but never treats it as definitive proof", () => {
  assert.deepEqual(assessX402TransferEvidence(candidate, expected), {
    mismatches: [],
    unavailable: [],
    candidate: true,
  });
});

test("mismatched network, asset, payer, recipient, and amount are surfaced", () => {
  const result = assessX402TransferEvidence({
    ...candidate,
    token: "EURC",
    sendingNetwork: "eip155:1",
    recipientNetwork: "eip155:1",
    fromAddress: "0x3333333333333333333333333333333333333333",
    toAddress: "0x4444444444444444444444444444444444444444",
    amount: "0.02",
  }, expected);
  assert.deepEqual(result.mismatches.sort(), [
    "amount",
    "fromAddress",
    "recipientNetwork",
    "sendingNetwork",
    "toAddress",
    "token",
  ]);
  assert.equal(result.candidate, false);
});

test("missing provider fields remain unresolved rather than treated as a match", () => {
  const result = assessX402TransferEvidence(
    { id: "provider-transfer-id" },
    expected,
  );
  assert.ok(result.unavailable.length > 0);
  assert.equal(result.candidate, false);
});

test("candidate classification requires one complete, fully matched lookup result", () => {
  const matched = assessX402TransferEvidence(candidate, expected);
  const unavailable = assessX402TransferEvidence({ id: "other" }, expected);
  const mismatch = assessX402TransferEvidence({
    ...candidate,
    amount: "0.02",
  }, expected);

  assert.equal(hasUniqueCompleteX402Candidate([matched], true), true);
  assert.equal(hasUniqueCompleteX402Candidate([matched], false), false);
  assert.equal(hasUniqueCompleteX402Candidate([matched, unavailable], true), false);
  assert.equal(hasUniqueCompleteX402Candidate([matched, mismatch], true), false);
});

test("provider lookup returning no record is a completed query, not proof of rejection", async () => {
  const params = [];
  const result = await lookupX402Transfers({
    getTransferById: async () => {
      throw new Error("not expected");
    },
    searchTransfers: async (query) => {
      params.push(query);
      return { transfers: [] };
    },
  }, {
    network: expected.network,
    nonce: `0x${"ab".repeat(32)}`,
    payer: expected.payer,
    recipient: expected.recipient,
  });
  assert.deepEqual(result, { transfers: [], complete: true });
  assert.equal(params[0].nonce, `0x${"ab".repeat(32)}`);
  assert.equal(params[0].network, expected.network);
});

test("transfer search pagination is bounded and reports incomplete evidence", async () => {
  let calls = 0;
  const result = await lookupX402Transfers({
    getTransferById: async () => candidate,
    searchTransfers: async () => {
      calls += 1;
      return { transfers: [], pagination: { pageAfter: `page-${calls}` } };
    },
  }, {
    network: expected.network,
    nonce: `0x${"ab".repeat(32)}`,
    payer: expected.payer,
    recipient: expected.recipient,
  }, 2);
  assert.equal(calls, 2);
  assert.equal(result.complete, false);
});
