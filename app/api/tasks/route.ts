import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decodeEventLog, isAddress, isHash, parseUnits } from "viem";
import { ARC_TESTNET_USDC } from "@/lib/contracts/usdc";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";
import { escrowPublicClient } from "@/lib/escrow-v2-server";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const PUBLIC_TASK_FIELDS = "id, title, description, reward_usdc, created_by, status, created_at, updated_at, blockchain_task_id, create_tx_hash, fund_tx_hash, contract_version";

export async function POST(request: Request) {
  try {
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
    const { data: existing } = await supabase.from("tasks").select(PUBLIC_TASK_FIELDS).eq("create_tx_hash", create_tx_hash).maybeSingle();
    if (existing) return NextResponse.json({ task: existing, recovered: true }, { status: 200 });

    if ((await escrowPublicClient.getChainId()) !== 5042002) throw new Error("Configured RPC is not Arc Testnet");
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
    if (!created || !funded || escrowUsdc.toLowerCase() !== ARC_TESTNET_USDC.toLowerCase()) {
      return NextResponse.json({ error: "On-chain task metadata did not match the submitted transactions" }, { status: 400 });
    }
    const state = await escrowPublicClient.readContract({ address: DO_IT_ESCROW_ADDRESS, abi: DO_IT_ESCROW_ABI, functionName: "tasks", args: [chainTaskId] });
    if (state[0].toLowerCase() !== created_by.toLowerCase() || state[2] !== reward || state[3] !== 1) {
      return NextResponse.json({ error: "V2 task is not funded or its creator/reward differs" }, { status: 409 });
    }

    const { data, error } = await supabase.from("tasks").insert({
      title: title.trim(), description: description.trim(), reward_usdc: String(reward_usdc),
      correct_answer: correct_answer.trim(), created_by, blockchain_task_id: chainTaskId.toString(),
      create_tx_hash, fund_tx_hash, contract_version: "v2",
    }).select(PUBLIC_TASK_FIELDS).single();
    if (error) {
      const { data: raced } = await supabase.from("tasks").select(PUBLIC_TASK_FIELDS).eq("create_tx_hash", create_tx_hash).maybeSingle();
      if (raced) return NextResponse.json({ task: raced, recovered: true }, { status: 200 });
      console.error("Create task metadata insert failed");
      return NextResponse.json({ error: "On-chain funding succeeded but metadata insert failed. Retry this same request with the same transaction hashes to reconcile; do not create or fund another task." }, { status: 500 });
    }
    return NextResponse.json({ task: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to verify and save task metadata. If the chain transactions succeeded, retry with their original hashes; do not repeat them." }, { status: 500 });
  }
}

export async function GET() {
  try {
    const { data, error } = await supabase.from("tasks").select(PUBLIC_TASK_FIELDS).eq("status", "open").order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ tasks: data });
  } catch {
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}
