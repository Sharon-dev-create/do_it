import { createHmac, timingSafeEqual } from "node:crypto";
import { isAddress } from "viem";

export const WORKER_SESSION_COOKIE = "doit_worker_session";
export const WORKER_SESSION_TTL_SECONDS = 8 * 60 * 60;

export function getWorkerSessionChallengeMessage(workerAddress: string, nonce: string, expiresAt: string) {
  return [
    "Do-It worker submission session authorization",
    `Wallet: ${workerAddress.toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Expires at: ${expiresAt}`,
    "This signature establishes a short-lived session for submitting task answers from this wallet.",
  ].join("\n");
}

function sessionMac(payload: string, secret: string) {
  return createHmac("sha256", secret).update("doit-worker-session-v1:").update(payload).digest("base64url");
}

export function createWorkerSessionToken(workerAddress: string, expiresAt: number, secret: string) {
  if (!isAddress(workerAddress, { strict: false }) || !secret) throw new Error("Worker session configuration is invalid");
  const payload = Buffer.from(JSON.stringify({ wallet: workerAddress.toLowerCase(), exp: expiresAt })).toString("base64url");
  return `${payload}.${sessionMac(payload, secret)}`;
}

export function getWorkerAddressFromSessionToken(token: string | undefined, secret: string | undefined, now = Date.now()): string | null {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  const expected = Buffer.from(sessionMac(parts[0], secret));
  const supplied = Buffer.from(parts[1]);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { wallet?: unknown; exp?: unknown };
    if (typeof payload.wallet !== "string" || !isAddress(payload.wallet, { strict: false }) ||
        typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp) || payload.exp * 1000 <= now) return null;
    return payload.wallet.toLowerCase();
  } catch {
    return null;
  }
}

export function getMatchingWorkerSessionAddress(
  token: string | undefined,
  secret: string | undefined,
  requestedWallet: string,
  now = Date.now(),
) {
  if (!isAddress(requestedWallet, { strict: false })) return null;
  const sessionWallet = getWorkerAddressFromSessionToken(token, secret, now);
  return sessionWallet && sessionWallet === requestedWallet.toLowerCase() ? sessionWallet : null;
}

export function isCurrentWorkerAuthChallenge(
  challenge: { worker_address: string; expires_at: string; consumed_at: string | null } | null,
  workerAddress: string,
  expiresAt: string,
  now = Date.now(),
) {
  if (!challenge || challenge.consumed_at || !isAddress(challenge.worker_address, { strict: false }) ||
      challenge.worker_address.toLowerCase() !== workerAddress.toLowerCase() || challenge.expires_at !== expiresAt) return false;
  const expiry = Date.parse(challenge.expires_at);
  return Number.isFinite(expiry) && expiry > now;
}
