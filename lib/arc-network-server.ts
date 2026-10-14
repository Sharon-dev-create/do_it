import "server-only";

import { isAddress } from "viem";
import {
  assertArcNetworkPair,
  getArcNetworkConfig,
  parseArcNetworkName,
} from "@/lib/arc-network";
import { DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";

const network = parseArcNetworkName(process.env.ARC_NETWORK);
const publicNetwork = parseArcNetworkName(process.env.NEXT_PUBLIC_ARC_NETWORK);

assertArcNetworkPair(network, publicNetwork);

export const SERVER_ARC_NETWORK_CONFIG = getArcNetworkConfig(
  network,
  network === "testnet"
    ? process.env.ARC_TESTNET_RPC_URL
    : process.env.ARC_MAINNET_RPC_URL,
);

export function assertGatewayAvailable() {
  if (!SERVER_ARC_NETWORK_CONFIG.gatewayChain) {
    throw new Error(
      "Circle Gateway on Arc Mainnet is unavailable in the installed SDK; this operation is disabled.",
    );
  }
}

export function getConfiguredVerifierAddress(): `0x${string}` {
  const address =
    SERVER_ARC_NETWORK_CONFIG.name === "mainnet"
      ? process.env.ARC_MAINNET_VERIFIER_ADDRESS
      : process.env.ARC_TESTNET_VERIFIER_ADDRESS ??
        "0x41aa5227695B8c6c5FfAD3bF3A9aAF0626921d0E";
  if (!address || !isAddress(address)) {
    throw new Error(
      `${SERVER_ARC_NETWORK_CONFIG.label} verifier address is missing or invalid.`,
    );
  }
  return address;
}

if (SERVER_ARC_NETWORK_CONFIG.name === "mainnet") {
  const serverAddress = process.env.ARC_MAINNET_ESCROW_ADDRESS;
  if (!serverAddress || !isAddress(serverAddress) ||
      serverAddress.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase()) {
    throw new Error(
      "ARC_MAINNET_ESCROW_ADDRESS must be valid and match NEXT_PUBLIC_ARC_MAINNET_ESCROW_ADDRESS.",
    );
  }
  if (!process.env.ARC_MAINNET_DEPLOYMENT_BLOCK ||
      !/^\d+$/.test(process.env.ARC_MAINNET_DEPLOYMENT_BLOCK)) {
    throw new Error(
      "ARC_MAINNET_DEPLOYMENT_BLOCK must be set to the verified escrow deployment block.",
    );
  }
}
