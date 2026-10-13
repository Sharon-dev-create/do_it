import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decodeEventLog, isAddress, isHex } from "viem";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";
import { ARC_CHAIN_ID, escrowPublicClient } from "@/lib/escrow-v2-server";
import { isConfirmedWorkerWithdrawalReceipt, verifyWorkerWithdrawalChallenge } from "@/lib/worker-withdrawal-auth";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const DEPLOYMENT_BLOCK = 66_340_107n;
const BLOCKS_PER_CHUNK = 2_000n;
const MAX_BLOCKS_PER_REQUEST = 20_000n;
const PAGE_SIZE = 25;

type PageCursor = { blockNumber: string; logIndex: number };

function parsePageCursor(value: unknown): PageCursor | null | undefined {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const cursor = value as Record<string, unknown>;
  if (typeof cursor.blockNumber !== "string" || !/^\d{1,20}$/.test(cursor.blockNumber) ||
      typeof cursor.logIndex !== "number" || !Number.isSafeInteger(cursor.logIndex) || cursor.logIndex < 0) return undefined;
  return { blockNumber: cursor.blockNumber, logIndex: cursor.logIndex };
}

function parseScanCursor(value: unknown): bigint | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^\d{1,20}$/.test(value)) return undefined;
  try { return BigInt(value); } catch { return undefined; }
}

async function getHistoryPage(workerAddress: string, cursor: PageCursor | null) {
  let query = supabase.from("worker_escrow_withdrawals")
    .select("worker_address, amount_base_units, chain_id, contract_address, tx_hash, log_index, block_number, block_timestamp, status, confirmed_at")
    .eq("worker_address", workerAddress)
    .eq("status", "confirmed");
  if (cursor) {
    query = query.or(`block_number.lt.${cursor.blockNumber},and(block_number.eq.${cursor.blockNumber},log_index.lt.${cursor.logIndex})`);
  }
  const { data, error } = await query
    .order("block_number", { ascending: false })
    .order("log_index", { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (error) throw error;
  return data ?? [];
}

async function indexConfirmedEvents(workerAddress: string, fromBlock: bigint, toBlock: bigint) {
  const logs = await escrowPublicClient.getContractEvents({
    address: DO_IT_ESCROW_ADDRESS,
    abi: DO_IT_ESCROW_ABI,
    eventName: "EarningsWithdrawn",
    args: { worker: workerAddress as `0x${string}` },
    fromBlock,
    toBlock,
  });

  const blockTimes = new Map<string, string>();
  const rows = [];
  for (const log of logs) {
    if (!log.transactionHash || log.blockNumber === null || log.logIndex === null ||
        log.args.worker.toLowerCase() !== workerAddress || log.args.amount <= 0n) continue;
    const receipt = await escrowPublicClient.getTransactionReceipt({ hash: log.transactionHash });
    if (receipt.status !== "success" || receipt.to?.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase()) continue;
    const receiptLog = receipt.logs.find((item) => item.logIndex === log.logIndex && item.address.toLowerCase() === DO_IT_ESCROW_ADDRESS.toLowerCase());
    if (!receiptLog) continue;

    let verifiedEvent;
    try {
      verifiedEvent = decodeEventLog({ abi: DO_IT_ESCROW_ABI, data: receiptLog.data, topics: receiptLog.topics, eventName: "EarningsWithdrawn" });
    } catch { continue; }
    if (verifiedEvent.args.worker.toLowerCase() !== workerAddress || verifiedEvent.args.amount !== log.args.amount ||
        !isConfirmedWorkerWithdrawalReceipt(receipt.status, true)) continue;

    const blockKey = log.blockNumber.toString();
    let blockTimestamp = blockTimes.get(blockKey);
    if (!blockTimestamp) {
      const block = await escrowPublicClient.getBlock({ blockNumber: log.blockNumber });
      blockTimestamp = new Date(Number(block.timestamp) * 1000).toISOString();
      blockTimes.set(blockKey, blockTimestamp);
    }
    rows.push({
      worker_address: workerAddress,
      amount_base_units: verifiedEvent.args.amount.toString(),
      chain_id: ARC_CHAIN_ID,
      contract_address: DO_IT_ESCROW_ADDRESS.toLowerCase(),
      tx_hash: log.transactionHash.toLowerCase(),
      log_index: log.logIndex,
      block_number: log.blockNumber.toString(),
      block_timestamp: blockTimestamp,
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
    });
  }

  if (rows.length) {
    const { error } = await supabase.from("worker_escrow_withdrawals").upsert(rows, {
      onConflict: "chain_id,contract_address,tx_hash,log_index",
      ignoreDuplicates: true,
    });
    if (error) throw error;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const workerAddressInput = body?.worker_address;
    const nonce = body?.nonce;
    const expiresAt = body?.expires_at;
    const signature = body?.signature;
    if (typeof workerAddressInput !== "string" || !isAddress(workerAddressInput, { strict: false }) ||
        typeof nonce !== "string" || !/^[0-9a-f]{64}$/.test(nonce) ||
        typeof expiresAt !== "string" || typeof signature !== "string" || !isHex(signature)) {
      return NextResponse.json({ error: "A valid wallet authorization is required" }, { status: 400 });
    }
    const workerAddress = workerAddressInput.toLowerCase();
    const { data: challenge } = await supabase.from("worker_withdrawal_auth_challenges")
      .select("nonce, worker_address, expires_at, consumed_at")
      .eq("nonce", nonce)
      .eq("worker_address", workerAddress)
      .maybeSingle();
    if (!challenge || challenge.consumed_at || challenge.expires_at !== expiresAt || Date.parse(challenge.expires_at) <= Date.now() ||
        !await verifyWorkerWithdrawalChallenge(workerAddressInput, nonce, expiresAt, signature as `0x${string}`)) {
      return NextResponse.json({ error: "Wallet authorization is invalid or expired" }, { status: 401 });
    }
    const { data: consumed } = await supabase.from("worker_withdrawal_auth_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("nonce", nonce)
      .eq("worker_address", workerAddress)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("nonce")
      .maybeSingle();
    if (!consumed) return NextResponse.json({ error: "Wallet authorization has already been used" }, { status: 401 });

    const cursor = parsePageCursor(body?.cursor);
    const requestedScanBlock = parseScanCursor(body?.scan_before_block);
    if (cursor === undefined || requestedScanBlock === undefined) return NextResponse.json({ error: "Invalid history pagination cursor" }, { status: 400 });

    const chainId = await escrowPublicClient.getChainId();
    if (chainId !== ARC_CHAIN_ID) return NextResponse.json({ error: "Arc Testnet RPC is misconfigured" }, { status: 503 });
    const latestBlock = await escrowPublicClient.getBlockNumber();
    let scanBeforeBlock = requestedScanBlock ?? latestBlock + 1n;
    if (scanBeforeBlock > latestBlock + 1n) return NextResponse.json({ error: "Invalid history scan cursor" }, { status: 400 });

    let page = await getHistoryPage(workerAddress, cursor);
    let scanned = 0n;
    while (page.length <= PAGE_SIZE && scanBeforeBlock > DEPLOYMENT_BLOCK && scanned < MAX_BLOCKS_PER_REQUEST) {
      const fromBlock = scanBeforeBlock - DEPLOYMENT_BLOCK > BLOCKS_PER_CHUNK
        ? scanBeforeBlock - BLOCKS_PER_CHUNK
        : DEPLOYMENT_BLOCK;
      const toBlock = scanBeforeBlock - 1n;
      await indexConfirmedEvents(workerAddress, fromBlock, toBlock);
      scanned += scanBeforeBlock - fromBlock;
      scanBeforeBlock = fromBlock;
      page = await getHistoryPage(workerAddress, cursor);
    }

    const hasMoreRows = page.length > PAGE_SIZE;
    const withdrawals = page.slice(0, PAGE_SIZE).map((row) => ({
      ...row,
      amount_base_units: String(row.amount_base_units),
      block_number: String(row.block_number),
      chain_id: Number(row.chain_id),
    }));
    const last = withdrawals.at(-1);
    return NextResponse.json({
      withdrawals,
      nextCursor: last ? { blockNumber: last.block_number, logIndex: last.log_index } : cursor,
      scanBeforeBlock: scanBeforeBlock.toString(),
      scanComplete: scanBeforeBlock <= DEPLOYMENT_BLOCK,
      hasMore: hasMoreRows || scanBeforeBlock > DEPLOYMENT_BLOCK,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Worker withdrawal history failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Unable to load confirmed withdrawal history" }, { status: 503 });
  }
}
