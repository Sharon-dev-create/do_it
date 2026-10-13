import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCreatorWallet } from "@/lib/creator-session";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const wallet = await getCreatorWallet();
  if (!wallet) return NextResponse.json({ error: "Authorize your creator wallet first" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const ids = (body as { task_ids?: unknown } | null)?.task_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || ids.some((id) => typeof id !== "string" || !UUID.test(id)) || new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: "Provide between 1 and 100 unique valid task IDs" }, { status: 400 });
  }
  try {
    const { data, error } = await supabase.rpc("delete_creator_tasks", { p_task_ids: ids, p_creator_wallet: wallet });
    if (error) throw error;
    const outcomes = Array.isArray(data) ? data : [];
    const success = outcomes.filter((item: { outcome?: string }) => ["deleted", "archived", "already_archived"].includes(item.outcome ?? "")).length;
    return NextResponse.json({ results: outcomes, succeeded: success, failed: ids.length - success }, { status: success === ids.length ? 200 : 207 });
  } catch {
    return NextResponse.json({ error: "Bulk deletion failed without applying any task changes" }, { status: 503 });
  }
}
