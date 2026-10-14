"use client";

import { useAccount } from "wagmi";

const ARC_TESTNET_CHAIN_ID = 5042002;

export function WalletNetworkStatus() {
  const { isConnected, chainId } = useAccount();
  const onArcTestnet = isConnected && chainId === ARC_TESTNET_CHAIN_ID;
  const label = !isConnected
    ? "Wallet disconnected"
    : onArcTestnet
      ? "Arc Testnet connected"
      : "Switch to Arc Testnet";

  return (
    <span
      className={`network-online${!onArcTestnet ? " network-not-ready" : ""}`}
      role="status"
    >
      <i aria-hidden="true" />
      {label}
    </span>
  );
}
