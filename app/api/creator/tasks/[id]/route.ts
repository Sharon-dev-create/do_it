import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCreatorWallet } from "@/lib/creator-session";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const wallet = await getCreatorWallet();
  if (!wallet) return NextResponse.json({ error: "Authorize your creator wallet first" }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid task ID" }, { status: 400 });
  try {
    const { data, error } = await supabase.from("tasks")
      .select("id,title,description,reward_usdc,correct_answer,contract_version")
      .eq("id", id).ilike("created_by", wallet).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json({ task: data }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to load this task" }, { status: 503 });
  }
}
