export type ArcNetworkName = "testnet" | "mainnet";

export type ArcNetworkConfig = {
  name: ArcNetworkName;
  label: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  usdcAddress: `0x${string}`;
  usdcDecimals: 6;
  nativeCurrencyDecimals: 18;
  gatewayChain: "arcTestnet" | null;
};

const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;

export function parseArcNetworkName(value: string | undefined): ArcNetworkName {
  if (value === "testnet" || value === "mainnet") return value;
  throw new Error(
    'ARC_NETWORK and NEXT_PUBLIC_ARC_NETWORK must be explicitly set to "testnet" or "mainnet".',
  );
}

export function getArcNetworkConfig(
  name: ArcNetworkName,
  rpcOverride?: string,
): ArcNetworkConfig {
  if (name === "mainnet") {
    return {
      name,
      label: "Arc Mainnet",
      chainId: 5042,
      rpcUrl: rpcOverride || "https://rpc.mainnet.arc.io",
      explorerUrl: "https://explorer.arc.io",
      usdcAddress: ARC_USDC_ADDRESS,
      usdcDecimals: 6,
      nativeCurrencyDecimals: 18,
      gatewayChain: null,
    };
  }

  return {
    name,
    label: "Arc Testnet",
    chainId: 5042002,
    rpcUrl: rpcOverride || "https://rpc.testnet.arc.network",
    explorerUrl: "https://explorer.testnet.arc.io",
    usdcAddress: ARC_USDC_ADDRESS,
    usdcDecimals: 6,
    nativeCurrencyDecimals: 18,
    gatewayChain: "arcTestnet",
  };
}

export function assertGatewayNetwork(name: ArcNetworkName): asserts name is "testnet" {
  if (name !== "testnet") {
    throw new Error(
      "Circle Gateway on Arc Mainnet is unavailable in the installed SDK; this operation is disabled.",
    );
  }
}

export function assertArcNetworkPair(
  serverNetwork: ArcNetworkName,
  publicNetwork: ArcNetworkName,
) {
  if (serverNetwork !== publicNetwork) {
    throw new Error(
      "ARC_NETWORK must match NEXT_PUBLIC_ARC_NETWORK; refusing a mixed-network deployment.",
    );
  }
}

export function assertPaymentNetwork(
  network: ArcNetworkName,
  paymentNetwork: string,
) {
  const expected = `eip155:${getArcNetworkConfig(network).chainId}`;
  if (paymentNetwork !== expected) {
    throw new Error(
      `Payment network ${paymentNetwork} does not match the selected Arc network ${expected}.`,
    );
  }
}

export function getArcTransactionUrl(network: ArcNetworkName, txHash: string) {
  return `${getArcNetworkConfig(network).explorerUrl}/tx/${txHash}`;
}

const publicNetwork = parseArcNetworkName(process.env.NEXT_PUBLIC_ARC_NETWORK);
export const ARC_NETWORK_CONFIG = getArcNetworkConfig(
  publicNetwork,
  publicNetwork === "testnet"
    ? process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL
    : process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL,
);
export const ARC_CHAIN_ID = ARC_NETWORK_CONFIG.chainId;
export const ARC_EXPLORER_URL = ARC_NETWORK_CONFIG.explorerUrl;
