import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { ARC_TESTNET_ESCROW_ADDRESS, getArcNetworkConfig } from "@/lib/arc-network";
import { validateArcTestnetEscrowDeployment } from "@/lib/arc-deployment-validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
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
    await validateArcTestnetEscrowDeployment(client, {
      network: process.env.ARC_NETWORK,
      publicNetwork: process.env.NEXT_PUBLIC_ARC_NETWORK,
      rpcUrl: process.env.ARC_TESTNET_RPC_URL,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Arc Testnet escrow deployment validation failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json(
      { error: "Arc Testnet escrow is unavailable or misconfigured. Check the server deployment configuration." },
      { status: 503 },
    );
  }
}
