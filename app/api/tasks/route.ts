import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decodeEventLog, isAddress, isHash, parseUnits } from "viem";
import { ARC_USDC_ADDRESS } from "@/lib/contracts/usdc";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";
import { ARC_CHAIN_ID, assertArcEscrowDeployment, escrowPublicClient } from "@/lib/escrow-v2-server";
import { ARC_NETWORK_CONFIG } from "@/lib/arc-network";
import {
  runTaskListQuery,
  taskListFailureDiagnostic,
  validateTaskListSupabaseConfig,
  type TaskListFailureStage,
} from "@/lib/task-list-diagnostics";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseConfigIssues = validateTaskListSupabaseConfig(supabaseUrl, supabaseServiceRoleKey);
let supabase: SupabaseClient | null = null;

if (supabaseConfigIssues.length) {
  for (const code of supabaseConfigIssues) {
    console.error("Task listing initialization failed", {
      category: "configuration",
      stage: "client_init",
      code,
    });
  }
} else {
  try {
    supabase = createClient(supabaseUrl!, supabaseServiceRoleKey!);
  } catch {
    console.error("Task listing initialization failed", {
      category: "configuration",
      stage: "client_init",
      code: "SUPABASE_CLIENT_INIT_FAILED",
    });
  }
}

const PUBLIC_TASK_FIELDS = "id, title, description, reward_usdc, created_by, status, created_at, updated_at, blockchain_task_id, create_tx_hash, fund_tx_hash, contract_version";

function logTaskListFailure(error: unknown, stage: TaskListFailureStage) {
  console.error("Task listing failed", taskListFailureDiagnostic(error, stage));
}

export async function POST(request: Request) {
  try {
    const db = supabase;
    if (!db) {
      return NextResponse.json({ error: "Unable to verify and save task metadata." }, { status: 500 });
    }
    const body = await request.json();
    const { title, description, reward_usdc, correct_answer, created_by, blockchain_task_id, create_tx_hash, fund_tx_hash } = body ?? {};
    if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 120 ||
      typeof description !== "string" || description.trim().length < 10 || description.trim().length > 10000 ||
      typeof correct_answer !== "string" || !correct_answer.trim() || correct_answer.length > 1000 ||
      !isAddress(created_by) || !isHash(create_tx_hash) || !isHash(fund_tx_hash)) {
      return NextResponse.json({ error: "Invalid task metadata or transaction details" }, { status: 400 });
    }
    let reward: bigint;
    let chainTaskId: bigint;
    try {
      reward = parseUnits(String(reward_usdc), 6);
      chainTaskId = BigInt(blockchain_task_id);
      if (reward <= 0n || reward > 99_999_999_999_999_999_999n || chainTaskId < 0n) throw new Error("out of range");
    } catch {
      return NextResponse.json({ error: "Reward or blockchain task ID is invalid" }, { status: 400 });
    }

    // Idempotent metadata recovery: same create transaction returns the saved row.
    const { data: existing } = await db.from("tasks").select(PUBLIC_TASK_FIELDS).eq("create_tx_hash", create_tx_hash).maybeSingle();
    if (existing) return NextResponse.json({ task: existing, recovered: true }, { status: 200 });

    await assertArcEscrowDeployment();
    if ((await escrowPublicClient.getChainId()) !== ARC_CHAIN_ID) throw new Error(`Configured RPC is not ${ARC_NETWORK_CONFIG.label}`);
    const [createReceipt, fundReceipt] = await Promise.all([
      escrowPublicClient.getTransactionReceipt({ hash: create_tx_hash }),
      escrowPublicClient.getTransactionReceipt({ hash: fund_tx_hash }),
    ]);
    if (createReceipt.status !== "success" || fundReceipt.status !== "success" ||
      createReceipt.to?.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase() ||
      fundReceipt.to?.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase()) {
      return NextResponse.json({ error: "Creation and funding transactions must both succeed on the V2 escrow" }, { status: 400 });
    }
    const created = createReceipt.logs.some((log) => {
      if (log.address.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase()) return false;
      try {
        const event = decodeEventLog({ abi: DO_IT_ESCROW_ABI, data: log.data, topics: log.topics, eventName: "TaskCreated" });
        return event.args.taskId === chainTaskId && event.args.creator.toLowerCase() === created_by.toLowerCase() && event.args.reward === reward;
      } catch { return false; }
    });
    const funded = fundReceipt.logs.some((log) => {
      if (log.address.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase()) return false;
      try {
        const event = decodeEventLog({ abi: DO_IT_ESCROW_ABI, data: log.data, topics: log.topics, eventName: "TaskFunded" });
        return event.args.taskId === chainTaskId && event.args.creator.toLowerCase() === created_by.toLowerCase() && event.args.amount === reward;
      } catch { return false; }
    });
    const escrowUsdc = await escrowPublicClient.readContract({ address: DO_IT_ESCROW_ADDRESS, abi: DO_IT_ESCROW_ABI, functionName: "usdc" });
    if (!created || !funded || escrowUsdc.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase()) {
      return NextResponse.json({ error: "On-chain task metadata did not match the submitted transactions" }, { status: 400 });
    }
    const state = await escrowPublicClient.readContract({ address: DO_IT_ESCROW_ADDRESS, abi: DO_IT_ESCROW_ABI, functionName: "tasks", args: [chainTaskId] });
    if (state[0].toLowerCase() !== created_by.toLowerCase() || state[2] !== reward || state[3] !== 1) {
      return NextResponse.json({ error: "V2 task is not funded or its creator/reward differs" }, { status: 409 });
    }

    const { data, error } = await db.from("tasks").insert({
      title: title.trim(), description: description.trim(), reward_usdc: String(reward_usdc),
      correct_answer: correct_answer.trim(), created_by, blockchain_task_id: chainTaskId.toString(),
      create_tx_hash, fund_tx_hash, contract_version: "v2",
    }).select(PUBLIC_TASK_FIELDS).single();
    if (error) {
      const { data: raced } = await db.from("tasks").select(PUBLIC_TASK_FIELDS).eq("create_tx_hash", create_tx_hash).maybeSingle();
      if (raced) return NextResponse.json({ task: raced, recovered: true }, { status: 200 });
      console.error("Create task metadata insert failed:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return NextResponse.json({ error: "On-chain funding succeeded but metadata insert failed. Retry this same request with the same transaction hashes to reconcile; do not create or fund another task." }, { status: 500 });
    }
    return NextResponse.json({ task: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to verify and save task metadata. If the chain transactions succeeded, retry with their original hashes; do not repeat them." }, { status: 500 });
  }
}

export async function GET() {
  const db = supabase;
  if (!db) {
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }

  let stage: TaskListFailureStage = "query";
  try {
    const result = await runTaskListQuery(
      () => db.from("tasks").select(PUBLIC_TASK_FIELDS).eq("status", "open").is("archived_at", null).order("created_at", { ascending: false }),
      (error) => logTaskListFailure(error, "query"),
    );
    if (!result.ok) {
      return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
    }

    stage = "serialize";
    return NextResponse.json({ tasks: result.data });
  } catch (error) {
    logTaskListFailure(error, stage);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}
