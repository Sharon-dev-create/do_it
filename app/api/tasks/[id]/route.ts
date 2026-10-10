import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { createClient } from "@supabase/supabase-js";
import { isConfiguredV2TestWorker } from "@/lib/escrow-v2-server";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";
import { escrowPublicClient } from "@/lib/escrow-v2-server";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    let pendingRewardFlow = null;
    const worker = new URL(request.url).searchParams.get("worker");
    if (data.contract_version === "v2" && worker && isConfiguredV2TestWorker(worker) && data.status === "claimed") {
      const { data: submission } = await supabase.from("submissions").select("id, claim_tx_hash, worker_address, is_correct").eq("task_id", id).eq("worker_address", worker).eq("is_correct", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (submission) {
        const { data: payment } = await supabase.from("task_payments").select("id, status, tx_hash, payment_mechanism").eq("task_id", id).maybeSingle();
        if (payment?.payment_mechanism === "v2_reward_credit") {
          let claimTxHash = submission.claim_tx_hash;
          if (!claimTxHash && data.blockchain_task_id !== null) {
            try {
              const logs = await escrowPublicClient.getContractEvents({ address: DO_IT_ESCROW_ADDRESS, abi: DO_IT_ESCROW_ABI, eventName: "TaskClaimed", args: { taskId: BigInt(data.blockchain_task_id), worker: worker as `0x${string}` }, fromBlock: 66340107n });
              claimTxHash = logs.at(-1)?.transactionHash ?? null;
              if (claimTxHash) await supabase.from("submissions").update({ claim_tx_hash: claimTxHash }).eq("id", submission.id);
            } catch { /* Keep the recovery endpoint available when Arc RPC is temporarily unavailable. */ }
          }
          pendingRewardFlow = { submissionId: submission.id, paymentId: payment.id, claimTxHash, paymentStatus: payment.status, txHash: payment.tx_hash };
        }
      }
    }
    return NextResponse.json({ task: data, pendingRewardFlow, v2TestingRestriction: data.contract_version === "v2" });
  } catch {
    return NextResponse.json({ error: "Failed to fetch task" }, { status: 500 });
  }
}
