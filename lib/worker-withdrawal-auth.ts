import { isAddress, verifyMessage } from "viem";

export type WorkerWithdrawalPageCursor = { blockNumber: string; logIndex: number };

export function parseWorkerWithdrawalPageCursor(value: unknown): WorkerWithdrawalPageCursor | null | undefined {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const cursor = value as Record<string, unknown>;
  if (typeof cursor.blockNumber !== "string" || !/^\d{1,20}$/.test(cursor.blockNumber) ||
      typeof cursor.logIndex !== "number" || !Number.isSafeInteger(cursor.logIndex) || cursor.logIndex < 0) return undefined;
  return { blockNumber: cursor.blockNumber, logIndex: cursor.logIndex };
}

export function parseWorkerWithdrawalScanCursor(value: unknown): bigint | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^\d{1,20}$/.test(value)) return undefined;
  return BigInt(value);
}

export function isValidWorkerWithdrawalDeployment(address: string, chainId: number, expectedChainId: number) {
  return isAddress(address, { strict: false }) && chainId === expectedChainId;
}

export function isMatchingWorkerWithdrawalSender(eventWorker: string, transactionSender: string) {
  return isAddress(eventWorker, { strict: false }) && isAddress(transactionSender, { strict: false }) &&
    eventWorker.toLowerCase() === transactionSender.toLowerCase();
}

export function isWorkerWithdrawalChallengeCurrent(
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

export function filterWorkerWithdrawalRows<T extends { worker_address: string }>(rows: T[], workerAddress: string) {
  const normalizedWorker = workerAddress.toLowerCase();
  return rows.filter((row) => row.worker_address.toLowerCase() === normalizedWorker);
}

export function getWorkerWithdrawalChallengeMessage(
  workerAddress: string,
  nonce: string,
  expiresAt: string,
) {
  return [
    "Do-It V2 worker withdrawal history authorization",
    `Wallet: ${workerAddress.toLowerCase()}`,
    "Chain ID: 5042002",
    `Nonce: ${nonce}`,
    `Expires at: ${expiresAt}`,
    "This signature authorizes one read of this wallet's confirmed V2 escrow withdrawal history.",
  ].join("\n");
}

export async function verifyWorkerWithdrawalChallenge(
  workerAddress: string,
  nonce: string,
  expiresAt: string,
  signature: `0x${string}`,
) {
  if (!isAddress(workerAddress, { strict: false })) return false;
  try {
    return await verifyMessage({
      address: workerAddress as `0x${string}`,
      message: getWorkerWithdrawalChallengeMessage(workerAddress, nonce, expiresAt),
      signature,
    });
  } catch {
    return false;
  }
}

export const MINIMUM_WORKER_WITHDRAWAL_BASE_UNITS = 1_000_000n;

export function meetsWorkerWithdrawalMinimum(balanceBaseUnits: bigint | undefined) {
  return typeof balanceBaseUnits === "bigint" && balanceBaseUnits >= MINIMUM_WORKER_WITHDRAWAL_BASE_UNITS;
}

export function isConfirmedWorkerWithdrawal(status: string) {
  return status === "confirmed";
}

export function isConfirmedWorkerWithdrawalReceipt(receiptStatus: string, hasVerifiedEvent: boolean) {
  return receiptStatus === "success" && hasVerifiedEvent;
}

export function getWorkerWithdrawalEventKey(event: {
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  logIndex: number;
}) {
  return `${event.chainId}:${event.contractAddress.toLowerCase()}:${event.transactionHash.toLowerCase()}:${event.logIndex}`;
}
