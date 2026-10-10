import "server-only";
import { createPublicClient, createWalletClient, http, isAddress, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";

export const ARC_CHAIN_ID = 5042002;
export const ARC_EXPLORER = "https://testnet.arcscan.app";
export const V2_VERIFIER = "0x41aa5227695B8c6c5FfAD3bF3A9aAF0626921d0E" as const;

const arcTestnet = {
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network"] } },
} as const;

export const escrowPublicClient = createPublicClient({ chain: arcTestnet, transport: http() });

export function getVerifierWalletClient() {
  const key = process.env.DOIT_VERIFIER_PRIVATE_KEY || process.env.SELLER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("V2 verifier signer is not configured");
  const account = privateKeyToAccount(key as `0x${string}`);
  if (account.address.toLowerCase() !== V2_VERIFIER.toLowerCase()) {
    throw new Error("Configured V2 verifier signer does not match the deployed verifier");
  }
  return createWalletClient({ account, chain: arcTestnet, transport: http() });
}

export function isConfiguredV2TestWorker(address: string): boolean {
  if (!isAddress(address)) return false;
  const configured = process.env.DOIT_V2_TEST_WORKERS;
  if (!configured) return false;
  return configured.split(",").map((entry) => entry.trim().toLowerCase()).includes(address.toLowerCase());
}

export function getV2TaskId(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return null;
  try {
    const id = BigInt(value);
    return id >= 0n ? id : null;
  } catch {
    return null;
  }
}

export async function verifyV2TaskRecord(task: {
  blockchain_task_id: number | string | null;
  created_by: string;
  reward_usdc: number | string;
}) {
  const taskId = getV2TaskId(task.blockchain_task_id);
  if (taskId === null) throw new Error("Task has no valid V2 chain ID");
  const state = await escrowPublicClient.readContract({
    address: DO_IT_ESCROW_ADDRESS,
    abi: DO_IT_ESCROW_ABI,
    functionName: "tasks",
    args: [taskId],
  });
  const [creator, worker, reward, status] = state;
  const expectedReward = parseUnits(String(task.reward_usdc), 6);
  if (creator.toLowerCase() !== task.created_by.toLowerCase() || reward !== expectedReward) {
    throw new Error("On-chain task creator or reward does not match the marketplace record");
  }
  return { taskId, creator, worker, reward, status };
}

export function asAddress(address: string): Address | null {
  return isAddress(address) ? address as Address : null;
}
