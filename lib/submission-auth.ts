import { isAddress, keccak256, toBytes } from "viem";

export function isSameWallet(address: string, otherAddress: string) {
  return address.toLowerCase() === otherAddress.toLowerCase();
}

export function getTaskCreatorSubmissionError(creator: unknown, worker: string) {
  if (typeof creator !== "string" || !isAddress(creator, { strict: false })) return "invalid_creator" as const;
  return isSameWallet(creator, worker) ? "creator" as const : null;
}

export function getTaskSubmissionMessage(taskId: string, answer: string) {
  const answerHash = keccak256(toBytes(answer));
  return [
    "Do-It task submission authorization",
    `Task: ${taskId}`,
    `Answer hash: ${answerHash}`,
    "Chain ID: 5042002",
    "This signature authorizes Do-It to verify this answer for the connected wallet.",
  ].join("\n");
}
