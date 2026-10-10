import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createPublicClient,
  http,
  type Hex,
  parseUnits,
} from "viem";
import { decodeEventLog } from "viem";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.network"],
    },
  },
} as const;

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http("https://rpc.testnet.arc.network"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // 1. Find the payment
    const { data: payment, error: paymentError } = await supabase
      .from("task_payments")
      .select("*")
      .eq("id", id)
      .single();

    if (paymentError || !payment) {
      return NextResponse.json(
        { error: "Payment not found" },
        { status: 404 },
      );
    }

    if (payment.payment_mechanism === "v2_reward_credit") {
      if (payment.status !== "submitted" || !payment.tx_hash) {
        return NextResponse.json({ error: "V2 credit has no submitted transaction to reconcile", payment }, { status: 409 });
      }
      const { data: task } = await supabase.from("tasks").select("id, contract_version, blockchain_task_id, created_by, reward_usdc").eq("id", payment.task_id).maybeSingle();
      if (!task || task.contract_version !== "v2") return NextResponse.json({ error: "V2 payment is not linked to a V2 task" }, { status: 409 });
      let receipt;
      try { receipt = await publicClient.getTransactionReceipt({ hash: payment.tx_hash as Hex }); }
      catch { return NextResponse.json({ payment, txHash: payment.tx_hash, status: "submitted", message: "Receipt is not available yet; do not retry or pay through Gateway.", requiresReconciliation: true }); }
      if (receipt.status === "reverted") {
        const { data: failed } = await supabase.from("task_payments").update({ status: "failed" }).eq("id", payment.id).eq("status", "submitted").select().maybeSingle();
        return NextResponse.json({ payment: failed ?? payment, txHash: payment.tx_hash, status: "failed", message: "Reward credit transaction reverted; it was not credited." });
      }
      const chainTaskId = BigInt(task.blockchain_task_id);
      let expectedReward: bigint;
      try { expectedReward = parseUnits(String(task.reward_usdc), 6); }
      catch { return NextResponse.json({ error: "Stored task reward is invalid" }, { status: 500 }); }
      const validLog = receipt.to?.toLowerCase() === DO_IT_ESCROW_ADDRESS.toLowerCase() && receipt.logs.some((log) => {
        if (log.address.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase()) return false;
        try {
          const parsed = decodeEventLog({ abi: DO_IT_ESCROW_ABI, data: log.data, topics: log.topics, eventName: "RewardCredited" });
          return parsed.args.taskId === chainTaskId && parsed.args.worker.toLowerCase() === payment.worker_address.toLowerCase() && parsed.args.amount === expectedReward;
        } catch { return false; }
      });
      if (!validLog) return NextResponse.json({ error: "Successful receipt did not contain the expected V2 RewardCredited event", payment, txHash: payment.tx_hash }, { status: 409 });
      const { data: confirmed, error: confirmError } = await supabase.from("task_payments").update({ status: "confirmed", completed_at: new Date().toISOString() }).eq("id", payment.id).eq("status", "submitted").select().maybeSingle();
      if (confirmError || !confirmed) return NextResponse.json({ error: "On-chain credit succeeded; database update needs reconciliation", txHash: payment.tx_hash }, { status: 500 });
      await supabase.from("tasks").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", task.id).eq("status", "claimed");
      await supabase.from("submissions").update({ status: "approved", verified_at: new Date().toISOString() }).eq("id", payment.submission_id);
      return NextResponse.json({ payment: confirmed, txHash: payment.tx_hash, status: "confirmed", mechanism: "v2_reward_credit", message: "Reward credited to the worker's on-chain earnings." });
    }

    const { data: linkedTask } = await supabase.from("tasks").select("contract_version").eq("id", payment.task_id).maybeSingle();
    if (linkedTask?.contract_version === "v2") {
      return NextResponse.json({ error: "V2 tasks require a V2 reward-credit payment record; generic Gateway reconciliation is disabled" }, { status: 409 });
    }

    // 2. Only submitted payments need reconciliation
    if (payment.status !== "submitted") {
      return NextResponse.json(
        {
          error: "Payment does not require reconciliation",
          payment,
        },
        { status: 409 },
      );
    }

    // 3. A submitted payment must have a transaction hash
    if (!payment.tx_hash) {
      return NextResponse.json(
        {
          error: "Submitted payment has no transaction hash",
          payment,
        },
        { status: 500 },
      );
    }

    const txHash = payment.tx_hash as Hex;

    // 4. Ask Arc for the transaction receipt
    let receipt;

    try {
      receipt = await publicClient.getTransactionReceipt({
        hash: txHash,
      });
    } catch (error) {
      // No receipt usually means the transaction has not been mined yet.
      // Do NOT mark it failed.
      console.log(
        "Transaction receipt not available yet:",
        txHash,
        error,
      );

      return NextResponse.json({
        payment,
        txHash,
        status: "submitted",
        message: "Transaction is still pending or receipt is temporarily unavailable",
        requiresReconciliation: true,
      });
    }

    // 5. Transaction was mined but reverted
    if (receipt.status === "reverted") {
      const { data: failedPayment, error: updateError } =
        await supabase
          .from("task_payments")
          .update({
            status: "failed",
          })
          .eq("id", payment.id)
          .eq("status", "submitted")
          .select()
          .single();

      if (updateError) {
        console.error(
          "Failed to mark reverted payment as failed:",
          updateError,
        );

        return NextResponse.json(
          {
            error: "Transaction reverted but payment state could not be updated",
            payment,
            txHash,
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        payment: failedPayment,
        txHash,
        status: "failed",
        message: "Transaction was mined but reverted",
        retryable: true,
      });
    }

    // 6. Transaction succeeded
    const { data: confirmedPayment, error: confirmError } =
      await supabase
        .from("task_payments")
        .update({
          status: "confirmed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", payment.id)
        .eq("status", "submitted")
        .select()
        .single();

    if (confirmError) {
      console.error(
        "Failed to mark payment as confirmed:",
        confirmError,
      );

      return NextResponse.json(
        {
          error:
            "Transaction succeeded but payment record could not be updated",
          payment,
          txHash,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ 
      payment: confirmedPayment,
      txHash,
      status: "confirmed",
      message: "Payment successfully reconciled",
      retryable: false,
    });
  } catch (error) {
    console.error("Payment reconciliation error:", error);

    return NextResponse.json(
      {
        error: "Failed to reconcile payment",
      },
      { status: 500 },
    );
  }
}
