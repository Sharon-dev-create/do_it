import { GatewayClient, type TransferResponse } from "@circle-fin/x402-batching/client";
import { generatePrivateKey } from "viem/accounts";
import { assessX402TransferEvidence } from "../lib/x402-reconciliation.ts";

type Network = "testnet" | "mainnet";

function parseArgs(args: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const argument of args) {
    const match = /^--([a-z-]+)=(.+)$/.exec(argument);
    if (!match) throw new Error(`Invalid argument: ${argument}`);
    values[match[1]] = match[2];
  }
  return values;
}

function required(values: Record<string, string>, name: string): string {
  const value = values[name];
  if (!value) throw new Error(`Missing required argument --${name}=...`);
  return value;
}

function isNetwork(value: string): value is Network {
  return value === "testnet" || value === "mainnet";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const network = required(args, "network");
  if (!isNetwork(network)) throw new Error("--network must be testnet or mainnet.");
  const nonce = required(args, "nonce");
  if (!/^0x[0-9a-fA-F]{64}$/.test(nonce)) throw new Error("--nonce must be a bytes32 hex value.");
  const payer = required(args, "payer");
  const recipient = required(args, "recipient");
  const amountBaseUnits = required(args, "amount-base-units");
  if (!/^[1-9][0-9]*$/.test(amountBaseUnits)) {
    throw new Error("--amount-base-units must be a positive integer.");
  }
  const networkId = network === "mainnet" ? "eip155:5042" : "eip155:5042002";
  const client = new GatewayClient({
    chain: network === "mainnet" ? "arc" : "arcTestnet",
    // Transfer lookup uses GET-only methods. This ephemeral key is never sent
    // to Circle and is not used to sign or submit any transaction.
    privateKey: generatePrivateKey(),
  });

  let transfers: TransferResponse[];
  if (args["transfer-id"]) {
    transfers = [await client.getTransferById(args["transfer-id"])];
  } else {
    transfers = [];
    let pageAfter: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await client.searchTransfers({
        network: networkId,
        nonce: nonce as `0x${string}`,
        from: payer as `0x${string}`,
        to: recipient as `0x${string}`,
        token: "USDC",
        pageSize: 100,
        ...(pageAfter ? { pageAfter } : {}),
      });
      transfers.push(...result.transfers);
      pageAfter = result.pagination?.pageAfter;
      if (!pageAfter) break;
      if (page === 9) {
        console.log(JSON.stringify({
          outcome: "unresolved",
          reason: "pagination_limit_reached",
          returned: transfers.length,
        }, null, 2));
        process.exitCode = 2;
        return;
      }
    }
  }

  const assessed = transfers.map((transfer) => ({
    transfer: {
      id: transfer.id,
      status: transfer.status,
      token: transfer.token,
      sendingNetwork: transfer.sendingNetwork,
      recipientNetwork: transfer.recipientNetwork,
      fromAddress: transfer.fromAddress,
      toAddress: transfer.toAddress,
      amount: transfer.amount,
    },
    evidence: assessX402TransferEvidence(transfer, {
      network: networkId,
      payer,
      recipient,
      amountBaseUnits,
    }),
  }));
  const mismatched = assessed.filter(({ evidence }) => evidence.mismatches.length > 0);
  const candidates = assessed.filter(({ evidence }) => evidence.candidate);
  console.log(JSON.stringify({
    outcome: candidates.length === 1 && mismatched.length === 0
      ? "candidate_requires_operator_review"
      : "unresolved",
    network: networkId,
    nonceWasUsedAsSearchFilter: !args["transfer-id"],
    nonceReturnedInTransferRecord: false,
    gatewayDomainReturnedInTransferRecord: false,
    tokenAddressReturnedInTransferRecord: false,
    transfers: assessed,
  }, null, 2));
  if (candidates.length !== 1 || mismatched.length > 0) process.exitCode = 2;
}

main().catch((error: unknown) => {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  console.error(`x402 reconciliation query failed (${errorName}).`);
  process.exitCode = 1;
});
