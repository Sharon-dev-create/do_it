import { payWorker } from "@/lib/payout";
import { ARC_NETWORK_CONFIG } from "@/lib/arc-network";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getWorkerAddressFromSessionToken,
  WORKER_SESSION_COOKIE,
} from "@/lib/worker-session-auth";
import { isAuthorizedGatewayPaymentRetry } from "@/lib/payment-retry-policy";
import { getV1GatewayPayoutUnavailableMessage } from "@/lib/v1-payout-policy";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const payoutUnavailable = getV1GatewayPayoutUnavailableMessage(
      ARC_NETWORK_CONFIG.name,
    );
    if (payoutUnavailable) {
      return NextResponse.json({ error: payoutUnavailable }, { status: 503 });
    }

    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      return NextResponse.json({ error: "Request origin is invalid" }, { status: 403 });
    }

    const { id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: "Invalid payment ID" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const sessionWallet = getWorkerAddressFromSessionToken(
      cookieStore.get(WORKER_SESSION_COOKIE)?.value,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    if (!sessionWallet) {
      return NextResponse.json({ error: "Authorize the worker wallet before retrying a payment" }, { status: 401 });
    }

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
    if (
      typeof payment.worker_address !== "string" ||
      sessionWallet !== payment.worker_address.toLowerCase()
    ) {
      return NextResponse.json({ error: "Only the payment recipient may retry this payout" }, { status: 403 });
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
      .select("id, created_by, status, reward_usdc, contract_version")
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
    const { data: submission, error: submissionError } = payment.submission_id
      ? await supabase
          .from("submissions")
          .select("id, task_id, worker_address, is_correct, status")
          .eq("id", payment.submission_id)
          .maybeSingle()
      : { data: null, error: null };
    if (submissionError) {
      console.error("Payment retry submission lookup failed:", submissionError.code);
      return NextResponse.json({ error: "Unable to verify the payment submission" }, { status: 503 });
    }
    if (!isAuthorizedGatewayPaymentRetry(payment, task, submission)) {
      return NextResponse.json(
        { error: "Payment does not match a completed, approved V1 submission and its authorized reward" },
        { status: 409 },
      );
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
      .is("tx_hash", null)
      .select()
      .maybeSingle();

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
          const { data: submitted, error } = await supabase
            .from("task_payments")
            .update({
              status: "submitted",
              tx_hash: txHash,
            })
            .eq("id", payment.id)
            .eq("status", "pending")
            .select("id")
            .maybeSingle();

          if (error || !submitted) {
            throw error ?? new Error("Payment state changed before the submitted transaction was recorded.");
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
