import assert from "node:assert/strict";
import test from "node:test";

const { assessX402TransferEvidence } = await import("./x402-reconciliation.ts");

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
