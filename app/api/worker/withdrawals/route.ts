import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decodeEventLog, isAddress, isHex } from "viem";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";
import { ARC_CHAIN_ID, assertArcEscrowDeployment, escrowPublicClient } from "@/lib/escrow-v2-server";
import { ARC_NETWORK_CONFIG } from "@/lib/arc-network";
import {
  isConfirmedWorkerWithdrawalReceipt,
  isWorkerWithdrawalCursorInRange,
  isValidWorkerWithdrawalDeployment,
  isWorkerWithdrawalChallengeCurrent,
  parseWorkerWithdrawalPageCursor,
  parseWorkerWithdrawalScanCursor,
  verifyWorkerWithdrawalChallenge,
} from "@/lib/worker-withdrawal-auth";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const DEPLOYMENT_BLOCK = ARC_NETWORK_CONFIG.name === "mainnet"
  ? BigInt(process.env.ARC_MAINNET_DEPLOYMENT_BLOCK!)
  : 66_340_107n;
const BLOCKS_PER_CHUNK = 2_000n;
const MAX_BLOCKS_PER_REQUEST = 20_000n;
const INDEXING_CONFIRMATIONS = 12n;
const PAGE_SIZE = 25;

type PageCursor = NonNullable<ReturnType<typeof parseWorkerWithdrawalPageCursor>>;

async function getHistoryPage(workerAddress: string, cursor: PageCursor | null) {
  let query = supabase.from("worker_escrow_withdrawals")
    .select("worker_address, amount_base_units, chain_id, contract_address, tx_hash, log_index, block_number, block_timestamp, status, confirmed_at")
    .eq("worker_address", workerAddress)
    .eq("chain_id", ARC_CHAIN_ID)
    .eq("contract_address", DO_IT_ESCROW_ADDRESS.toLowerCase())
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
    if (!log.transactionHash || log.blockNumber === null || log.logIndex === null || !log.args.worker || log.args.amount === undefined ||
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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "A valid wallet authorization is required" }, { status: 400 });
    }
    const workerAddressInput = body?.worker_address;
    const nonce = body?.nonce;
    const expiresAt = body?.expires_at;
    const signature = body?.signature;
    if (typeof workerAddressInput !== "string" || !isAddress(workerAddressInput, { strict: false }) ||
        typeof nonce !== "string" || !/^[0-9a-f]{64}$/.test(nonce) ||
        typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt)) ||
        typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature) || !isHex(signature)) {
      return NextResponse.json({ error: "A valid wallet authorization is required" }, { status: 400 });
    }
    const cursor = parseWorkerWithdrawalPageCursor(body.cursor);
    const requestedScanBlock = parseWorkerWithdrawalScanCursor(body.scan_before_block);
    if (cursor === undefined || requestedScanBlock === undefined) return NextResponse.json({ error: "Invalid history pagination cursor" }, { status: 400 });

    if (!isValidWorkerWithdrawalDeployment(DO_IT_ESCROW_ADDRESS, ARC_CHAIN_ID, ARC_CHAIN_ID)) {
      return NextResponse.json({ error: "V2 escrow deployment is misconfigured" }, { status: 503 });
    }
    await assertArcEscrowDeployment();
    const chainId = await escrowPublicClient.getChainId();
    if (chainId !== ARC_CHAIN_ID) return NextResponse.json({ error: `${ARC_NETWORK_CONFIG.label} RPC is misconfigured` }, { status: 503 });
    const latestBlock = await escrowPublicClient.getBlockNumber();
    const stableHead = latestBlock > INDEXING_CONFIRMATIONS ? latestBlock - INDEXING_CONFIRMATIONS : 0n;
    let scanBeforeBlock = requestedScanBlock ?? stableHead + 1n;
    if (!isWorkerWithdrawalCursorInRange(scanBeforeBlock, cursor, DEPLOYMENT_BLOCK, stableHead)) {
      return NextResponse.json({ error: "Invalid history pagination cursor" }, { status: 400 });
    }
    const workerAddress = workerAddressInput.toLowerCase();
    const { data: challenge, error: challengeError } = await supabase.from("worker_withdrawal_auth_challenges")
      .select("nonce, worker_address, expires_at, consumed_at")
      .eq("nonce", nonce)
      .eq("worker_address", workerAddress)
      .maybeSingle();
    if (challengeError) {
      console.error("Worker withdrawal challenge lookup failed", challengeError.code ?? "DatabaseError");
      return NextResponse.json({ error: "Unable to verify wallet authorization" }, { status: 503 });
    }
    if (!isWorkerWithdrawalChallengeCurrent(challenge, workerAddress, expiresAt) ||
        !await verifyWorkerWithdrawalChallenge(workerAddressInput, nonce, expiresAt, signature as `0x${string}`)) {
      return NextResponse.json({ error: "Wallet authorization is invalid or expired" }, { status: 401 });
    }
    const { data: consumed, error: consumeError } = await supabase.from("worker_withdrawal_auth_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("nonce", nonce)
      .eq("worker_address", workerAddress)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("nonce")
      .maybeSingle();
    if (consumeError) {
      console.error("Worker withdrawal challenge consumption failed", consumeError.code ?? "DatabaseError");
      return NextResponse.json({ error: "Unable to authorize withdrawal history access" }, { status: 503 });
    }
    if (!consumed) return NextResponse.json({ error: "Wallet authorization has already been used" }, { status: 401 });

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
