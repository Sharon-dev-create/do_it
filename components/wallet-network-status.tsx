"use client";

import { useAccount } from "wagmi";
import { ARC_NETWORK_CONFIG } from "@/lib/arc-network";

export function WalletNetworkStatus() {
  const { isConnected, chainId } = useAccount();
  const onSelectedArcNetwork = isConnected && chainId === ARC_NETWORK_CONFIG.chainId;
  const label = !isConnected
    ? "Wallet disconnected"
    : onSelectedArcNetwork
      ? `${ARC_NETWORK_CONFIG.label} connected`
      : `Switch to ${ARC_NETWORK_CONFIG.label}`;

  return (
    <span
      className={`network-online${!onSelectedArcNetwork ? " network-not-ready" : ""}`}
      role="status"
    >
      <i aria-hidden="true" />
      {label}
    </span>
  );
}
