import { decodeEventLog, isAddress, isHash, type Abi, type TransactionReceipt } from "viem";

type ArchiveReceipt = Pick<TransactionReceipt, "status" | "transactionHash" | "blockNumber" | "to" | "logs">;
type RefundEvent = {
  args: { taskId?: bigint; creator?: `0x${string}`; amount?: bigint };
  transactionHash: `0x${string}`;
  blockNumber: bigint;
  logIndex: number | null;
};

function decodedEventArgs(args: unknown): Record<string, unknown> | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  return args as Record<string, unknown>;
}

function isSuccessfulEscrowReceipt(receipt: ArchiveReceipt, expectedHash: string, escrowAddress: string) {
  return isAddress(escrowAddress, { strict: false }) && isHash(expectedHash) &&
    receipt.status === "success" && receipt.blockNumber >= 0n &&
    receipt.to?.toLowerCase() === escrowAddress.toLowerCase() &&
    receipt.transactionHash.toLowerCase() === expectedHash.toLowerCase();
}

export function verifyEscrowTaskReceipt(
  receipt: ArchiveReceipt,
  expectedHash: string,
  eventName: "TaskCreated" | "TaskFunded",
  taskId: bigint,
  creator: string,
  amount: bigint,
  abi: Abi,
  escrowAddress: string,
) {
  if (!isSuccessfulEscrowReceipt(receipt, expectedHash, escrowAddress)) return false;
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== escrowAddress.toLowerCase()) return false;
    try {
      const parsed = decodeEventLog({ abi: abi, data: log.data, topics: log.topics });
      if (parsed.eventName !== eventName || log.blockNumber !== receipt.blockNumber) return false;
      const args = decodedEventArgs(parsed.args);
      return args?.taskId === taskId && typeof args.creator === "string" &&
        args.creator.toLowerCase() === creator.toLowerCase() &&
        (args.reward ?? args.amount) === amount;
    } catch { return false; }
  });
}

export function verifyEscrowRewardReceipt(
  receipt: ArchiveReceipt,
  expectedHash: string,
  taskId: bigint,
  worker: string,
  amount: bigint,
  abi: Abi,
  escrowAddress: string,
) {
  if (!isSuccessfulEscrowReceipt(receipt, expectedHash, escrowAddress)) return false;
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== escrowAddress.toLowerCase()) return false;
    try {
      const parsed = decodeEventLog({ abi: abi, data: log.data, topics: log.topics });
      if (parsed.eventName !== "RewardCredited" || log.blockNumber !== receipt.blockNumber) return false;
      const args = decodedEventArgs(parsed.args);
      return args?.taskId === taskId && typeof args.worker === "string" &&
        args.worker.toLowerCase() === worker.toLowerCase() && args.amount === amount;
    } catch { return false; }
  });
}

export function verifyEscrowRefundReceipt(
  receipt: ArchiveReceipt,
  event: RefundEvent,
  taskId: bigint,
  creator: string,
  amount: bigint,
  abi: Abi,
  escrowAddress: string,
) {
  if (event.args.taskId !== taskId || event.args.creator?.toLowerCase() !== creator.toLowerCase() ||
      event.args.amount !== amount || event.blockNumber !== receipt.blockNumber ||
      !isSuccessfulEscrowReceipt(receipt, event.transactionHash, escrowAddress)) return false;
  return receipt.logs.some((log) => {
    if (log.logIndex !== event.logIndex || log.blockNumber !== receipt.blockNumber ||
        log.address.toLowerCase() !== escrowAddress.toLowerCase()) return false;
    try {
      const parsed = decodeEventLog({ abi: abi, data: log.data, topics: log.topics });
      if (parsed.eventName !== "TaskRefunded") return false;
      const args = decodedEventArgs(parsed.args);
      return args?.taskId === taskId && typeof args.creator === "string" &&
        args.creator.toLowerCase() === creator.toLowerCase() && args.amount === amount;
    } catch { return false; }
  });
}
