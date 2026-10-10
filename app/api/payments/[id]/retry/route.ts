import { payWorker } from "@/lib/payout";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

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

    // V2 credits are accounting entries in the escrow, never Gateway transfers.
    if (payment.payment_mechanism === "v2_reward_credit") {
      return NextResponse.json({ error: "V2 escrow reward credits cannot be sent through Circle Gateway" }, { status: 409 });
    }

    // 2. Only failed payments can be retried.
    // submitted payments may already have been broadcast and
    // must be reconciled instead of being paid again.
    if (payment.status !== "failed") {
      return NextResponse.json(
        {
          error: `Payment cannot be retried because its status is "${payment.status}"`,
        },
        { status: 409 },
      );
    }

    // 3. Make sure the task is still completed
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("id, status, reward_usdc, contract_version")
      .eq("id", payment.task_id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { error: "Associated task not found" },
        { status: 404 },
      );
    }
    if (task.contract_version === "v2") {
      return NextResponse.json({ error: "V2 tasks cannot be paid or retried through Circle Gateway" }, { status: 409 });
    }

    // A historical hash means an earlier attempt may have been broadcast; never resend it.
    if (payment.tx_hash) {
      return NextResponse.json({ error: "This payment has an existing transaction hash. Reconcile it before any retry.", txHash: payment.tx_hash, requiresReconciliation: true }, { status: 409 });
    }

    if (task.status !== "completed") {
      return NextResponse.json(
        {
          error: "Cannot retry payment because the task is not completed",
        },
        { status: 409 },
      );
    }

    // 4. Atomically claim the failed payment for retry.
    const { data: retryPayment, error: retryError } = await supabase
      .from("task_payments")
      .update({
        status: "pending",
      })
      .eq("id", payment.id)
      .eq("status", "failed")
      .select()
      .single();

    if (retryError || !retryPayment) {
      return NextResponse.json(
        {
          error:
            "Payment is already being retried or could not be updated",
        },
        { status: 409 },
      );
    }

    // 5. Retry the payout
    try {
      const payout = await payWorker(
        String(payment.amount_usdc),
        payment.worker_address as `0x${string}`,
        async (txHash) => {
          const { error } = await supabase
            .from("task_payments")
            .update({
              status: "submitted",
              tx_hash: txHash,
            })
            .eq("id", payment.id)
            .eq("status", "pending");

          if (error) {
            throw error;
          }
        },
      );

      // 6. The transaction is confirmed on-chain.
      // Only submitted -> confirmed is allowed here.
      const { data: confirmedPayment, error: confirmError } =
        await supabase
          .from("task_payments")
          .update({
            status: "confirmed",
            tx_hash: payout.mintTxHash,
            completed_at: new Date().toISOString(),
          })
          .eq("id", payment.id)
          .eq("status", "submitted")
          .select()
          .single();

      if (confirmError || !confirmedPayment) {
        console.error(
          "Failed to record successful retry:",
          confirmError,
        );

        return NextResponse.json(
          {
            error:
              "Payment succeeded but payment record update failed",
            payment: {
              ...retryPayment,
              status: "submitted",
              tx_hash: payout.mintTxHash,
            },
            txHash: payout.mintTxHash,
            requiresReconciliation: true,
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        message: "Payment retry successful",
        payment: confirmedPayment,
        txHash: payout.mintTxHash,
      });
    } catch (payoutError) {
      console.error("Payment retry failed:", payoutError);

      // If a transaction hash exists, the transaction was already
      // broadcast. NEVER turn that payment into "failed".
      const txHash =
        payoutError &&
        typeof payoutError === "object" &&
        "txHash" in payoutError &&
        typeof payoutError.txHash === "string"
          ? payoutError.txHash
          : null;

      if (txHash) {
        const { data: submittedPayment, error: submittedError } =
          await supabase
            .from("task_payments")
            .update({
              status: "submitted",
              tx_hash: txHash,
            })
            .eq("id", payment.id)
            .eq("status", "pending")
            .select()
            .single();

        if (submittedError) {
          console.error(
            "Failed to save submitted payment:",
            submittedError,
          );
        }

        return NextResponse.json(
          {
            error:
              "Payment transaction was submitted but confirmation is unresolved",
            payment: submittedPayment ?? {
              ...retryPayment,
              status: "submitted",
              tx_hash: txHash,
            },
            txHash,
            requiresReconciliation: true,
          },
          { status: 500 },
        );
      }

      // No transaction hash means the payout was not broadcast.
      // This is safe to retry later.
      const { data: failedPayment, error: failedUpdateError } =
        await supabase
          .from("task_payments")
          .update({
            status: "failed",
          })
          .eq("id", payment.id)
          .eq("status", "pending")
          .select()
          .single();

      if (failedUpdateError) {
        console.error(
          "Failed to restore payment to failed state:",
          failedUpdateError,
        );
      }

      return NextResponse.json(
        {
          error: "Payment retry failed",
          payment: failedPayment ?? {
            ...retryPayment,
            status: "failed",
          },
        },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("Retry payment error:", error);

    return NextResponse.json(
      { error: "Failed to retry payment" },
      { status: 500 },
    );
  }
}
