import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      title,
      description,
      reward_usdc,
      correct_answer,
      created_by,
      blockchain_task_id,
      create_tx_hash,
      fund_tx_hash,
    } = body;

    if (
      !title ||
      !description ||
      reward_usdc === undefined ||
      !correct_answer ||
      !created_by ||
      blockchain_task_id === undefined ||
      !create_tx_hash ||
      !fund_tx_hash
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title,
        description,
        reward_usdc,
        correct_answer,
        created_by,
        blockchain_task_id,
        create_tx_hash,
        fund_tx_hash,
      })
      .select()
      .single();

    if (error) {
      console.error("Create task error:", error);

      return NextResponse.json(
        { error: "Failed to create task" },
        { status: 500 },
      );
    }

    return NextResponse.json({ task: data }, { status: 201 });
  } catch (error) {
    console.error("Request error:", error);

    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 },
    );
  }
}

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id, title, description, reward_usdc, created_by, status, created_at, updated_at, blockchain_task_id, create_tx_hash, fund_tx_hash",
      )
      .eq("status", "open")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Get tasks error:", error);

      return NextResponse.json(
        { error: "Failed to fetch tasks" },
        { status: 500 },
      );
    }

    return NextResponse.json({ tasks: data });
  } catch (error) {
    console.error("Request error:", error);

    return NextResponse.json(
      { error: "Failed to fetch tasks" },
      { status: 500 },
    );
  }
}