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

    // 2. Only failed payments can be retried
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
      .select("id, status, reward_usdc")
      .eq("id", payment.task_id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { error: "Associated task not found" },
        { status: 404 },
      );
    }

    if (task.status !== "completed") {
      return NextResponse.json(
        {
          error: "Cannot retry payment because the task is not completed",
        },
        { status: 409 },
      );
    }

    // 4. Mark payment as pending before attempting payout
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
          error: "Payment is already being retried or could not be updated",
        },
        { status: 409 },
      );
    }

    // 5. Retry the actual payout
    try {
      const payout = await payWorker(
        String(payment.amount_usdc),
        payment.worker_address as `0x${string}`,
      );

      // 6. Mark payment confirmed
      const { data: confirmedPayment, error: confirmError } =
        await supabase
            .from("task_payments")
            .update({
                status: "confirmed",
                tx_hash: payout.mintTxHash,
            completed_at: new Date().toISOString(),
          })
          .eq("id", payment.id)
          .eq("status", "pending")
          .select()
          .single();

      if (confirmError || !confirmedPayment) {
        console.error(
          "Failed to record successful retry:",
          confirmError,
        );

        return NextResponse.json(
          {
            error: "Payment succeeded but failed to update payment record",
            payment: {
              ...retryPayment,
              status: "confirmed",
              tx_hash: payout.mintTxHash,
            },
            txHash: payout.mintTxHash,
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

      // Return the payment to failed so it can be retried again later.
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