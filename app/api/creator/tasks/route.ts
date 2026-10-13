import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCreatorWallet } from "@/lib/creator-session";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(request: Request) {
  const wallet = await getCreatorWallet();
  if (!wallet) return NextResponse.json({ error: "Authorize your creator wallet first" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const page = Number(params.get("page") ?? 1);
  const limit = Number(params.get("limit") ?? 25);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return NextResponse.json({ error: "Invalid pagination" }, { status: 400 });
  }
  try {
    const { data, error, count } = await supabase.from("tasks")
      .select("id,title,description,reward_usdc,status,created_at,archived_at,contract_version,create_tx_hash,fund_tx_hash", { count: "exact" })
      .ilike("created_by", wallet).order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (error) throw error;
    return NextResponse.json({ tasks: data ?? [], page, limit, total: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to load your tasks" }, { status: 503 });
  }
}
