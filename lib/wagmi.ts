import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain, http } from "viem";
import { ARC_NETWORK_CONFIG } from "@/lib/arc-network";

export const arcChain = defineChain({
  id: ARC_NETWORK_CONFIG.chainId,
  name: ARC_NETWORK_CONFIG.label,
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: ARC_NETWORK_CONFIG.nativeCurrencyDecimals,
  },
  rpcUrls: {
    default: {
      http: [ARC_NETWORK_CONFIG.rpcUrl],
    },
  },
});

export const config = getDefaultConfig({
  appName: "Do-It",
  chains: [arcChain],
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  ssr: true,
  transports: {
    [arcChain.id]: http(ARC_NETWORK_CONFIG.rpcUrl),
  },
});