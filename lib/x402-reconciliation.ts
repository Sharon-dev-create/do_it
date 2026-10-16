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
