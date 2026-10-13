import { isAddress } from "viem";

export function isSameWallet(address: string, otherAddress: string) {
  return address.toLowerCase() === otherAddress.toLowerCase();
}

export function getTaskCreatorSubmissionError(creator: unknown, worker: string) {
  if (typeof creator !== "string" || !isAddress(creator, { strict: false })) return "invalid_creator" as const;
  return isSameWallet(creator, worker) ? "creator" as const : null;
}
