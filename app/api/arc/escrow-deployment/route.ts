import { connection, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import {
  createArcPreflightErrorResponse,
  logArcPreflightFailure,
  type ArcPreflightStage,
} from "@/lib/arc-preflight-diagnostics";

export async function GET() {
  let stage: ArcPreflightStage = "request";
  try {
    await connection();
    stage = "network_config";
    const { getArcNetworkConfig } = await import("@/lib/arc-network");
    const { validateArcTestnetEscrowDeployment } = await import("@/lib/arc-deployment-validation");
    stage = "rpc_url";
    const config = getArcNetworkConfig("testnet", process.env.ARC_TESTNET_RPC_URL);
    const client = createPublicClient({
      chain: {
        id: config.chainId,
        name: config.label,
        nativeCurrency: { name: "USDC", symbol: "USDC", decimals: config.nativeCurrencyDecimals },
        rpcUrls: { default: { http: [config.rpcUrl] } },
      },
      transport: http(config.rpcUrl),
    });
    stage = "network_config";
    await validateArcTestnetEscrowDeployment(client, {
      network: process.env.ARC_NETWORK,
      publicNetwork: process.env.NEXT_PUBLIC_ARC_NETWORK,
      rpcUrl: process.env.ARC_TESTNET_RPC_URL,
    });
    stage = "network_config";
    const { assertArcEscrowDeployment } = await import("@/lib/escrow-v2-server");
    // Keep the existing verifier, USDC address, and decimals checks as part
    // of the preflight before allowing a creator to submit transactions.
    await assertArcEscrowDeployment((nextStage) => { stage = nextStage; });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logArcPreflightFailure(error, stage);
    return createArcPreflightErrorResponse();
  }
}
