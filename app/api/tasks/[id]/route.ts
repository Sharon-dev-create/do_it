import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id, title, description, reward_usdc, created_by, status, created_at",
      )
      .eq("id", id)
      .single();

    if (error) {
      console.error("Get task error:", error);

      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ task: data });
  } catch (error) {
    console.error("Request error:", error);

    return NextResponse.json(
      { error: "Failed to fetch task" },
      { status: 500 },
    );
  }
}