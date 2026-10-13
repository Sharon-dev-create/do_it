import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAddress, parseUnits } from "viem";
import { getCreatorWallet } from "@/lib/creator-session";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type CsvTask = { title: string; description: string; reward_usdc: string; correct_answer: string };

function validTask(value: unknown): value is CsvTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.title !== "string" || row.title.trim().length < 3 || row.title.trim().length > 120 ||
      typeof row.description !== "string" || row.description.trim().length < 10 || row.description.trim().length > 10000 ||
      typeof row.correct_answer !== "string" || !row.correct_answer.trim() || row.correct_answer.length > 1000 ||
      typeof row.reward_usdc !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(row.reward_usdc.trim())) return false;
  try {
    const amount = parseUnits(row.reward_usdc.trim(), 6);
    return amount > 0n && amount <= 99_999_999_999_999_999_999n;
  } catch { return false; }
}

export async function POST(request: Request) {
  const wallet = await getCreatorWallet();
  if (!wallet) return NextResponse.json({ error: "Authorize your creator wallet first" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Request origin is invalid" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const input = body as { batch_id?: unknown; tasks?: unknown } | null;
  if (!input || typeof input !== "object" || !UUID.test(String(input.batch_id ?? "")) || !Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > 250) {
    return NextResponse.json({ error: "Provide a valid batch ID and 1 to 250 tasks" }, { status: 400 });
  }
  if (!input.tasks.every(validTask)) return NextResponse.json({ error: "One or more rows have invalid fields" }, { status: 400 });
  const tasks = input.tasks.map((row) => ({
    title: row.title.trim(), description: row.description.trim(), reward_usdc: row.reward_usdc.trim(), correct_answer: row.correct_answer.trim(),
  }));
  if (!isAddress(wallet, { strict: false })) return NextResponse.json({ error: "Creator session wallet is invalid" }, { status: 401 });
  const payloadHash = createHash("sha256").update(JSON.stringify(tasks)).digest("hex");
  try {
    const { data, error } = await supabase.rpc("create_creator_task_batch", {
      p_batch_id: input.batch_id as string, p_creator_wallet: wallet, p_payload_hash: payloadHash, p_tasks: tasks,
    });
    if (error) throw error;
    const result = data as { outcome?: string; tasks?: unknown[]; replayed?: boolean } | null;
    if (result?.outcome === "idempotency_conflict") return NextResponse.json({ error: "This batch ID was already used for different task data" }, { status: 409 });
    if (result?.outcome === "incomplete_batch") return NextResponse.json({ error: "The saved batch is incomplete and requires support review" }, { status: 500 });
    if (!Array.isArray(result?.tasks) || result.tasks.length !== tasks.length) return NextResponse.json({ error: "Batch result could not be verified" }, { status: 503 });
    return NextResponse.json({ created: result.tasks.length, replayed: Boolean(result.replayed), tasks: result.tasks }, { status: result.replayed ? 200 : 201 });
  } catch {
    return NextResponse.json({ error: "Bulk task creation failed; no partial batch was saved. Retry with the same batch ID." }, { status: 503 });
  }
}
