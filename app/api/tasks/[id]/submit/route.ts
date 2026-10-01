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

    // 4. Record the submission
    const { data: submission, error: submissionError } = await supabase
      .from("submissions")
      .insert({
        task_id: task.id,
        worker_address,
        answer: String(answer),
        is_correct: isCorrect,
        status: isCorrect ? "approved" : "rejected",
        verified_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (submissionError) {
      console.error("Create submission error:", submissionError);

      return NextResponse.json(
        { error: "Failed to record submission" },
        { status: 500 },
      );
    }

    // 5. If the answer is wrong, stop here
    if (!isCorrect) {
      return NextResponse.json({
        submission,
        correct: false,
        message: "Incorrect answer",
      });
    }

    // 6. Mark the task as completed
    const { error: taskUpdateError } = await supabase
      .from("tasks")
      .update({
        status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);

    if (taskUpdateError) {
      console.error("Update task error:", taskUpdateError);

      return NextResponse.json(
        { error: "Failed to complete task" },
        { status: 500 },
      );
    }

    // 7. Create the pending payment record
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

      return NextResponse.json(
        { error: "Failed to create payment record" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      submission,
      payment,
      correct: true,
      message: "Task completed. Payment pending.",
    });
  } catch (error) {
    console.error("Submit task error:", error);

    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 },
    );
  }
}