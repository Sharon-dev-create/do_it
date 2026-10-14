import {
  CHAIN_CONFIGS,
  type SupportedChainName,
} from "@circle-fin/x402-batching/client";
import { isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ARC_USDC_ADDRESS,
  type ArcNetworkName,
} from "./arc-network.ts";

const GATEWAY_API_URLS: Record<ArcNetworkName, string> = {
  testnet: "https://gateway-api-testnet.circle.com/v1",
  mainnet: "https://gateway-api.circle.com/v1",
};
const GATEWAY_CONTRACTS = {
  testnet: {
    wallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    minter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
  },
  mainnet: {
    wallet: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE",
    minter: "0x2222222d7164433c4C09B0b0D809a9b52C04C205",
  },
} as const;

export function getGatewayChainName(network: ArcNetworkName): SupportedChainName {
  return network === "mainnet" ? "arc" : "arcTestnet";
}

export function getGatewayChainConfig(network: ArcNetworkName) {
  const config = CHAIN_CONFIGS[getGatewayChainName(network)];
  const expectedChainId = network === "mainnet" ? 5042 : 5042002;
  if (
    config.chain.id !== expectedChainId ||
    config.domain !== 26 ||
    config.usdc.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase() ||
    config.gatewayWallet.toLowerCase() !==
      GATEWAY_CONTRACTS[network].wallet.toLowerCase() ||
    config.gatewayMinter.toLowerCase() !==
      GATEWAY_CONTRACTS[network].minter.toLowerCase()
  ) {
    throw new Error(
      `Circle Gateway ${network} configuration does not match the verified Arc chain, domain, and USDC token.`,
    );
  }
  return config;
}

export function getGatewayApiUrl(network: ArcNetworkName, path: string): string {
  return `${GATEWAY_API_URLS[network]}${path.startsWith("/") ? path : `/${path}`}`;
}

export function getGatewayFacilitatorUrl(network: ArcNetworkName): string {
  return GATEWAY_API_URLS[network].replace(/\/v1$/, "");
}

type GatewayEnvironment = Record<string, string | undefined>;

export function getGatewaySellerAddress(
  network: ArcNetworkName,
  env: GatewayEnvironment = process.env,
): `0x${string}` {
  const variable = network === "mainnet" ? "SELLER_MAINNET_ADDRESS" : "SELLER_ADDRESS";
  const address = env[variable];
  if (!address || !isAddress(address)) {
    throw new Error(`${variable} must be configured as a valid address.`);
  }
  return address;
}

export function getGatewaySellerCredentials(
  network: ArcNetworkName,
  env: GatewayEnvironment = process.env,
): { address: `0x${string}`; privateKey: `0x${string}` } {
  const address = getGatewaySellerAddress(network, env);
  const keyVariable =
    network === "mainnet" ? "SELLER_MAINNET_PRIVATE_KEY" : "SELLER_PRIVATE_KEY";
  const privateKey = env[keyVariable];
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error(`${keyVariable} must be configured with a valid private key.`);
  }
  const derivedAddress = privateKeyToAccount(privateKey as `0x${string}`).address;
  if (derivedAddress.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`${keyVariable} does not match the configured seller address.`);
  }
  return { address, privateKey: privateKey as `0x${string}` };
}

export interface CircleSupportedKind {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
}

export function getSupportedGatewayExtra(
  kinds: readonly CircleSupportedKind[],
  config: ReturnType<typeof getGatewayChainConfig>,
): Record<string, unknown> {
  const network = `eip155:${config.chain.id}`;
  const kind = kinds.find(
    (candidate) =>
      candidate.x402Version === 2 &&
      candidate.scheme === "exact" &&
      candidate.network === network,
  );
  const extra = kind?.extra;
  const assets = extra?.assets;
  const usdcAsset = Array.isArray(assets)
    ? assets.find(
        (asset): asset is Record<string, unknown> =>
          typeof asset === "object" &&
          asset !== null &&
          "symbol" in asset &&
          asset.symbol === "USDC",
      )
    : undefined;
  if (
    !extra ||
    extra.name !== "GatewayWalletBatched" ||
    extra.version !== "1" ||
    typeof extra.verifyingContract !== "string" ||
    extra.verifyingContract.toLowerCase() !== config.gatewayWallet.toLowerCase() ||
    typeof usdcAsset?.address !== "string" ||
    usdcAsset.address.toLowerCase() !== config.usdc.toLowerCase() ||
    usdcAsset.decimals !== 6
  ) {
    throw new Error(
      `Circle Gateway does not advertise the required x402 USDC payment kind for ${network}.`,
    );
  }
  return extra;
}

export function gatewayRequirementsMatch(
  accepted: Record<string, unknown> | undefined,
  expected: {
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: Record<string, unknown>;
  },
): boolean {
  const extra = accepted?.extra;
  if (!accepted || !extra || typeof extra !== "object") return false;
  const acceptedExtra = extra as Record<string, unknown>;
  const acceptedPayTo = accepted.payTo;
  const acceptedAsset = accepted.asset;
  return (
    accepted.scheme === expected.scheme &&
    accepted.network === expected.network &&
    typeof acceptedAsset === "string" &&
    acceptedAsset.toLowerCase() === expected.asset.toLowerCase() &&
    accepted.amount === expected.amount &&
    typeof acceptedPayTo === "string" &&
    acceptedPayTo.toLowerCase() === expected.payTo.toLowerCase() &&
    accepted.maxTimeoutSeconds === expected.maxTimeoutSeconds &&
    acceptedExtra.name === expected.extra.name &&
    acceptedExtra.version === expected.extra.version &&
    typeof acceptedExtra.verifyingContract === "string" &&
    acceptedExtra.verifyingContract.toLowerCase() ===
      String(expected.extra.verifyingContract).toLowerCase()
  );
}

const ARC_SYSTEM_EMITTER =
  "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE".toLowerCase();
const TRANSFER_EVENT_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function hasArcMainnetMintLog(
  logs: readonly { address: string; topics: readonly string[]; data: string }[],
  recipient: string,
  amountUsdc: bigint,
): boolean {
  if (!isAddress(recipient) || amountUsdc <= 0n) return false;
  const expectedFromTopic = `0x${"0".repeat(64)}`;
  const expectedToTopic = `0x${recipient.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  const expectedValue = amountUsdc * 10n ** 12n;

  return logs.some((log) => {
    if (
      log.address.toLowerCase() !== ARC_SYSTEM_EMITTER ||
      log.topics[0]?.toLowerCase() !== TRANSFER_EVENT_TOPIC ||
      log.topics[1]?.toLowerCase() !== expectedFromTopic ||
      log.topics[2]?.toLowerCase() !== expectedToTopic
    ) {
      return false;
    }
    try {
      return BigInt(log.data) === expectedValue;
    } catch {
      return false;
    }
  });
}
