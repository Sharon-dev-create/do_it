import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decodeEventLog, isHash } from "viem";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";
import { ARC_CHAIN_ID, escrowPublicClient } from "@/lib/escrow-v2-server";
import { isConfirmedWorkerWithdrawalReceipt } from "@/lib/worker-withdrawal-auth";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const transactionHash = body?.transaction_hash;
    if (typeof transactionHash !== "string" || !isHash(transactionHash)) {
      return NextResponse.json({ error: "A valid withdrawal transaction hash is required" }, { status: 400 });
    }
    if (await escrowPublicClient.getChainId() !== ARC_CHAIN_ID) {
      return NextResponse.json({ error: "Arc Testnet RPC is misconfigured" }, { status: 503 });
    }

    const txHash = transactionHash.toLowerCase();
    const transaction = await escrowPublicClient.getTransaction({ hash: txHash as `0x${string}` });
    if (transaction.to?.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase()) {
      return NextResponse.json({ error: "Transaction is not a call to the V2 escrow" }, { status: 409 });
    }

    let receipt;
    try { receipt = await escrowPublicClient.getTransactionReceipt({ hash: txHash as `0x${string}` }); }
    catch {
      return NextResponse.json({ status: "submitted", recorded: false, message: "Withdrawal receipt is not confirmed yet." }, { status: 202 });
    }
    if (receipt.status !== "success") {
      return NextResponse.json({ status: "failed", recorded: false, message: "Withdrawal transaction reverted." }, { status: 409 });
    }

    const matchingEvents = [];
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase()) continue;
      try {
        const event = decodeEventLog({ abi: DO_IT_ESCROW_ABI, data: log.data, topics: log.topics, eventName: "EarningsWithdrawn" });
        if (event.args.worker.toLowerCase() === transaction.from.toLowerCase() && event.args.amount > 0n && log.logIndex !== undefined) {
          matchingEvents.push({ worker: event.args.worker.toLowerCase(), amount: event.args.amount, logIndex: log.logIndex });
        }
      } catch { /* Ignore unrelated escrow logs. */ }
    }
    if (!isConfirmedWorkerWithdrawalReceipt(receipt.status, matchingEvents.length > 0)) {
      return NextResponse.json({ error: "Successful receipt did not contain a matching EarningsWithdrawn event" }, { status: 409 });
    }

    const block = await escrowPublicClient.getBlock({ blockNumber: receipt.blockNumber });
    const blockTimestamp = new Date(Number(block.timestamp) * 1000).toISOString();
    const recordedAt = new Date().toISOString();
    const rows = matchingEvents.map((event) => ({
      worker_address: event.worker,
      amount_base_units: event.amount.toString(),
      chain_id: ARC_CHAIN_ID,
      contract_address: DO_IT_ESCROW_ADDRESS.toLowerCase(),
      tx_hash: txHash,
      log_index: event.logIndex,
      block_number: receipt.blockNumber.toString(),
      block_timestamp: blockTimestamp,
      status: "confirmed",
      confirmed_at: recordedAt,
    }));
    const { error: insertError } = await supabase.from("worker_escrow_withdrawals").upsert(rows, {
      onConflict: "chain_id,contract_address,tx_hash,log_index",
      ignoreDuplicates: true,
    });
    if (insertError) throw insertError;

    const { data: history, error: readError } = await supabase.from("worker_escrow_withdrawals")
      .select("worker_address, amount_base_units, chain_id, contract_address, tx_hash, log_index, block_number, block_timestamp, status, confirmed_at")
      .eq("chain_id", ARC_CHAIN_ID)
      .eq("contract_address", DO_IT_ESCROW_ADDRESS.toLowerCase())
      .eq("tx_hash", txHash)
      .order("log_index", { ascending: true });
    if (readError) throw readError;
    return NextResponse.json({ withdrawals: (history ?? []).map((row) => ({
      ...row,
      amount_base_units: String(row.amount_base_units),
      chain_id: Number(row.chain_id),
      block_number: String(row.block_number),
    })) });
  } catch (error) {
    console.error("Confirmed worker withdrawal recording failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Unable to verify or record this withdrawal" }, { status: 503 });
  }
}
