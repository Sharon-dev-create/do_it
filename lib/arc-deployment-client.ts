"use client";

import { erc20Abi, isAddress, type PublicClient } from "viem";
import { ARC_CHAIN_ID, ARC_NETWORK_CONFIG, assertRuntimeCodeHash } from "@/lib/arc-network";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";

const TESTNET_VERIFIER = "0x41aa5227695B8c6c5FfAD3bF3A9aAF0626921d0E";

export async function assertClientArcEscrowDeployment(
  publicClient: PublicClient,
) {
  if (await publicClient.getChainId() !== ARC_CHAIN_ID) {
    throw new Error(`Wallet RPC is not connected to ${ARC_NETWORK_CONFIG.label}.`);
  }
  const bytecode = await publicClient.getCode({ address: DO_IT_ESCROW_ADDRESS });
  if (!bytecode || bytecode === "0x") {
    throw new Error(`No escrow contract is deployed at the configured ${ARC_NETWORK_CONFIG.label} address.`);
  }
  if (ARC_NETWORK_CONFIG.name === "mainnet") {
    assertRuntimeCodeHash(bytecode, process.env.NEXT_PUBLIC_ARC_MAINNET_ESCROW_CODE_HASH);
  }

  const expectedVerifier = ARC_NETWORK_CONFIG.name === "mainnet"
    ? process.env.NEXT_PUBLIC_ARC_MAINNET_VERIFIER_ADDRESS
    : process.env.NEXT_PUBLIC_ARC_TESTNET_VERIFIER_ADDRESS || TESTNET_VERIFIER;
  if (!expectedVerifier || !isAddress(expectedVerifier)) {
    throw new Error(`The ${ARC_NETWORK_CONFIG.label} verifier address is not configured.`);
  }
  const [tokenAddress, verifierAddress, tokenDecimals] = await Promise.all([
    publicClient.readContract({
      address: DO_IT_ESCROW_ADDRESS,
      abi: DO_IT_ESCROW_ABI,
      functionName: "usdc",
    }),
    publicClient.readContract({
      address: DO_IT_ESCROW_ADDRESS,
      abi: DO_IT_ESCROW_ABI,
      functionName: "verifier",
    }),
    publicClient.readContract({
      address: ARC_NETWORK_CONFIG.usdcAddress,
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);
  if (tokenAddress.toLowerCase() !== ARC_NETWORK_CONFIG.usdcAddress.toLowerCase() ||
      verifierAddress.toLowerCase() !== expectedVerifier.toLowerCase() ||
      tokenDecimals !== ARC_NETWORK_CONFIG.usdcDecimals) {
    throw new Error(`The configured ${ARC_NETWORK_CONFIG.label} escrow, verifier, or USDC contract does not match the verified configuration.`);
  }
}
