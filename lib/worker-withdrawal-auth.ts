import { isAddress, verifyMessage } from "viem";

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

export function getWorkerWithdrawalEventKey(event: {
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  logIndex: number;
}) {
  return `${event.chainId}:${event.contractAddress.toLowerCase()}:${event.transactionHash.toLowerCase()}:${event.logIndex}`;
}
