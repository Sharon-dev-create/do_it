type X402NetworkEnvironment = Record<string, string | undefined>;

export function assertX402TestnetSettlementAllowed(
  serverNetwork: string,
  env: X402NetworkEnvironment,
): void {
  if (
    serverNetwork !== "testnet" ||
    env.ARC_NETWORK !== "testnet" ||
    env.NEXT_PUBLIC_ARC_NETWORK !== "testnet"
  ) {
    throw new Error("x402 settlement is disabled unless the server is consistently configured for Arc Testnet.");
  }
}

export async function settleX402OnTestnet<T>(
  serverNetwork: string,
  env: X402NetworkEnvironment,
  settle: () => Promise<T>,
): Promise<T> {
  assertX402TestnetSettlementAllowed(serverNetwork, env);
  return settle();
}
