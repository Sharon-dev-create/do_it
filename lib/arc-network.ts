import { isAddress, keccak256 } from "viem";

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

export const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;
export const ARC_TESTNET_ESCROW_ADDRESS =
  "0x024539183A57428C63B2F2628b881105213332E4" as const;
export const ARC_TESTNET_VERIFIER_ADDRESS =
  "0x41aa5227695B8c6c5FfAD3bF3A9aAF0626921d0E" as const;

export function getArcRpcOverride(
  network: ArcNetworkName,
  rpcUrl: string | undefined,
  settingName: string,
): string | undefined {
  const configuredUrl = rpcUrl?.trim();
  if (network === "mainnet" && !configuredUrl) {
    throw new Error(`${settingName} must be explicitly configured for Arc Mainnet.`);
  }
  if (!configuredUrl) return undefined;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(configuredUrl);
  } catch {
    throw new Error(`${settingName} must be a valid HTTP(S) URL.`);
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error(`${settingName} must be a valid HTTP(S) URL.`);
  }
  return configuredUrl;
}

export function assertNotTestnetDeploymentAddress(
  network: ArcNetworkName,
  address: string,
  testnetAddress: string,
  description: string,
) {
  if (network === "mainnet" && address.toLowerCase() === testnetAddress.toLowerCase()) {
    throw new Error(`The Arc Testnet ${description} address cannot be used on Mainnet.`);
  }
}

export function requireMainnetDeploymentAddress(
  address: string | undefined,
  testnetAddress: string,
  description: string,
): `0x${string}` {
  if (!address || !isAddress(address)) {
    throw new Error(`Arc Mainnet ${description} address is missing or invalid.`);
  }
  assertNotTestnetDeploymentAddress("mainnet", address, testnetAddress, description);
  return address;
}

export function assertArcChainId(network: ArcNetworkName, actualChainId: number) {
  const expectedChainId = getArcNetworkConfig(network).chainId;
  if (actualChainId !== expectedChainId) {
    throw new Error(
      `RPC chain ID ${actualChainId} does not match the selected Arc network ${expectedChainId}.`,
    );
  }
}

export function getArcVerifierPrivateKey(
  network: ArcNetworkName,
  mainnetKey: string | undefined,
  testnetKey: string | undefined,
  testnetSellerKey: string | undefined,
): `0x${string}` {
  const key = network === "mainnet" ? mainnetKey : testnetKey || testnetSellerKey;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`The ${network} V2 verifier signer is not configured.`);
  }
  return key as `0x${string}`;
}

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
    rpcUrl: rpcOverride || "https://rpc.testnet.arc.io",
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
      "Circle Gateway on Arc Mainnet is disabled because the installed @circle-fin/x402-batching 2.0.4 SDK does not expose Circle's documented `arc` configuration.",
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

export function assertRuntimeCodeHash(bytecode: `0x${string}`, expectedHash: string | undefined) {
  if (!expectedHash || !/^0x[0-9a-fA-F]{64}$/.test(expectedHash) ||
      keccak256(bytecode).toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error("Escrow runtime bytecode does not match the configured audited code hash.");
  }
}

export function getArcTransactionUrl(network: ArcNetworkName, txHash: string) {
  return `${getArcNetworkConfig(network).explorerUrl}/tx/${txHash}`;
}

const publicNetwork = parseArcNetworkName(process.env.NEXT_PUBLIC_ARC_NETWORK);
export const ARC_NETWORK_CONFIG = getArcNetworkConfig(
  publicNetwork,
  getArcRpcOverride(
    publicNetwork,
    publicNetwork === "testnet"
      ? process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL
      : process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL,
    publicNetwork === "testnet"
      ? "NEXT_PUBLIC_ARC_TESTNET_RPC_URL"
      : "NEXT_PUBLIC_ARC_MAINNET_RPC_URL",
  ),
);
export const ARC_CHAIN_ID = ARC_NETWORK_CONFIG.chainId;
export const ARC_EXPLORER_URL = ARC_NETWORK_CONFIG.explorerUrl;
