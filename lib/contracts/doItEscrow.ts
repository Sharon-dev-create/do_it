import { isAddress, zeroAddress } from "viem";
import {
  ARC_NETWORK_CONFIG,
  ARC_TESTNET_ESCROW_ADDRESS,
} from "@/lib/arc-network";
export { DO_IT_ESCROW_ABI } from "./doItEscrowAbi";

function getEscrowAddress(): `0x${string}` {
  if (ARC_NETWORK_CONFIG.name === "testnet") return ARC_TESTNET_ESCROW_ADDRESS;

  const address = process.env.NEXT_PUBLIC_ARC_MAINNET_ESCROW_ADDRESS;
  if (
    !address ||
    !isAddress(address) ||
    address.toLowerCase() === ARC_TESTNET_ESCROW_ADDRESS.toLowerCase()
  ) {
    return zeroAddress;
  }
  return address;
}

export const DO_IT_ESCROW_ADDRESS = getEscrowAddress();
