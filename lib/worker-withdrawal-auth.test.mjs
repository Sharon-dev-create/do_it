import assert from "node:assert/strict";
import test from "node:test";
import { parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  getWorkerWithdrawalChallengeMessage,
  getWorkerWithdrawalEventKey,
  isConfirmedWorkerWithdrawal,
  meetsWorkerWithdrawalMinimum,
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
});
