import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { decodeEventLog, isAddress, isHash } from "viem";
import { payWorker } from "@/lib/payout";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";
import { ARC_CHAIN_ID, assertArcEscrowDeployment, escrowPublicClient, getVerifierWalletClient, isConfiguredV2Worker, verifyV2TaskRecord } from "@/lib/escrow-v2-server";
import { ARC_NETWORK_CONFIG } from "@/lib/arc-network";
import { assertGatewayAvailable } from "@/lib/arc-network-server";
import { getTaskCreatorSubmissionError } from "@/lib/submission-auth";
import { getMatchingWorkerSessionAddress, WORKER_SESSION_COOKIE } from "@/lib/worker-session-auth";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const time = () => new Date().toISOString();
type V2TaskRecord = {
  id: string;
  status: string;
  blockchain_task_id: number | string | null;
  created_by: string;
  reward_usdc: number | string;
  correct_answer: string | null;
};

async function submitV2(task: V2TaskRecord, taskId: string, worker: string, answer: string, claimHash?: string, submissionId?: string) {
  if (!isConfiguredV2Worker(worker)) return NextResponse.json({ error: "This V2 deployment accepts submissions only from configured workers." }, { status: 403 });
  try { await assertArcEscrowDeployment(); }
  catch { return NextResponse.json({ error: `${ARC_NETWORK_CONFIG.label} escrow deployment is unavailable or misconfigured.` }, { status: 503 }); }
  if ((await escrowPublicClient.getChainId()) !== ARC_CHAIN_ID) return NextResponse.json({ error: `${ARC_NETWORK_CONFIG.label} RPC is unavailable or misconfigured` }, { status: 503 });

  let onchain;
  try { onchain = await verifyV2TaskRecord(task); }
  catch { return NextResponse.json({ error: `Unable to verify the V2 task against ${ARC_NETWORK_CONFIG.label}` }, { status: 503 }); }

  if (claimHash !== undefined) {
    if (!submissionId || !UUID.test(submissionId) || !isHash(claimHash)) return NextResponse.json({ error: "A valid submission ID and claim transaction hash are required" }, { status: 400 });
    const { data: submission } = await supabase.from("submissions").select("id, task_id, worker_address, is_correct, status, claim_tx_hash").eq("id", submissionId).eq("task_id", task.id).maybeSingle();
    if (!submission || !submission.is_correct || submission.worker_address.toLowerCase() !== worker.toLowerCase()) return NextResponse.json({ error: "Correct submission not found for this worker" }, { status: 404 });
    const { data: payment } = await supabase.from("task_payments").select("*").eq("task_id", task.id).maybeSingle();
    if (!payment || payment.payment_mechanism !== "v2_reward_credit") return NextResponse.json({ error: "V2 reward record is missing" }, { status: 409 });
    if (payment.status === "confirmed") return NextResponse.json({ correct: true, credited: true, message: "Reward credited to your on-chain earnings.", txHash: payment.tx_hash });
    if (["submitted", "processing"].includes(payment.status)) return NextResponse.json({ correct: true, credited: false, error: "Reward processing is already in progress. Reconcile the stored transaction before retrying.", txHash: payment.tx_hash, requiresReconciliation: true }, { status: 409 });

    const { data: locked } = await supabase.from("task_payments").update({ status: "processing" }).eq("id", payment.id).in("status", ["pending", "failed"]).select("id").maybeSingle();
    if (!locked) return NextResponse.json({ error: "Another request is processing this reward. Check its payment record before retrying." }, { status: 409 });
    let rewardStage = "verify_claim_receipt";
    try {
      const receipt = await escrowPublicClient.getTransactionReceipt({ hash: claimHash as `0x${string}` });
      const claimEvent = receipt.status === "success" && receipt.to?.toLowerCase() === DO_IT_ESCROW_ADDRESS.toLowerCase() && receipt.logs.some((log) => {
        if (log.address.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase()) return false;
        try {
          const parsed = decodeEventLog({ abi: DO_IT_ESCROW_ABI, data: log.data, topics: log.topics, eventName: "TaskClaimed" });
          return parsed.args.taskId === onchain.taskId && parsed.args.worker.toLowerCase() === worker.toLowerCase();
        } catch { return false; }
      });
      if (!claimEvent || onchain.status !== 2 || onchain.worker.toLowerCase() !== worker.toLowerCase()) {
        await supabase.from("task_payments").update({ status: "pending" }).eq("id", payment.id).eq("status", "processing");
        return NextResponse.json({ error: "Claim transaction is not confirmed for this task and connected worker" }, { status: 409 });
      }
      await supabase.from("submissions").update({ claim_tx_hash: claimHash }).eq("id", submissionId);
      rewardStage = "load_verifier_signer";
      const verifier = getVerifierWalletClient();
      rewardStage = "broadcast_release_reward";
      const txHash = await verifier.writeContract({ address: DO_IT_ESCROW_ADDRESS, abi: DO_IT_ESCROW_ABI, functionName: "releaseReward", args: [onchain.taskId] });
      rewardStage = "save_reward_transaction_hash";
      await supabase.from("task_payments").update({ status: "submitted", tx_hash: txHash }).eq("id", payment.id).eq("status", "processing");
      rewardStage = "wait_for_reward_receipt";
      const creditReceipt = await escrowPublicClient.waitForTransactionReceipt({ hash: txHash });
      if (creditReceipt.status !== "success") throw Object.assign(new Error("Reward credit transaction reverted"), { txHash });
      rewardStage = "validate_reward_event";
      const credited = creditReceipt.logs.some((log) => {
        if (log.address.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase()) return false;
        try {
          const parsed = decodeEventLog({ abi: DO_IT_ESCROW_ABI, data: log.data, topics: log.topics, eventName: "RewardCredited" });
          return parsed.args.taskId === onchain.taskId && parsed.args.worker.toLowerCase() === worker.toLowerCase() && parsed.args.amount === onchain.reward;
        } catch { return false; }
      });
      if (!credited) throw Object.assign(new Error("RewardCredited event was not present"), { txHash });
      rewardStage = "finalize_payment_record";
      const { data: confirmed, error } = await supabase.from("task_payments").update({ status: "confirmed", completed_at: time() }).eq("id", payment.id).eq("status", "submitted").select().maybeSingle();
      await supabase.from("submissions").update({ status: "approved", is_correct: true, verified_at: time() }).eq("id", submissionId);
      await supabase.from("tasks").update({ status: "completed", updated_at: time() }).eq("id", task.id).eq("status", "claimed");
      if (error || !confirmed) return NextResponse.json({ correct: true, credited: true, error: "On-chain earnings were credited, but the database update needs reconciliation.", paymentId: payment.id, txHash, requiresReconciliation: true }, { status: 500 });
      return NextResponse.json({ correct: true, credited: true, message: "Reward credited to your on-chain earnings. Withdraw it from your connected wallet when ready.", submissionId, paymentId: payment.id, payment: confirmed, txHash });
    } catch (error) {
      const txHash = error && typeof error === "object" && "txHash" in error && typeof error.txHash === "string" ? error.txHash : null;
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.error("V2 reward attempt failed", { stage: rewardStage, errorName, transactionHashAvailable: Boolean(txHash) });
      if (txHash) await supabase.from("task_payments").update({ status: "submitted", tx_hash: txHash }).eq("id", payment.id).in("status", ["processing", "submitted"]);
      else await supabase.from("task_payments").update({ status: "failed" }).eq("id", payment.id).eq("status", "processing");
      return NextResponse.json({ correct: true, error: txHash ? "Reward transaction was broadcast; reconcile it before taking further action." : "Could not credit the reward. The task was not paid through Gateway.", paymentId: payment.id, txHash, requiresReconciliation: Boolean(txHash) }, { status: txHash ? 202 : 502 });
    }
  }

  if (onchain.status !== 1) return NextResponse.json({ error: "V2 task is no longer funded and available on-chain" }, { status: 409 });
  const isCorrect = answer.trim().toLocaleLowerCase() === String(task.correct_answer ?? "").trim().toLocaleLowerCase();
  if (!isCorrect) {
    const { data: result, error } = await supabase.rpc("record_rejected_task_submission", {
      p_task_id: task.id,
      p_worker_address: worker,
      p_answer: answer,
    });
    if (error) return NextResponse.json({ error: "Failed to record rejected submission" }, { status: 500 });
    if (result?.outcome === "creator_self_submission") return NextResponse.json({ error: "You cannot submit an answer to a task you created." }, { status: 403 });
    if (result?.outcome === "invalid_input") return NextResponse.json({ error: "A valid wallet and answer are required" }, { status: 400 });
    if (result?.outcome === "archived") return NextResponse.json({ error: "This task is archived and cannot accept submissions" }, { status: 410 });
    if (result?.outcome === "closed") return NextResponse.json({ error: "Task is no longer open" }, { status: 409 });
    if (result?.outcome !== "recorded") return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json({ correct: false, submission: result.submission, message: "Incorrect answer" });
  }

  const { data: reserved, error: reserveError } = await supabase.from("tasks").update({ status: "claimed", updated_at: time() }).eq("id", task.id).eq("status", "open").is("archived_at", null).select("id").maybeSingle();
  if (reserveError) return NextResponse.json({ error: "Unable to reserve this task" }, { status: 500 });
  if (!reserved) return NextResponse.json({ error: "Task is archived, already claimed, or completed" }, { status: 409 });
  const { data: submission, error: submissionError } = await supabase.from("submissions").insert({ task_id: task.id, worker_address: worker, answer, is_correct: true, status: "approved", verified_at: time() }).select("id, task_id, worker_address, is_correct, status, created_at").single();
  if (submissionError) {
    await supabase.from("tasks").update({ status: "open", updated_at: time() }).eq("id", task.id).eq("status", "claimed");
    return NextResponse.json({ error: "Unable to reserve the correct submission" }, { status: 500 });
  }
  const { data: payment, error: paymentError } = await supabase.from("task_payments").insert({ task_id: task.id, submission_id: submission.id, worker_address: worker, amount_usdc: task.reward_usdc, status: "pending", payment_mechanism: "v2_reward_credit" }).select("id").single();
  if (paymentError) {
    // Keep the task reserved: a unique payment conflict may mean an earlier credit needs reconciliation.
    return NextResponse.json({ error: "Submission reserved but reward record could not be created. Contact support; do not submit again.", submissionId: submission.id }, { status: 500 });
  }
  return NextResponse.json({ correct: true, submissionId: submission.id, paymentId: payment.id, requiresClaim: true, message: `Answer accepted. Confirm the ${ARC_NETWORK_CONFIG.label} claim transaction to continue.` });
}

async function submitV1(task: Record<string, any>, worker: string, answer: string) {
  try { assertGatewayAvailable(); }
  catch { return NextResponse.json({ error: "V1 Gateway payouts are unavailable on Arc Mainnet with the installed Circle SDK." }, { status: 503 }); }
  if (task.status !== "open") return NextResponse.json({ error: "Task is no longer open" }, { status: 409 });
  const isCorrect = answer.trim().toLowerCase() === String(task.correct_answer ?? "").trim().toLowerCase();
  if (!isCorrect) {
    const { data: result, error } = await supabase.rpc("record_rejected_task_submission", {
      p_task_id: task.id,
      p_worker_address: worker,
      p_answer: answer,
    });
    if (error) return NextResponse.json({ error: "Failed to record submission" }, { status: 500 });
    if (result?.outcome === "creator_self_submission") return NextResponse.json({ error: "You cannot submit an answer to a task you created." }, { status: 403 });
    if (result?.outcome === "invalid_input") return NextResponse.json({ error: "A valid wallet and answer are required" }, { status: 400 });
    if (result?.outcome === "archived") return NextResponse.json({ error: "This task is archived and cannot accept submissions" }, { status: 410 });
    if (result?.outcome === "closed") return NextResponse.json({ error: "Task is no longer open" }, { status: 409 });
    if (result?.outcome !== "recorded") return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json({ correct: false, submission: result.submission, message: "Incorrect answer" });
  }
  const { data: claimed, error: claimError } = await supabase.from("tasks").update({ status: "completed", updated_at: time() }).eq("id", task.id).eq("status", "open").is("archived_at", null).select("id").maybeSingle();
  if (claimError) return NextResponse.json({ error: "Unable to reserve this task" }, { status: 500 });
  if (!claimed) return NextResponse.json({ error: "Task is archived or has already been claimed" }, { status: 409 });
  const { data: submission, error: submissionError } = await supabase.from("submissions").insert({ task_id: task.id, worker_address: worker, answer, is_correct: true, status: "approved", verified_at: time() }).select().single();
  if (submissionError) return NextResponse.json({ error: "Task reserved but submission metadata needs repair" }, { status: 500 });
  const { data: payment, error: paymentError } = await supabase.from("task_payments").insert({ task_id: task.id, submission_id: submission.id, worker_address: worker, amount_usdc: task.reward_usdc, status: "pending", payment_mechanism: "circle_gateway" }).select().single();
  if (paymentError) return NextResponse.json({ error: "Task completed but payment record creation failed" }, { status: 500 });
  try {
    const payout = await payWorker(String(task.reward_usdc), worker as `0x${string}`, async (hash) => {
      const { error } = await supabase.from("task_payments").update({ status: "submitted", tx_hash: hash }).eq("id", payment.id).eq("status", "pending");
      if (error) throw error;
    });
    const { data: confirmed } = await supabase.from("task_payments").update({ status: "confirmed", tx_hash: payout.mintTxHash, completed_at: time() }).eq("id", payment.id).eq("status", "submitted").select().maybeSingle();
    return NextResponse.json({ submission, correct: true, message: "V1 Gateway payout completed", payment: confirmed, txHash: payout.mintTxHash });
  } catch (error) {
    const txHash = error && typeof error === "object" && "txHash" in error && typeof error.txHash === "string" ? error.txHash : null;
    await supabase.from("task_payments").update(txHash ? { status: "submitted", tx_hash: txHash } : { status: "failed" }).eq("id", payment.id).eq("status", "pending");
    return NextResponse.json({ error: txHash ? "Gateway payment was broadcast and needs reconciliation" : "V1 Gateway payment failed", txHash, requiresReconciliation: Boolean(txHash) }, { status: 502 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid task ID" }, { status: 400 });
  try {
    const body = await request.json();
    const requestedWorker = body?.worker_address;
    const answer = body?.answer;
    if (typeof requestedWorker !== "string" || !isAddress(requestedWorker, { strict: false }) || typeof answer !== "string" || answer.length > 1000 || !answer.trim()) {
      return NextResponse.json({ error: "A connected wallet and valid answer are required" }, { status: 400 });
    }
    const cookieStore = await cookies();
    const worker = getMatchingWorkerSessionAddress(
      cookieStore.get(WORKER_SESSION_COOKIE)?.value,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      requestedWorker,
    );
    if (!worker) {
      return NextResponse.json({ error: "Authorize the connected worker wallet before submitting" }, { status: 401 });
    }
    const { data: task, error } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
    if (error || !task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    if (task.archived_at) return NextResponse.json({ error: "This task is archived and cannot accept submissions" }, { status: 410 });
    const creatorError = getTaskCreatorSubmissionError(task.created_by, worker);
    if (creatorError === "invalid_creator") {
      return NextResponse.json({ error: "Task creator metadata is invalid" }, { status: 500 });
    }
    if (creatorError === "creator") {
      return NextResponse.json({ error: "You cannot submit an answer to a task you created." }, { status: 403 });
    }
    if (task.contract_version === "v2") return submitV2(task, id, worker, answer, body.claim_tx_hash, body.submission_id);
    return submitV1(task, worker, answer);
  } catch {
    return NextResponse.json({ error: `Unable to process submission. Check the task and ${ARC_NETWORK_CONFIG.label} status.` }, { status: 500 });
  }
}
