import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";

export const arcTestnet = defineChain({
    id: 5042002,
    name: "Arc Testnet",
    nativeCurrency: {
        name: "USDC",
        symbol: "USDC",
        decimals: 6,
    },
    rpcUrls: {
        default: {
            http: ["https://rpc-testnet.arc.network"],
        },
    },
});