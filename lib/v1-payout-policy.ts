import type { ArcNetworkName } from "./arc-network.ts";

export function isV1GatewayPayoutAllowed(network: ArcNetworkName): boolean {
  return network === "testnet";
}

export function getV1GatewayPayoutUnavailableMessage(
  network: ArcNetworkName,
): string | null {
  return isV1GatewayPayoutAllowed(network)
    ? null
    : "V1 Gateway task payouts are disabled on Arc Mainnet until each task has a creator-funded or explicitly reserved payout budget.";
}
