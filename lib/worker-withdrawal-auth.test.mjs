import assert from "node:assert/strict";
import test from "node:test";
import { parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  getWorkerWithdrawalChallengeMessage,
  getWorkerWithdrawalEventKey,
  filterWorkerWithdrawalRows,
  isMatchingWorkerWithdrawalSender,
  isValidWorkerWithdrawalDeployment,
  isWorkerWithdrawalChallengeCurrent,
  isConfirmedWorkerWithdrawal,
  isConfirmedWorkerWithdrawalReceipt,
  meetsWorkerWithdrawalMinimum,
  parseWorkerWithdrawalPageCursor,
  parseWorkerWithdrawalScanCursor,
  verifyWorkerWithdrawalChallenge,
} from "./worker-withdrawal-auth.ts";

const workerA = privateKeyToAccount(`0x${"11".repeat(32)}`);
const workerB = privateKeyToAccount(`0x${"22".repeat(32)}`);
const nonce = "ab".repeat(32);
const expiresAt = "2026-10-13T12:00:00.000Z";

test("a signed challenge authorizes only the signing worker wallet", async () => {
  const message = getWorkerWithdrawalChallengeMessage(workerA.address, nonce, expiresAt);
  const signature = await workerA.signMessage({ message });
  assert.equal(await verifyWorkerWithdrawalChallenge(workerA.address, nonce, expiresAt, signature), true);
  assert.equal(await verifyWorkerWithdrawalChallenge(workerB.address, nonce, expiresAt, signature), false);
  assert.equal(await verifyWorkerWithdrawalChallenge(workerA.address, `${nonce.slice(0, -2)}cd`, expiresAt, signature), false);
});

test("invalid, expired, replayed, or wallet-mismatched challenges are rejected", () => {
  const current = { worker_address: workerA.address.toLowerCase(), expires_at: expiresAt, consumed_at: null };
  const now = Date.parse("2026-10-13T11:59:00.000Z");
  assert.equal(isWorkerWithdrawalChallengeCurrent(current, workerA.address, expiresAt, now), true);
  assert.equal(isWorkerWithdrawalChallengeCurrent(null, workerA.address, expiresAt, now), false);
  assert.equal(isWorkerWithdrawalChallengeCurrent({ ...current, consumed_at: expiresAt }, workerA.address, expiresAt, now), false);
  assert.equal(isWorkerWithdrawalChallengeCurrent(current, workerB.address, expiresAt, now), false);
  assert.equal(isWorkerWithdrawalChallengeCurrent(current, workerA.address, expiresAt, Date.parse(expiresAt)), false);
  assert.equal(isWorkerWithdrawalChallengeCurrent(current, workerA.address, "invalid", now), false);
});

test("history pagination rejects malformed cursors before authorization is consumed", () => {
  assert.deepEqual(parseWorkerWithdrawalPageCursor({ blockNumber: "123", logIndex: 0 }), { blockNumber: "123", logIndex: 0 });
  assert.equal(parseWorkerWithdrawalPageCursor({ blockNumber: "1;drop", logIndex: 0 }), undefined);
  assert.equal(parseWorkerWithdrawalPageCursor({ blockNumber: "1", logIndex: -1 }), undefined);
  assert.equal(parseWorkerWithdrawalPageCursor([]), undefined);
  assert.equal(parseWorkerWithdrawalScanCursor("123"), 123n);
  assert.equal(parseWorkerWithdrawalScanCursor("1e3"), undefined);
});

test("withdrawal indexing validates deployment, chain, and transaction sender", () => {
  assert.equal(isValidWorkerWithdrawalDeployment("0x024539183A57428C63B2F2628b881105213332E4", 5042002, 5042002), true);
  assert.equal(isValidWorkerWithdrawalDeployment("not-an-address", 5042002, 5042002), false);
  assert.equal(isValidWorkerWithdrawalDeployment(workerA.address, 1, 5042002), false);
  assert.equal(isMatchingWorkerWithdrawalSender(workerA.address, workerA.address.toLowerCase()), true);
  assert.equal(isMatchingWorkerWithdrawalSender(workerA.address, workerB.address), false);
});

test("recording responses include only the verified transaction sender's rows", () => {
  const rows = [{ worker_address: workerA.address }, { worker_address: workerB.address }];
  assert.deepEqual(filterWorkerWithdrawalRows(rows, workerA.address.toLowerCase()), [rows[0]]);
});

test("the minimum uses integer USDC base units and includes exactly $1.00", () => {
  assert.equal(meetsWorkerWithdrawalMinimum(parseUnits("0.999999", 6)), false);
  assert.equal(meetsWorkerWithdrawalMinimum(parseUnits("1.000000", 6)), true);
  assert.equal(meetsWorkerWithdrawalMinimum(parseUnits("1.000001", 6)), true);
  assert.equal(meetsWorkerWithdrawalMinimum(undefined), false);
});

test("the same chain event always has the same duplicate key", () => {
  const event = { chainId: 5042002, contractAddress: "0xAbCd", transactionHash: "0x1234", logIndex: 7 };
  assert.equal(getWorkerWithdrawalEventKey(event), getWorkerWithdrawalEventKey({ ...event, contractAddress: "0xabcd", transactionHash: "0X1234" }));
  assert.notEqual(getWorkerWithdrawalEventKey(event), getWorkerWithdrawalEventKey({ ...event, logIndex: 8 }));
});

test("only confirmed events qualify for the confirmed history", () => {
  assert.equal(isConfirmedWorkerWithdrawal("confirmed"), true);
  assert.equal(isConfirmedWorkerWithdrawal("submitted"), false);
  assert.equal(isConfirmedWorkerWithdrawal("failed"), false);
  assert.equal(isConfirmedWorkerWithdrawalReceipt("success", true), true);
  assert.equal(isConfirmedWorkerWithdrawalReceipt("pending", true), false);
  assert.equal(isConfirmedWorkerWithdrawalReceipt("reverted", true), false);
  assert.equal(isConfirmedWorkerWithdrawalReceipt("success", false), false);
});
