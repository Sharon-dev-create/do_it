import { getArcNetworkConfig, ARC_TESTNET_ESCROW_ADDRESS } from "./arc-network.ts";
import { ArcPreflightError } from "./arc-preflight-diagnostics.ts";
import type { ArcPreflightStage } from "./arc-preflight-diagnostics.ts";

type DeploymentClient = {
  getChainId(): Promise<number>;
  getCode(input: { address: `0x${string}` }): Promise<`0x${string}` | undefined>;
};

export async function validateArcTestnetEscrowDeployment(
  client: DeploymentClient,
  settings: { network: string | undefined; publicNetwork?: string | undefined; rpcUrl: string | undefined },
) {
  if (settings.network !== "testnet") {
    throw new ArcPreflightError("NETWORK_CONFIG_INVALID", "network_config", "Arc escrow task creation requires ARC_NETWORK=testnet.");
  }
  if (settings.publicNetwork !== undefined && settings.publicNetwork !== "testnet") {
    throw new ArcPreflightError("NETWORK_CONFIG_INVALID", "network_config", "NEXT_PUBLIC_ARC_NETWORK must match ARC_NETWORK=testnet.");
  }
  const rpcUrl = settings.rpcUrl?.trim();
  if (!rpcUrl) throw new ArcPreflightError("RPC_URL_MISSING", "rpc_url", "ARC_TESTNET_RPC_URL must be configured on the server.");
  let parsed: URL;
  try { parsed = new URL(rpcUrl); } catch { throw new ArcPreflightError("RPC_URL_INVALID", "rpc_url", "ARC_TESTNET_RPC_URL must be a valid HTTP(S) URL."); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ArcPreflightError("RPC_URL_INVALID", "rpc_url", "ARC_TESTNET_RPC_URL must be a valid HTTP(S) URL.");
  }

  const expectedChainId = getArcNetworkConfig("testnet").chainId;
  if (expectedChainId !== 5042002) {
    throw new ArcPreflightError("NETWORK_CONFIG_INVALID", "network_config", "Arc Testnet chain configuration is inconsistent.");
  }
  let actualChainId: number;
  try { actualChainId = await client.getChainId(); }
  catch { throw new ArcPreflightError("RPC_UNAVAILABLE", "rpc_chain_id", "Arc Testnet RPC chain ID request failed."); }
  if (actualChainId !== expectedChainId) {
    throw new ArcPreflightError("RPC_WRONG_CHAIN", "rpc_chain_id", `RPC chain ID ${actualChainId} does not match Arc Testnet (${expectedChainId}).`);
  }
  let bytecode: `0x${string}` | undefined;
  try { bytecode = await client.getCode({ address: ARC_TESTNET_ESCROW_ADDRESS }); }
  catch { throw new ArcPreflightError("RPC_UNAVAILABLE", "escrow_code_read", "Arc Testnet escrow bytecode request failed."); }
  if (!bytecode || bytecode === "0x") {
    throw new ArcPreflightError("ESCROW_CODE_MISSING", "escrow_code_check", "No escrow contract is deployed at the configured Arc Testnet address.");
  }
}

export async function assertServerArcEscrowDeployment(
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher("/api/arc/escrow-deployment", { method: "GET", cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok || payload.error) {
    throw new Error(payload.error || "Arc Testnet escrow deployment could not be verified.");
  }
}
