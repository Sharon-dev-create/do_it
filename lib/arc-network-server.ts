import "server-only";

import { isAddress } from "viem";
import { getGatewayChainConfig } from "@/lib/gateway-network";
import {
  assertArcNetworkPair,
  assertGatewayNetwork,
  getArcRpcOverride,
  getArcNetworkConfig,
  parseArcNetworkName,
  ARC_TESTNET_ESCROW_ADDRESS,
  ARC_TESTNET_VERIFIER_ADDRESS,
  requireMainnetDeploymentAddress,
} from "@/lib/arc-network";

const network = parseArcNetworkName(process.env.ARC_NETWORK);
const publicNetwork = parseArcNetworkName(process.env.NEXT_PUBLIC_ARC_NETWORK);

assertArcNetworkPair(network, publicNetwork);

export const SERVER_ARC_NETWORK_CONFIG = getArcNetworkConfig(
  network,
  getArcRpcOverride(
    network,
    network === "testnet"
      ? process.env.ARC_TESTNET_RPC_URL
      : process.env.ARC_MAINNET_RPC_URL,
    network === "testnet" ? "ARC_TESTNET_RPC_URL" : "ARC_MAINNET_RPC_URL",
  ),
);

export function assertGatewayAvailable() {
  assertGatewayNetwork(SERVER_ARC_NETWORK_CONFIG.name);
  getGatewayChainConfig(SERVER_ARC_NETWORK_CONFIG.name);
}

export function getConfiguredVerifierAddress(): `0x${string}` {
  const address = SERVER_ARC_NETWORK_CONFIG.name === "mainnet"
    ? requireMainnetDeploymentAddress(
        process.env.ARC_MAINNET_VERIFIER_ADDRESS,
        ARC_TESTNET_VERIFIER_ADDRESS,
        "verifier",
      )
    : process.env.ARC_TESTNET_VERIFIER_ADDRESS ?? ARC_TESTNET_VERIFIER_ADDRESS;
  if (!address || !isAddress(address)) {
    throw new Error(
      `${SERVER_ARC_NETWORK_CONFIG.label} verifier address is missing or invalid.`,
    );
  }
  const publicVerifierAddress = SERVER_ARC_NETWORK_CONFIG.name === "mainnet"
    ? process.env.NEXT_PUBLIC_ARC_MAINNET_VERIFIER_ADDRESS
    : process.env.NEXT_PUBLIC_ARC_TESTNET_VERIFIER_ADDRESS ??
      "0x41aa5227695B8c6c5FfAD3bF3A9aAF0626921d0E";
  if (!publicVerifierAddress || !isAddress(publicVerifierAddress) ||
      publicVerifierAddress.toLowerCase() !== address.toLowerCase()) {
    throw new Error(
      `${SERVER_ARC_NETWORK_CONFIG.label} server and public verifier addresses must match.`,
    );
  }

  if (SERVER_ARC_NETWORK_CONFIG.name === "mainnet") {
    const serverEscrowAddress = requireMainnetDeploymentAddress(
      process.env.ARC_MAINNET_ESCROW_ADDRESS,
      ARC_TESTNET_ESCROW_ADDRESS,
      "escrow",
    );
    const publicEscrowAddress = requireMainnetDeploymentAddress(
      process.env.NEXT_PUBLIC_ARC_MAINNET_ESCROW_ADDRESS,
      ARC_TESTNET_ESCROW_ADDRESS,
      "escrow",
    );
    if (serverEscrowAddress.toLowerCase() !== publicEscrowAddress.toLowerCase()) {
      throw new Error(
        "ARC_MAINNET_ESCROW_ADDRESS must match NEXT_PUBLIC_ARC_MAINNET_ESCROW_ADDRESS.",
      );
    }
    if (!process.env.ARC_MAINNET_DEPLOYMENT_BLOCK ||
        !/^\d+$/.test(process.env.ARC_MAINNET_DEPLOYMENT_BLOCK)) {
      throw new Error(
        "ARC_MAINNET_DEPLOYMENT_BLOCK must be set to the verified escrow deployment block.",
      );
    }
    const serverCodeHash = process.env.ARC_MAINNET_ESCROW_CODE_HASH;
    const publicCodeHash = process.env.NEXT_PUBLIC_ARC_MAINNET_ESCROW_CODE_HASH;
    if (!serverCodeHash || !/^0x[0-9a-fA-F]{64}$/.test(serverCodeHash) ||
        serverCodeHash.toLowerCase() !== publicCodeHash?.toLowerCase()) {
      throw new Error(
        "ARC_MAINNET_ESCROW_CODE_HASH must be valid and match NEXT_PUBLIC_ARC_MAINNET_ESCROW_CODE_HASH.",
      );
    }
    if (address.toLowerCase() !== process.env.NEXT_PUBLIC_ARC_MAINNET_VERIFIER_ADDRESS?.toLowerCase()) {
      throw new Error(
        "ARC_MAINNET_VERIFIER_ADDRESS must match NEXT_PUBLIC_ARC_MAINNET_VERIFIER_ADDRESS.",
      );
    }
  }

  return address;
}
