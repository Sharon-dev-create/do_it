import {
  GatewayClient,
} from "@circle-fin/x402-batching/client";

export async function payWorker(
  amount: string,
  workerAddress: `0x${string}`,
) {
  const privateKey = process.env.SELLER_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("SELLER_PRIVATE_KEY not configured");
  }

  const gateway = new GatewayClient({
    chain: "arcTestnet",
    privateKey: privateKey as `0x${string}`,
  });

  const result = await gateway.withdraw(amount, {
    chain: "arcTestnet",
    recipient: workerAddress,
  });

  return result;
}