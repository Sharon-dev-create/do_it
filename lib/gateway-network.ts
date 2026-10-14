import {
  CHAIN_CONFIGS,
  type SupportedChainName,
} from "@circle-fin/x402-batching/client";
import { isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ARC_USDC_ADDRESS,
  type ArcNetworkName,
} from "@/lib/arc-network";

const GATEWAY_API_URLS: Record<ArcNetworkName, string> = {
  testnet: "https://gateway-api-testnet.circle.com/v1",
  mainnet: "https://gateway-api.circle.com/v1",
};

export function getGatewayChainName(network: ArcNetworkName): SupportedChainName {
  return network === "mainnet" ? "arc" : "arcTestnet";
}

export function getGatewayChainConfig(network: ArcNetworkName) {
  const config = CHAIN_CONFIGS[getGatewayChainName(network)];
  const expectedChainId = network === "mainnet" ? 5042 : 5042002;
  if (
    config.chain.id !== expectedChainId ||
    config.domain !== 26 ||
    config.usdc.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase()
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
  if (
    !extra ||
    extra.name !== "GatewayWalletBatched" ||
    extra.version !== "1" ||
    typeof extra.verifyingContract !== "string" ||
    extra.verifyingContract.toLowerCase() !== config.gatewayWallet.toLowerCase()
  ) {
    throw new Error(
      `Circle Gateway does not advertise the required x402 payment kind for ${network}.`,
    );
  }
  return extra;
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
