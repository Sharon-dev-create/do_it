import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid task ID" }, { status: 400 });
  try {
    const { data, error } = await supabase.from("tasks").select(
      "id, title, description, reward_usdc, created_by, status, created_at, blockchain_task_id, create_tx_hash, fund_tx_hash, contract_version",
    ).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    if (typeof data.created_by !== "string" || !isAddress(data.created_by)) {
      return NextResponse.json({ error: "Task metadata is invalid" }, { status: 500 });
    }
    return NextResponse.json({ task: data, v2TestingRestriction: data.contract_version === "v2" });
  } catch {
    return NextResponse.json({ error: "Failed to fetch task" }, { status: 500 });
  }
}
