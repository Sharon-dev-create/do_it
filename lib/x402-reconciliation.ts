import { parseUnits } from "viem";

export type X402TransferEvidence = {
  id?: unknown;
  status?: unknown;
  token?: unknown;
  sendingNetwork?: unknown;
  recipientNetwork?: unknown;
  fromAddress?: unknown;
  toAddress?: unknown;
  amount?: unknown;
};

export type X402ExpectedEvidence = {
  network: string;
  payer: string;
  recipient: string;
  amountBaseUnits: string;
};

export type X402TransferLookupClient = {
  getTransferById: (id: string) => Promise<X402TransferEvidence>;
  searchTransfers: (params: {
    network: string;
    nonce: `0x${string}`;
    from: `0x${string}`;
    to: `0x${string}`;
    token: "USDC";
    pageSize: number;
    pageAfter?: string;
  }) => Promise<{
    transfers: X402TransferEvidence[];
    pagination?: { pageAfter?: string };
  }>;
};

export async function lookupX402Transfers(
  client: X402TransferLookupClient,
  query: {
    network: string;
    nonce: `0x${string}`;
    payer: `0x${string}`;
    recipient: `0x${string}`;
    transferId?: string;
  },
  maxPages = 10,
): Promise<{ transfers: X402TransferEvidence[]; complete: boolean }> {
  if (query.transferId) {
    return {
      transfers: [await client.getTransferById(query.transferId)],
      complete: true,
    };
  }

  const transfers: X402TransferEvidence[] = [];
  let pageAfter: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await client.searchTransfers({
      network: query.network,
      nonce: query.nonce,
      from: query.payer,
      to: query.recipient,
      token: "USDC",
      pageSize: 100,
      ...(pageAfter ? { pageAfter } : {}),
    });
    transfers.push(...result.transfers);
    pageAfter = result.pagination?.pageAfter;
    if (!pageAfter) return { transfers, complete: true };
  }
  return { transfers, complete: false };
}

export function assessX402TransferEvidence(
  transfer: X402TransferEvidence,
  expected: X402ExpectedEvidence,
): { mismatches: string[]; unavailable: string[]; candidate: boolean } {
  const mismatches: string[] = [];
  const unavailable: string[] = [];

  if (transfer.sendingNetwork !== expected.network) {
    if (typeof transfer.sendingNetwork !== "string") unavailable.push("sendingNetwork");
    else mismatches.push("sendingNetwork");
  }
  if (transfer.recipientNetwork !== expected.network) {
    if (typeof transfer.recipientNetwork !== "string") unavailable.push("recipientNetwork");
    else mismatches.push("recipientNetwork");
  }
  if (
    typeof transfer.fromAddress !== "string" ||
    transfer.fromAddress.toLowerCase() !== expected.payer.toLowerCase()
  ) {
    if (typeof transfer.fromAddress !== "string") unavailable.push("fromAddress");
    else mismatches.push("fromAddress");
  }
  if (
    typeof transfer.toAddress !== "string" ||
    transfer.toAddress.toLowerCase() !== expected.recipient.toLowerCase()
  ) {
    if (typeof transfer.toAddress !== "string") unavailable.push("toAddress");
    else mismatches.push("toAddress");
  }
  if (transfer.token !== "USDC") {
    if (typeof transfer.token !== "string") unavailable.push("token");
    else mismatches.push("token");
  }

  if (typeof transfer.amount !== "string") {
    unavailable.push("amount");
  } else {
    try {
      if (parseUnits(transfer.amount, 6).toString() !== expected.amountBaseUnits) {
        mismatches.push("amount");
      }
    } catch {
      mismatches.push("amount");
    }
  }

  return {
    mismatches,
    unavailable,
    candidate: mismatches.length === 0 && unavailable.length === 0,
  };
}
