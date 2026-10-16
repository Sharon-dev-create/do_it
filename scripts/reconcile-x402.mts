import { GatewayClient, type TransferResponse } from "@circle-fin/x402-batching/client";
import { generatePrivateKey } from "viem/accounts";
import { isAddress } from "viem";
import {
  assessX402TransferEvidence,
  hasUniqueCompleteX402Candidate,
  lookupX402Transfers,
} from "../lib/x402-reconciliation.ts";

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
  if (process.argv.slice(2).includes("--help")) {
    console.log(
      "Read-only x402 lookup: npm run reconcile:x402 -- --network=testnet|mainnet --nonce=0x... --payer=0x... --recipient=0x... --token-address=0x... --domain-id=26 --amount-base-units=123 [--transfer-id=uuid]",
    );
    return;
  }
  const args = parseArgs(process.argv.slice(2));
  const network = required(args, "network");
  if (!isNetwork(network)) throw new Error("--network must be testnet or mainnet.");
  const nonce = required(args, "nonce");
  if (!/^0x[0-9a-fA-F]{64}$/.test(nonce)) throw new Error("--nonce must be a bytes32 hex value.");
  const payer = required(args, "payer");
  const recipient = required(args, "recipient");
  const tokenAddress = required(args, "token-address");
  const domainId = required(args, "domain-id");
  if (!isAddress(payer) || !isAddress(recipient) || !isAddress(tokenAddress)) {
    throw new Error("--payer, --recipient, and --token-address must be valid addresses.");
  }
  if (!/^[0-9]+$/.test(domainId)) throw new Error("--domain-id must be a non-negative integer.");
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

  const lookup = await lookupX402Transfers(client, {
    network: networkId,
    nonce: nonce as `0x${string}`,
    payer: payer as `0x${string}`,
    recipient: recipient as `0x${string}`,
    ...(args["transfer-id"] ? { transferId: args["transfer-id"] } : {}),
  });
  const transfers = lookup.transfers as TransferResponse[];

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
  const uniqueCompleteCandidate = hasUniqueCompleteX402Candidate(
    assessed.map(({ evidence }) => evidence),
    lookup.complete,
  );
  console.log(JSON.stringify({
    outcome: uniqueCompleteCandidate
      ? "candidate_requires_operator_review"
      : "unresolved",
    network: networkId,
    expectedGatewayDomain: Number(domainId),
    expectedTokenAddress: tokenAddress,
    nonceWasUsedAsSearchFilter: !args["transfer-id"],
    nonceReturnedInTransferRecord: false,
    gatewayDomainReturnedInTransferRecord: false,
    tokenAddressReturnedInTransferRecord: false,
    lookupComplete: lookup.complete,
    warning: "This report is read-only. Provider lookup data is a candidate, not authority to mark an intent paid or replay settlement.",
    transfers: assessed,
  }, null, 2));
  if (!uniqueCompleteCandidate || mismatched.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  console.error(`x402 reconciliation query failed (${errorName}).`);
  process.exitCode = 1;
});
