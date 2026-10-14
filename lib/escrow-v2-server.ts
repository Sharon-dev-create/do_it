import "server-only";
import { createPublicClient, createWalletClient, erc20Abi, http, isAddress, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";
import { isV2TestWorkerAllowed } from "@/lib/v2-test-workers";
import {
  ARC_NETWORK_CONFIG,
  assertArcChainId,
  assertRuntimeCodeHash,
  getArcVerifierPrivateKey,
} from "@/lib/arc-network";
import { getConfiguredVerifierAddress, SERVER_ARC_NETWORK_CONFIG } from "@/lib/arc-network-server";

export const ARC_CHAIN_ID = ARC_NETWORK_CONFIG.chainId;
export const ARC_EXPLORER = ARC_NETWORK_CONFIG.explorerUrl;
export const V2_VERIFIER = getConfiguredVerifierAddress();

const arcChain = {
  id: ARC_CHAIN_ID,
  name: ARC_NETWORK_CONFIG.label,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: ARC_NETWORK_CONFIG.nativeCurrencyDecimals },
  rpcUrls: { default: { http: [SERVER_ARC_NETWORK_CONFIG.rpcUrl] } },
} as const;

export const escrowPublicClient = createPublicClient({ chain: arcChain, transport: http(SERVER_ARC_NETWORK_CONFIG.rpcUrl) });

export function getVerifierWalletClient() {
  const key = getArcVerifierPrivateKey(
    ARC_NETWORK_CONFIG.name,
    process.env.DOIT_MAINNET_VERIFIER_PRIVATE_KEY,
    process.env.DOIT_VERIFIER_PRIVATE_KEY,
    process.env.SELLER_PRIVATE_KEY,
  );
  const account = privateKeyToAccount(key);
  if (account.address.toLowerCase() !== V2_VERIFIER.toLowerCase()) {
    throw new Error(`Configured ${ARC_NETWORK_CONFIG.label} verifier signer does not match the configured verifier address`);
  }
  return createWalletClient({ account, chain: arcChain, transport: http(SERVER_ARC_NETWORK_CONFIG.rpcUrl) });
}

export function isConfiguredV2Worker(address: string): boolean {
  const workerAllowlist = ARC_NETWORK_CONFIG.name === "mainnet"
    ? process.env.DOIT_MAINNET_WORKERS
    : process.env.DOIT_V2_TEST_WORKERS;
  return isV2TestWorkerAllowed(address, workerAllowlist);
}

export async function assertArcEscrowDeployment() {
  assertArcChainId(ARC_NETWORK_CONFIG.name, await escrowPublicClient.getChainId());
  const bytecode = await escrowPublicClient.getCode({ address: DO_IT_ESCROW_ADDRESS });
  if (!bytecode || bytecode === "0x") {
    throw new Error(`No escrow contract is deployed at the configured ${ARC_NETWORK_CONFIG.label} address.`);
  }
  if (ARC_NETWORK_CONFIG.name === "mainnet") {
    assertRuntimeCodeHash(bytecode, process.env.ARC_MAINNET_ESCROW_CODE_HASH);
  }
  const [tokenAddress, verifierAddress] = await Promise.all([
    escrowPublicClient.readContract({
      address: DO_IT_ESCROW_ADDRESS,
      abi: DO_IT_ESCROW_ABI,
      functionName: "usdc",
    }),
    escrowPublicClient.readContract({
      address: DO_IT_ESCROW_ADDRESS,
      abi: DO_IT_ESCROW_ABI,
      functionName: "verifier",
    }),
  ]);
  if (tokenAddress.toLowerCase() !== ARC_NETWORK_CONFIG.usdcAddress.toLowerCase()) {
    throw new Error(`Configured escrow uses an unexpected USDC address on ${ARC_NETWORK_CONFIG.label}.`);
  }
  if (verifierAddress.toLowerCase() !== V2_VERIFIER.toLowerCase()) {
    throw new Error(`Configured escrow verifier does not match the ${ARC_NETWORK_CONFIG.label} verifier address.`);
  }
  const usdcDecimals = await escrowPublicClient.readContract({
    address: ARC_NETWORK_CONFIG.usdcAddress,
    abi: erc20Abi,
    functionName: "decimals",
  });
  if (usdcDecimals !== ARC_NETWORK_CONFIG.usdcDecimals) {
    throw new Error(`USDC ERC-20 decimals do not match the ${ARC_NETWORK_CONFIG.label} configuration.`);
  }
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
  await assertArcEscrowDeployment();
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
