import { randomBytes } from "crypto";
import {
  CHAIN_CONFIGS,
  GatewayClient,
} from "@circle-fin/x402-batching/client";
import {
  maxUint256,
  pad,
  parseUnits,
  zeroAddress,
} from "viem";

export async function payWorker(
  amount: string,
  workerAddress: `0x${string}`,
  onSubmitted?: (txHash: `0x${string}`) => Promise<void>,
) {
  console.info("PAYOUT: started");
  const privateKey = process.env.SELLER_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("SELLER_PRIVATE_KEY not configured");
  }

  const gateway = new GatewayClient({
    chain: "arcTestnet",
    privateKey: privateKey as `0x${string}`,
    rpcUrl: process.env.ARC_RPC_URL,
  });

  const config = CHAIN_CONFIGS.arcTestnet;

  const withdrawAmount = parseUnits(amount, 6);
  const maxFee = parseUnits("2.01", 6);

  // Check only the Gateway balance.
  // We deliberately avoid gateway.withdraw(), because its
  // getBalances() also performs an on-chain USDC balanceOf()
  // call that is timing out on Arc RPC.

  console.info("PAYOUT: requesting Gateway balance");
  const balanceResponse = await fetch(
    "https://gateway-api-testnet.circle.com/v1/balances",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: "USDC",
        sources: [
          {
            depositor: gateway.address,
            domain: config.domain,
          },
        ],
      }),
    },
  );
  console.info("PAYOUT: Gateway balance response received", {
    status: balanceResponse.status,
  });

  const balanceData = await balanceResponse.json();
  console.info("PAYOUT: Gateway balance response parsed");

  if (!balanceResponse.ok || !balanceData.balances?.length) {
    throw new Error(
      `Gateway balance check failed: ${JSON.stringify(balanceData)}`,
    );
  }

  const gatewayBalance = balanceData.balances[0];

  const available = parseUnits(gatewayBalance.balance, 6);
  const pendingBatch = parseUnits(
    gatewayBalance.pendingBatch ?? "0",
    6,
  );

  const availableBalance = available - pendingBatch;

  if (availableBalance < withdrawAmount) {
    throw new Error(
      `Insufficient Gateway balance. Have: ${gatewayBalance.balance}, Need: ${amount}`,
    );
  }

  const addressToBytes32 = (address: `0x${string}`) =>
    `0x${address.slice(2).padStart(64, "0")}` as `0x${string}`;

  const salt =
    `0x${randomBytes(32).toString("hex")}` as `0x${string}`;

  const burnIntent = {
    maxBlockHeight: maxUint256,
    maxFee,
    spec: {
      version: 1,
      sourceDomain: config.domain,
      destinationDomain: config.domain,
      sourceContract: addressToBytes32(config.gatewayWallet),
      destinationContract: addressToBytes32(config.gatewayMinter),
      sourceToken: addressToBytes32(config.usdc),
      destinationToken: addressToBytes32(config.usdc),
      sourceDepositor: addressToBytes32(gateway.address),
      destinationRecipient: addressToBytes32(workerAddress),
      sourceSigner: addressToBytes32(gateway.address),
      destinationCaller: addressToBytes32(zeroAddress),
      value: withdrawAmount,
      salt,
      hookData: "0x" as `0x${string}`,
    },
  };

  const signature = await gateway.account.signTypedData({
    domain: {
      name: "GatewayWallet",
      version: "1",
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
      ],
      TransferSpec: [
        { name: "version", type: "uint32" },
        { name: "sourceDomain", type: "uint32" },
        { name: "destinationDomain", type: "uint32" },
        { name: "sourceContract", type: "bytes32" },
        { name: "destinationContract", type: "bytes32" },
        { name: "sourceToken", type: "bytes32" },
        { name: "destinationToken", type: "bytes32" },
        { name: "sourceDepositor", type: "bytes32" },
        { name: "destinationRecipient", type: "bytes32" },
        { name: "sourceSigner", type: "bytes32" },
        { name: "destinationCaller", type: "bytes32" },
        { name: "value", type: "uint256" },
        { name: "salt", type: "bytes32" },
        { name: "hookData", type: "bytes" },
      ],
      BurnIntent: [
        { name: "maxBlockHeight", type: "uint256" },
        { name: "maxFee", type: "uint256" },
        { name: "spec", type: "TransferSpec" },
      ],
    },
    primaryType: "BurnIntent",
    message: burnIntent,
  });

  console.info("PAYOUT: requesting Circle transfer attestation");
  const transferResponse = await fetch(
    "https://gateway-api-testnet.circle.com/v1/transfer",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        [{ burnIntent, signature }],
        (_, value) =>
          typeof value === "bigint"
            ? value.toString()
            : value,
      ),
    },
  );
  console.info("PAYOUT: Circle transfer response received", {
    status: transferResponse.status,
  });

  const result = await transferResponse.json();
  console.info("PAYOUT: Circle transfer response parsed");

  if (
    !transferResponse.ok ||
    result.success === false ||
    result.error ||
    !result.attestation ||
    !result.signature
  ) {
    throw new Error(
      `Gateway transfer failed: ${result.message ||
      result.error ||
      JSON.stringify(result)
      }`,
    );
  }

  // Get the next transaction nonce directly from Arc RPC.
  console.info("PAYOUT: requesting Arc transaction nonce");
  const nonceResponse = await fetch(
    process.env.ARC_RPC_URL!,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getTransactionCount",
        params: [gateway.account.address, "pending"],
        id: 1,
      }),
    },
  );
  console.info("PAYOUT: Arc nonce response received", {
    status: nonceResponse.status,
  });

  const nonceData = await nonceResponse.json();
  console.info("PAYOUT: Arc nonce response parsed");

  if (!nonceResponse.ok || nonceData.error) {
    throw new Error(
      `Failed to get transaction nonce: ${JSON.stringify(nonceData)}`,
    );
  }

  const nonce = Number.parseInt(nonceData.result, 16);

  console.log("Using transaction nonce:", nonce);

  // Broadcast the gateway mint transaction.
  console.info("PAYOUT: broadcasting gatewayMint transaction");
  const mintTxHash = await gateway.walletClient.writeContract({
    address: config.gatewayMinter,
    abi: [
      {
        type: "function",
        name: "gatewayMint",
        stateMutability: "nonpayable",
        inputs: [
          {
            name: "attestationPayload",
            type: "bytes",
          },
          {
            name: "signature",
            type: "bytes",
          },
        ],
        outputs: [],
      },
    ],
    functionName: "gatewayMint",
    args: [result.attestation, result.signature],
    nonce,
    gasPrice: 25_000_000_000n,
  });

  console.info("PAYOUT: gatewayMint transaction broadcast", { mintTxHash });

  // IMPORTANT:
  // The transaction now exists on the network.
  // Persist the hash before waiting for confirmation.
  if (onSubmitted) {
    try {
      console.info("PAYOUT: persisting submitted transaction");
      await onSubmitted(mintTxHash);
      console.info("PAYOUT: submitted transaction persisted");
    } catch (error) {
      const submissionError = new Error(
        "Transaction was broadcast but failed to persist submitted state",
      );

      Object.assign(submissionError, {
        txHash: mintTxHash,
        cause: error,
      });

      throw submissionError;
    }
  }

  // Wait for on-chain confirmation.
  try {
    console.info("PAYOUT: waiting for Arc transaction receipt", { mintTxHash });
    const receipt =
      await gateway.publicClient.waitForTransactionReceipt({
        hash: mintTxHash,
      });
    console.info("PAYOUT: Arc transaction receipt received", {
      status: receipt.status,
      mintTxHash,
    });

    if (receipt.status !== "success") {
      const error = new Error(
        `Gateway mint transaction failed: ${mintTxHash}`,
      );

      Object.assign(error, {
        txHash: mintTxHash,
      });

      throw error;
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "txHash" in error
    ) {
      throw error;
    }

    const confirmationError = new Error(
      "Gateway mint transaction was broadcast but confirmation failed",
    );

    Object.assign(confirmationError, {
      txHash: mintTxHash,
      cause: error,
    });

    throw confirmationError;
  }

  return {
    mintTxHash,
  };
}
