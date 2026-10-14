import "server-only";
import { isAddress, isHash, parseUnits } from "viem";
import { ARC_CHAIN_ID, escrowPublicClient } from "@/lib/escrow-v2-server";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";
import { scanRefundLogRanges } from "@/lib/v2-refund-log-scan";
import { verifyEscrowRefundReceipt, verifyEscrowRewardReceipt, verifyEscrowTaskReceipt } from "@/lib/v2-archive-receipt-verification";

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
    if (!verifyEscrowTaskReceipt(createReceipt, task.create_tx_hash, "TaskCreated", chainTaskId, creator, expectedReward, DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS) ||
        !verifyEscrowTaskReceipt(fundReceipt, task.fund_tx_hash, "TaskFunded", chainTaskId, creator, expectedReward, DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS)) return null;

    const state = await escrowPublicClient.readContract({
      address: DO_IT_ESCROW_ADDRESS, abi: DO_IT_ESCROW_ABI, functionName: "tasks", args: [chainTaskId],
    });
    if (state[0].toLowerCase() !== creator.toLowerCase() || state[2] !== expectedReward) return null;

    if (state[3] === 3) {
      if (!payment || payment.status !== "confirmed" || payment.payment_mechanism !== "v2_reward_credit" ||
          !payment.tx_hash || !isHash(payment.tx_hash) || !isAddress(payment.worker_address, { strict: false }) ||
          state[1].toLowerCase() !== payment.worker_address.toLowerCase()) return null;
      const receipt = await escrowPublicClient.getTransactionReceipt({ hash: payment.tx_hash as `0x${string}` });
      return verifyEscrowRewardReceipt(receipt, payment.tx_hash, chainTaskId, payment.worker_address, expectedReward, DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS) ? 3 : null;
    }

    if (state[3] === 4) {
      const lastBlock = await escrowPublicClient.getBlockNumber();
      const foundRefund = await scanRefundLogRanges(
        createReceipt.blockNumber,
        lastBlock,
        (fromBlock, toBlock) => escrowPublicClient.getContractEvents({
          address: DO_IT_ESCROW_ADDRESS,
          abi: DO_IT_ESCROW_ABI,
          eventName: "TaskRefunded",
          args: { taskId: chainTaskId, creator: creator as `0x${string}` },
          fromBlock,
          toBlock,
        }),
        async (event) => {
          const receipt = await escrowPublicClient.getTransactionReceipt({ hash: event.transactionHash });
          return verifyEscrowRefundReceipt(receipt, event, chainTaskId, creator, expectedReward, DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS);
        },
      );
      return foundRefund ? 4 : null;
    }
    return null;
  } catch {
    return null;
  }
}
