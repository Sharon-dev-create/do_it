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
    const body = await request.json();

    const { worker_address, answer } = body;

    if (!worker_address || answer === undefined) {
      return NextResponse.json(
        { error: "Missing worker_address or answer" },
        { status: 400 },
      );
    }

    // 1. Find the task
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 },
      );
    }

    // 2. Make sure the task is still available
    if (task.status !== "open") {
      return NextResponse.json(
        { error: "Task is no longer open" },
        { status: 409 },
      );
    }

    // 3. Check the answer
    const isCorrect =
      String(answer).trim().toLowerCase() ===
      String(task.correct_answer).trim().toLowerCase();

    // Wrong answers don't claim the task
    if (!isCorrect) {
      const { data: submission, error: submissionError } = await supabase
        .from("submissions")
        .insert({
          task_id: task.id,
          worker_address,
          answer: String(answer),
          is_correct: false,
          status: "rejected",
          verified_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (submissionError) {
        console.error("Create rejected submission error:", submissionError);

        return NextResponse.json(
          { error: "Failed to record submission" },
          { status: 500 },
        );
      }

      return NextResponse.json({
        submission,
        correct: false,
        message: "Incorrect answer",
      });
    }

    // 4. Atomically claim the task
    const { data: claimedTask, error: claimError } = await supabase
      .from("tasks")
      .update({
        status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("status", "open")
      .select()
      .single();

    if (claimError || !claimedTask) {
      return NextResponse.json(
        { error: "Task has already been claimed" },
        { status: 409 },
      );
    }

    // 5. Record the successful submission
    const { data: submission, error: submissionError } = await supabase
      .from("submissions")
      .insert({
        task_id: task.id,
        worker_address,
        answer: String(answer),
        is_correct: true,
        status: "approved",
        verified_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (submissionError) {
      console.error("Create successful submission error:", submissionError);

      // We claimed the task but haven't created a payment.
      // Reopen it so it isn't permanently stuck.
      await supabase
        .from("tasks")
        .update({
          status: "open",
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id)
        .eq("status", "completed");

      return NextResponse.json(
        { error: "Failed to record submission" },
        { status: 500 },
      );
    }

    // 6. Create the pending payment record
    const { data: payment, error: paymentError } = await supabase
      .from("task_payments")
      .insert({
        task_id: task.id,
        submission_id: submission.id,
        worker_address,
        amount_usdc: task.reward_usdc,
        status: "pending",
      })
      .select()
      .single();

    if (paymentError) {
      console.error("Create payment error:", paymentError);

      // The task was claimed and the submission was recorded
      // but no paymnent record was created
      // NOthing has been paid yet, so reopen the task.
      const { error: reopenError } = await supabase
        .from("tasks")
        .update({
          status: "open",
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id)
        .eq("status", "completed");

        if (reopenError) {
           console.error(
            "Failed to open task after payment creation error:",
            reopenError,
           );
        }
    }

    // 7. Pay the worker
    try {
      const payout = await payWorker(
        String(task.reward_usdc),
        worker_address as `0x${string}`,
      );
      const { data: confirmedPayment, error: paymentUpdateError } =
        await supabase
          .from("task_payments")
          .update({
            status: "confirmed",
            tx_hash: payout.mintTxHash,
            completed_at: new Date().toISOString(),
          })
          .eq("id", payment.id)
          .select()
          .single();

      if (paymentUpdateError) {
        console.error(
          "Failed to update payment status:",
          paymentUpdateError,
        );

        return NextResponse.json(
          {
            error: "Payment succeeded but payment record update failed",
            correct: true,
            submission,
            payment: confirmedPayment ??{
              ...payment,
              status: "confirmed",
              tx_hash: payout.mintTxHash,
              completed_at: new Date().toISOString(),
            },
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        submission,
        correct: true,
        message: "Task completed and worker paid successfully",
        payment: confirmedPayment,
        txHash: payout.mintTxHash,
      });

    } catch (payoutError) {
      console.error("Payment error:", payoutError);

      const { data: failedPayment, error: paymentUpdateError } =
        await supabase
          .from("task_payments")
          .update({
            status: "failed",
          })
          .eq("id", payment.id)
          .select()
          .single();

      if (paymentUpdateError) {
        console.error(
          "Failed to update payment status",
          paymentUpdateError,
        );
      }

      return NextResponse.json(
        {
          error: "Task completed but payment failed",
          correct: true,
          submission,
          payment: failedPayment ?? {
            ...payment,
            status: "failed",
          },
        },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("Submit task error:", error);

    return NextResponse.json(
      { error: "Failed to submit task" },
      { status: 500 },
    );
  }
}
