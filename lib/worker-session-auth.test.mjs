import assert from "node:assert/strict";
import test from "node:test";
import { verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createWorkerSessionToken,
  getWorkerAddressFromSessionToken,
  getMatchingWorkerSessionAddress,
  getWorkerSessionChallengeMessage,
  isCurrentWorkerAuthChallenge,
} from "./worker-session-auth.ts";

const worker = privateKeyToAccount(`0x${"33".repeat(32)}`);
const secret = "test-only-session-secret";
const expiresAt = "2026-10-13T12:00:00.000Z";

test("signed wallet challenge is scoped, expires, and cannot be replayed", () => {
  const current = { worker_address: worker.address.toLowerCase(), expires_at: expiresAt, consumed_at: null };
  const beforeExpiry = Date.parse("2026-10-13T11:59:00.000Z");
  assert.equal(isCurrentWorkerAuthChallenge(current, worker.address, expiresAt, beforeExpiry), true);
  assert.equal(isCurrentWorkerAuthChallenge(null, worker.address, expiresAt, beforeExpiry), false);
  assert.equal(isCurrentWorkerAuthChallenge({ ...current, consumed_at: expiresAt }, worker.address, expiresAt, beforeExpiry), false);
  assert.equal(isCurrentWorkerAuthChallenge(current, worker.address, expiresAt, Date.parse(expiresAt)), false);
  assert.equal(isCurrentWorkerAuthChallenge(current, `0x${"44".repeat(20)}`, expiresAt, beforeExpiry), false);
  assert.match(getWorkerSessionChallengeMessage(worker.address, "nonce", expiresAt), /short-lived session/);
});

test("only the wallet that signed the session challenge verifies", async () => {
  const nonce = "ab".repeat(32);
  const message = getWorkerSessionChallengeMessage(worker.address, nonce, expiresAt);
  const signature = await worker.signMessage({ message });
  assert.equal(await verifyMessage({ address: worker.address, message, signature }), true);
  assert.equal(await verifyMessage({ address: `0x${"44".repeat(20)}`, message, signature }), false);
});

test("session tokens authorize only the wallet and expire or fail closed when changed", () => {
  const now = 1_800_000_000_000;
  const token = createWorkerSessionToken(worker.address, Math.floor(now / 1000) + 60, secret);
  assert.equal(getWorkerAddressFromSessionToken(token, secret, now), worker.address.toLowerCase());
  assert.equal(getMatchingWorkerSessionAddress(token, secret, worker.address, now), worker.address.toLowerCase());
  assert.equal(getMatchingWorkerSessionAddress(token, secret, `0x${"44".repeat(20)}`, now), null);
  assert.equal(getWorkerAddressFromSessionToken(token, "wrong-secret", now), null);
  assert.equal(getWorkerAddressFromSessionToken(`${token.slice(0, -1)}x`, secret, now), null);
  assert.equal(getWorkerAddressFromSessionToken(token, secret, now + 61_000), null);
  assert.equal(getWorkerAddressFromSessionToken(undefined, secret, now), null);
});
