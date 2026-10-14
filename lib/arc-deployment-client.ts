"use client";

import { erc20Abi, isAddress, type PublicClient } from "viem";
import {
  ARC_CHAIN_ID,
  ARC_NETWORK_CONFIG,
  ARC_TESTNET_VERIFIER_ADDRESS,
  assertArcChainId,
  requireMainnetDeploymentAddress,
  assertRuntimeCodeHash,
} from "@/lib/arc-network";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";

export async function assertClientArcEscrowDeployment(
  publicClient: PublicClient,
) {
  assertArcChainId(ARC_NETWORK_CONFIG.name, await publicClient.getChainId());
  const bytecode = await publicClient.getCode({ address: DO_IT_ESCROW_ADDRESS });
  if (!bytecode || bytecode === "0x") {
    throw new Error(`No escrow contract is deployed at the configured ${ARC_NETWORK_CONFIG.label} address.`);
  }
  if (ARC_NETWORK_CONFIG.name === "mainnet") {
    assertRuntimeCodeHash(bytecode, process.env.NEXT_PUBLIC_ARC_MAINNET_ESCROW_CODE_HASH);
  }

  const expectedVerifier = ARC_NETWORK_CONFIG.name === "mainnet"
    ? requireMainnetDeploymentAddress(
        process.env.NEXT_PUBLIC_ARC_MAINNET_VERIFIER_ADDRESS,
        ARC_TESTNET_VERIFIER_ADDRESS,
        "verifier",
      )
    : process.env.NEXT_PUBLIC_ARC_TESTNET_VERIFIER_ADDRESS || ARC_TESTNET_VERIFIER_ADDRESS;
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
