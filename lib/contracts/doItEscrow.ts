import { isAddress } from "viem";
import {
  ARC_NETWORK_CONFIG,
  ARC_TESTNET_ESCROW_ADDRESS,
  assertNotTestnetDeploymentAddress,
} from "@/lib/arc-network";
export { DO_IT_ESCROW_ABI } from "./doItEscrowAbi";

function getEscrowAddress(): `0x${string}` {
  if (ARC_NETWORK_CONFIG.name === "testnet") return ARC_TESTNET_ESCROW_ADDRESS;

  const address = process.env.NEXT_PUBLIC_ARC_MAINNET_ESCROW_ADDRESS;
  if (!address || !isAddress(address)) {
    throw new Error(
      "Arc Mainnet escrow is not configured. Deploy and review a separate mainnet escrow before enabling this application.",
    );
  }
  assertNotTestnetDeploymentAddress(
    ARC_NETWORK_CONFIG.name,
    address,
    ARC_TESTNET_ESCROW_ADDRESS,
    "escrow",
  );
  return address;
}

export const DO_IT_ESCROW_ADDRESS = getEscrowAddress();
