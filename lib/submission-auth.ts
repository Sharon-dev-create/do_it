import { keccak256, toBytes } from "viem";

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
