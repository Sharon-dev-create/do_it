import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCreatorWallet } from "@/lib/creator-session";
import { getVerifiedV2TerminalStatus } from "@/lib/v2-task-archive";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Request origin is invalid" }, { status: 403 });
  const wallet = await getCreatorWallet();
  if (!wallet) return NextResponse.json({ error: "Authorize your creator wallet first" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const ids = (body as { task_ids?: unknown } | null)?.task_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || ids.some((id) => typeof id !== "string" || !UUID.test(id)) || new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: "Provide between 1 and 100 unique valid task IDs" }, { status: 400 });
  }
  try {
    const { data: taskRows, error: tasksError } = await supabase.from("tasks")
      .select("id,created_by,contract_version,status,blockchain_task_id,reward_usdc,create_tx_hash,fund_tx_hash")
      .in("id", ids);
    if (tasksError) throw tasksError;
    const v2ChainStatuses: Record<string, number> = {};
    for (const task of taskRows ?? []) {
      if (task.created_by.toLowerCase() !== wallet.toLowerCase() || task.contract_version !== "v2") continue;
      const { data: payment, error: paymentError } = await supabase.from("task_payments")
        .select("status,payment_mechanism,tx_hash,worker_address").eq("task_id", task.id).maybeSingle();
      if (paymentError) throw paymentError;
      const chainStatus = await getVerifiedV2TerminalStatus(task, payment);
      if (chainStatus !== null) v2ChainStatuses[task.id] = chainStatus;
    }
    const { data, error } = await supabase.rpc("delete_creator_tasks", {
      p_task_ids: ids, p_creator_wallet: wallet, p_v2_chain_statuses: v2ChainStatuses,
    });
    if (error) throw error;
    const outcomes = Array.isArray(data) ? data : [];
    if (outcomes.length !== ids.length) throw new Error("Bulk deletion returned an incomplete result set");
    const success = outcomes.filter((item: { outcome?: string }) => ["deleted", "archived", "already_archived"].includes(item.outcome ?? "")).length;
    return NextResponse.json({ results: outcomes, succeeded: success, failed: ids.length - success }, { status: success === ids.length ? 200 : 207 });
  } catch {
    return NextResponse.json({ error: "Unable to confirm the bulk deletion result. Refresh the task list before retrying." }, { status: 503 });
  }
}
