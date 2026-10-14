import {
  ARC_NETWORK_CONFIG,
  ARC_TESTNET_ESCROW_ADDRESS,
  requireMainnetDeploymentAddress,
} from "@/lib/arc-network";
export { DO_IT_ESCROW_ABI } from "./doItEscrowAbi";

function getEscrowAddress(): `0x${string}` {
  if (ARC_NETWORK_CONFIG.name === "testnet") return ARC_TESTNET_ESCROW_ADDRESS;

  return requireMainnetDeploymentAddress(
    process.env.NEXT_PUBLIC_ARC_MAINNET_ESCROW_ADDRESS,
    ARC_TESTNET_ESCROW_ADDRESS,
    "escrow",
  );
}

export const DO_IT_ESCROW_ADDRESS = getEscrowAddress();
