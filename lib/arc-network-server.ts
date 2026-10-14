import "server-only";

import { isAddress } from "viem";
import {
  assertArcNetworkPair,
  assertRuntimeCodeHash,
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

const expectedVerifierAddress = getConfiguredVerifierAddress();
const publicVerifierAddress = network === "mainnet"
  ? process.env.NEXT_PUBLIC_ARC_MAINNET_VERIFIER_ADDRESS
  : process.env.NEXT_PUBLIC_ARC_TESTNET_VERIFIER_ADDRESS ??
    "0x41aa5227695B8c6c5FfAD3bF3A9aAF0626921d0E";
if (!publicVerifierAddress || !isAddress(publicVerifierAddress) ||
    publicVerifierAddress.toLowerCase() !== expectedVerifierAddress.toLowerCase()) {
  throw new Error(
    `${SERVER_ARC_NETWORK_CONFIG.label} server and public verifier addresses must match.`,
  );
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
  const serverCodeHash = process.env.ARC_MAINNET_ESCROW_CODE_HASH;
  const publicCodeHash = process.env.NEXT_PUBLIC_ARC_MAINNET_ESCROW_CODE_HASH;
  if (!serverCodeHash || !/^0x[0-9a-fA-F]{64}$/.test(serverCodeHash) ||
      serverCodeHash.toLowerCase() !== publicCodeHash?.toLowerCase()) {
    throw new Error(
      "ARC_MAINNET_ESCROW_CODE_HASH must be valid and match NEXT_PUBLIC_ARC_MAINNET_ESCROW_CODE_HASH.",
    );
  }
  const verifierAddress = process.env.ARC_MAINNET_VERIFIER_ADDRESS;
  if (!verifierAddress || !isAddress(verifierAddress) ||
      verifierAddress.toLowerCase() !== process.env.NEXT_PUBLIC_ARC_MAINNET_VERIFIER_ADDRESS?.toLowerCase()) {
    throw new Error(
      "ARC_MAINNET_VERIFIER_ADDRESS must be valid and match NEXT_PUBLIC_ARC_MAINNET_VERIFIER_ADDRESS.",
    );
  }
}
