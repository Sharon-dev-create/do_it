import "server-only";
import { decodeEventLog, isAddress, isHash, parseUnits } from "viem";
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

const V2_DEPLOYMENT_BLOCK = 66340107n;

/** Return only terminal contract states whose settlement event is verifiable on Arc. */
export async function getVerifiedV2TerminalStatus(task: V2TaskForArchive, payment: V2PaymentForArchive): Promise<3 | 4 | null> {
  try {
    if ((await escrowPublicClient.getChainId()) !== ARC_CHAIN_ID || task.blockchain_task_id === null ||
        !task.create_tx_hash || !task.fund_tx_hash || !isAddress(task.created_by, { strict: false })) return null;
    const chainTaskId = BigInt(task.blockchain_task_id);
    const expectedReward = parseUnits(String(task.reward_usdc), 6);
    const state = await escrowPublicClient.readContract({
      address: DO_IT_ESCROW_ADDRESS, abi: DO_IT_ESCROW_ABI, functionName: "tasks", args: [chainTaskId],
    });
    if (state[0].toLowerCase() !== task.created_by.toLowerCase() || state[2] !== expectedReward) return null;

    if (state[3] === 3) {
      if (!payment || payment.status !== "confirmed" || payment.payment_mechanism !== "v2_reward_credit" ||
          !payment.tx_hash || !isHash(payment.tx_hash) || !isAddress(payment.worker_address, { strict: false }) ||
          state[1].toLowerCase() !== payment.worker_address.toLowerCase()) return null;
      const receipt = await escrowPublicClient.getTransactionReceipt({ hash: payment.tx_hash as `0x${string}` });
      if (receipt.status !== "success" || receipt.to?.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase()) return null;
      const credited = receipt.logs.some((log) => {
        if (log.address.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase()) return false;
        try {
          const event = decodeEventLog({ abi: DO_IT_ESCROW_ABI, data: log.data, topics: log.topics, eventName: "RewardCredited" });
          return event.args.taskId === chainTaskId && event.args.worker.toLowerCase() === payment.worker_address.toLowerCase() && event.args.amount === expectedReward;
        } catch { return false; }
      });
      return credited ? 3 : null;
    }

    if (state[3] === 4) {
      const events = await escrowPublicClient.getContractEvents({
        address: DO_IT_ESCROW_ADDRESS,
        abi: DO_IT_ESCROW_ABI,
        eventName: "TaskRefunded",
        args: { taskId: chainTaskId, creator: task.created_by as `0x${string}` },
        fromBlock: V2_DEPLOYMENT_BLOCK,
      });
      return events.some((event) => event.args.taskId === chainTaskId &&
        event.args.creator.toLowerCase() === task.created_by.toLowerCase() && event.args.amount === expectedReward) ? 4 : null;
    }
    return null;
  } catch {
    return null;
  }
}
