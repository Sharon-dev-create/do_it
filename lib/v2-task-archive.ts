import "server-only";
import { decodeEventLog, isAddress, isHash, parseUnits, type TransactionReceipt } from "viem";
import { ARC_CHAIN_ID, escrowPublicClient } from "@/lib/escrow-v2-server";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";

type V2TaskForArchive = {
  blockchain_task_id: number | string | null;
  created_by: string;
  reward_usdc: number | string;
  create_tx_hash: string | null;
  fund_tx_hash: string | null;
};
type V2PaymentForArchive = {
  status: string;
  payment_mechanism: string;
  tx_hash: string | null;
  worker_address: string;
} | null;

const REFUND_SCAN_CHUNK = 25_000n;

function receiptHasTaskEvent(
  receipt: TransactionReceipt,
  eventName: "TaskCreated" | "TaskFunded",
  taskId: bigint,
  creator: string,
  expectedAmount: bigint,
) {
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase()) return false;
    try {
      const parsed = decodeEventLog({ abi: DO_IT_ESCROW_ABI, data: log.data, topics: log.topics });
      if (parsed.eventName !== eventName) return false;
      const args = parsed.args as Record<string, unknown>;
      return args.taskId === taskId &&
        typeof args.creator === "string" && args.creator.toLowerCase() === creator.toLowerCase() &&
        (args.reward ?? args.amount) === expectedAmount;
    } catch { return false; }
  });
}

function receiptHasRewardCredit(receipt: TransactionReceipt, taskId: bigint, worker: string, amount: bigint) {
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase()) return false;
    try {
      const parsed = decodeEventLog({ abi: DO_IT_ESCROW_ABI, data: log.data, topics: log.topics, eventName: "RewardCredited" });
      return parsed.args.taskId === taskId && parsed.args.worker.toLowerCase() === worker.toLowerCase() && parsed.args.amount === amount;
    } catch { return false; }
  });
}

async function verifyRefundEvent(
  event: { args: { taskId?: bigint; creator?: `0x${string}`; amount?: bigint }; transactionHash: `0x${string}`; logIndex: number | null },
  taskId: bigint,
  creator: string,
  amount: bigint,
) {
  if (event.args.taskId !== taskId || event.args.creator?.toLowerCase() !== creator.toLowerCase() || event.args.amount !== amount) return false;
  const receipt = await escrowPublicClient.getTransactionReceipt({ hash: event.transactionHash });
  if (receipt.status !== "success" || receipt.to?.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase() ||
      receipt.transactionHash.toLowerCase() !== event.transactionHash.toLowerCase()) return false;
  return receipt.logs.some((log) => {
    if (log.logIndex !== event.logIndex || log.address.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase()) return false;
    try {
      const parsed = decodeEventLog({ abi: DO_IT_ESCROW_ABI, data: log.data, topics: log.topics, eventName: "TaskRefunded" });
      return parsed.args.taskId === taskId && parsed.args.creator.toLowerCase() === creator.toLowerCase() && parsed.args.amount === amount;
    } catch { return false; }
  });
}

/** Return only terminal contract states whose allocation and settlement evidence is verifiable on Arc. */
export async function getVerifiedV2TerminalStatus(task: V2TaskForArchive, payment: V2PaymentForArchive): Promise<3 | 4 | null> {
  try {
    if ((await escrowPublicClient.getChainId()) !== ARC_CHAIN_ID || task.blockchain_task_id === null ||
        !task.create_tx_hash || !isHash(task.create_tx_hash) || !task.fund_tx_hash || !isHash(task.fund_tx_hash) ||
        !isAddress(task.created_by, { strict: false })) return null;
    const chainTaskId = BigInt(task.blockchain_task_id);
    if (chainTaskId < 0n) return null;
    const creator = task.created_by;
    const expectedReward = parseUnits(String(task.reward_usdc), 6);

    const [createReceipt, fundReceipt] = await Promise.all([
      escrowPublicClient.getTransactionReceipt({ hash: task.create_tx_hash as `0x${string}` }),
      escrowPublicClient.getTransactionReceipt({ hash: task.fund_tx_hash as `0x${string}` }),
    ]);
    if (createReceipt.status !== "success" || createReceipt.to?.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase() ||
        !receiptHasTaskEvent(createReceipt, "TaskCreated", chainTaskId, creator, expectedReward) ||
        fundReceipt.status !== "success" || fundReceipt.to?.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase() ||
        !receiptHasTaskEvent(fundReceipt, "TaskFunded", chainTaskId, creator, expectedReward)) return null;

    const state = await escrowPublicClient.readContract({
      address: DO_IT_ESCROW_ADDRESS, abi: DO_IT_ESCROW_ABI, functionName: "tasks", args: [chainTaskId],
    });
    if (state[0].toLowerCase() !== creator.toLowerCase() || state[2] !== expectedReward) return null;

    if (state[3] === 3) {
      if (!payment || payment.status !== "confirmed" || payment.payment_mechanism !== "v2_reward_credit" ||
          !payment.tx_hash || !isHash(payment.tx_hash) || !isAddress(payment.worker_address, { strict: false }) ||
          state[1].toLowerCase() !== payment.worker_address.toLowerCase()) return null;
      const receipt = await escrowPublicClient.getTransactionReceipt({ hash: payment.tx_hash as `0x${string}` });
      if (receipt.status !== "success" || receipt.to?.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase() ||
          receipt.transactionHash.toLowerCase() !== payment.tx_hash.toLowerCase() ||
          !receiptHasRewardCredit(receipt, chainTaskId, payment.worker_address, expectedReward)) return null;
      return 3;
    }

    if (state[3] === 4) {
      let toBlock = await escrowPublicClient.getBlockNumber();
      const firstBlock = createReceipt.blockNumber;
      while (toBlock >= firstBlock) {
        const fromBlock = toBlock - firstBlock + 1n > REFUND_SCAN_CHUNK ? toBlock - REFUND_SCAN_CHUNK + 1n : firstBlock;
        const events = await escrowPublicClient.getContractEvents({
          address: DO_IT_ESCROW_ADDRESS,
          abi: DO_IT_ESCROW_ABI,
          eventName: "TaskRefunded",
          args: { taskId: chainTaskId, creator: creator as `0x${string}` },
          fromBlock,
          toBlock,
        });
        for (const event of events) {
          if (await verifyRefundEvent(event, chainTaskId, creator, expectedReward)) return 4;
        }
        if (fromBlock === firstBlock) break;
        toBlock = fromBlock - 1n;
      }
    }
    return null;
  } catch {
    return null;
  }
}
