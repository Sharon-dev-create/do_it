import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createPublicClient,
  http,
  type Hex,
} from "viem";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.network"],
    },
  },
} as const;

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http("https://rpc.testnet.arc.network"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // 1. Find the payment
    const { data: payment, error: paymentError } = await supabase
      .from("task_payments")
      .select("*")
      .eq("id", id)
      .single();

    if (paymentError || !payment) {
      return NextResponse.json(
        { error: "Payment not found" },
        { status: 404 },
      );
    }

    // 2. Only submitted payments need reconciliation
    if (payment.status !== "submitted") {
      return NextResponse.json(
        {
          error: "Payment does not require reconciliation",
          payment,
        },
        { status: 409 },
      );
    }

    // 3. A submitted payment must have a transaction hash
    if (!payment.tx_hash) {
      return NextResponse.json(
        {
          error: "Submitted payment has no transaction hash",
          payment,
        },
        { status: 500 },
      );
    }

    const txHash = payment.tx_hash as Hex;

    // 4. Ask Arc for the transaction receipt
    let receipt;

    try {
      receipt = await publicClient.getTransactionReceipt({
        hash: txHash,
      });
    } catch (error) {
      // No receipt usually means the transaction has not been mined yet.
      // Do NOT mark it failed.
      console.log(
        "Transaction receipt not available yet:",
        txHash,
        error,
      );

      return NextResponse.json({
        payment,
        txHash,
        status: "submitted",
        message: "Transaction is still pending or receipt is temporarily unavailable",
        requiresReconciliation: true,
      });
    }

    // 5. Transaction was mined but reverted
    if (receipt.status === "reverted") {
      const { data: failedPayment, error: updateError } =
        await supabase
          .from("task_payments")
          .update({
            status: "failed",
          })
          .eq("id", payment.id)
          .eq("status", "submitted")
          .select()
          .single();

      if (updateError) {
        console.error(
          "Failed to mark reverted payment as failed:",
          updateError,
        );

        return NextResponse.json(
          {
            error: "Transaction reverted but payment state could not be updated",
            payment,
            txHash,
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        payment: failedPayment,
        txHash,
        status: "failed",
        message: "Transaction was mined but reverted",
        retryable: true,
      });
    }

    // 6. Transaction succeeded
    const { data: confirmedPayment, error: confirmError } =
      await supabase
        .from("task_payments")
        .update({
          status: "confirmed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", payment.id)
        .eq("status", "submitted")
        .select()
        .single();

    if (confirmError) {
      console.error(
        "Failed to mark payment as confirmed:",
        confirmError,
      );

      return NextResponse.json(
        {
          error:
            "Transaction succeeded but payment record could not be updated",
          payment,
          txHash,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      payment: confirmedPayment,
      txHash,
      status: "confirmed",
      message: "Payment successfully reconciled",
      retryable: false,
    });
  } catch (error) {
    console.error("Payment reconciliation error:", error);

    return NextResponse.json(
      {
        error: "Failed to reconcile payment",
      },
      { status: 500 },
    );
  }
}