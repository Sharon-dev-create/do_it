import { isAddress } from "viem";
import { ARC_NETWORK_CONFIG } from "@/lib/arc-network";
export { DO_IT_ESCROW_ABI } from "./doItEscrowAbi";

const TESTNET_ESCROW_ADDRESS =
  "0x024539183A57428C63B2F2628b881105213332E4" as const;

function getEscrowAddress(): `0x${string}` {
  if (ARC_NETWORK_CONFIG.name === "testnet") return TESTNET_ESCROW_ADDRESS;

  const address = process.env.NEXT_PUBLIC_ARC_MAINNET_ESCROW_ADDRESS;
  if (!address || !isAddress(address)) {
    throw new Error(
      "Arc Mainnet escrow is not configured. Deploy and review a separate mainnet escrow before enabling this application.",
    );
  }
  return address;
}

export const DO_IT_ESCROW_ADDRESS = getEscrowAddress();
