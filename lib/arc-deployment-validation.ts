import { getArcNetworkConfig, ARC_TESTNET_ESCROW_ADDRESS } from "./arc-network.ts";

type DeploymentClient = {
  getChainId(): Promise<number>;
  getCode(input: { address: `0x${string}` }): Promise<`0x${string}` | undefined>;
};

export async function validateArcTestnetEscrowDeployment(
  client: DeploymentClient,
  settings: { network: string | undefined; publicNetwork?: string | undefined; rpcUrl: string | undefined },
) {
  if (settings.network !== "testnet") {
    throw new Error("Arc escrow task creation requires ARC_NETWORK=testnet.");
  }
  if (settings.publicNetwork !== undefined && settings.publicNetwork !== "testnet") {
    throw new Error("NEXT_PUBLIC_ARC_NETWORK must match ARC_NETWORK=testnet.");
  }
  const rpcUrl = settings.rpcUrl?.trim();
  if (!rpcUrl) throw new Error("ARC_TESTNET_RPC_URL must be configured on the server.");
  let parsed: URL;
  try { parsed = new URL(rpcUrl); } catch { throw new Error("ARC_TESTNET_RPC_URL must be a valid HTTP(S) URL."); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("ARC_TESTNET_RPC_URL must be a valid HTTP(S) URL.");
  }

  const expectedChainId = getArcNetworkConfig("testnet").chainId;
  if (expectedChainId !== 5042002) throw new Error("Arc Testnet chain configuration is inconsistent.");
  const actualChainId = await client.getChainId();
  if (actualChainId !== expectedChainId) {
    throw new Error(`RPC chain ID ${actualChainId} does not match Arc Testnet (${expectedChainId}).`);
  }
  const bytecode = await client.getCode({ address: ARC_TESTNET_ESCROW_ADDRESS });
  if (!bytecode || bytecode === "0x") {
    throw new Error("No escrow contract is deployed at the configured Arc Testnet address.");
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
