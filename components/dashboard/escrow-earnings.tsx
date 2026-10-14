"use client";

import { useEffect, useRef, useState } from "react";
import { decodeEventLog, formatUnits, isAddress, parseUnits } from "viem";
import { useAccount, useReadContract, usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";
import { getWorkerWithdrawalEventKey, meetsWorkerWithdrawalMinimum } from "@/lib/worker-withdrawal-auth";

const explorer = "https://testnet.arcscan.app";
const ARC_TESTNET_CHAIN_ID = 5042002;
const PAGE_SIZE = 25;

type WithdrawalHistoryItem = {
  worker_address: string;
  amount_base_units: string;
  chain_id: number;
  contract_address: string;
  tx_hash: string;
  log_index: number;
  block_number: string;
  block_timestamp: string;
  status: string;
  confirmed_at: string;
};

type HistoryCursor = { blockNumber: string; logIndex: number };

export function EscrowEarnings() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync, isPending } = useWriteContract();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [history, setHistory] = useState<WithdrawalHistoryItem[]>([]);
  const [historyWallet, setHistoryWallet] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyCursor, setHistoryCursor] = useState<HistoryCursor | null>(null);
  const [scanBeforeBlock, setScanBeforeBlock] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const historyRequestId = useRef(0);
  const historyRequestInFlight = useRef(false);
  const connectedWallet = useRef(address?.toLowerCase() ?? null);
  connectedWallet.current = address?.toLowerCase() ?? null;
  const { data: balance, isLoading, error: readError, refetch } = useReadContract({
    address: DO_IT_ESCROW_ADDRESS,
    abi: DO_IT_ESCROW_ABI,
    functionName: "availableBalance",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && chainId === 5042002), refetchInterval: 12_000, refetchOnWindowFocus: true },
  });

  useEffect(() => {
    historyRequestId.current += 1;
    historyRequestInFlight.current = false;
    setHistoryLoading(false);
    setHistory([]);
    setHistoryWallet(null);
    setHistoryLoaded(false);
    setHistoryCursor(null);
    setScanBeforeBlock(null);
    setHistoryHasMore(false);
    setHistoryError("");
  }, [address]);

  async function loadHistoryPage(options: { cursor: HistoryCursor | null; scanBeforeBlock: string | null; reset: boolean }) {
    if (historyRequestInFlight.current) return;
    if (!address || !isAddress(address, { strict: false })) {
      setHistoryError("Connect a valid worker wallet to authorize history access.");
      return;
    }
    const requestedWallet = address.toLowerCase();
    const requestId = ++historyRequestId.current;
    historyRequestInFlight.current = true;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const challengeResponse = await fetch("/api/worker/withdrawals/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_address: address }),
      });
      const challenge = await challengeResponse.json();
      if (!challengeResponse.ok) throw new Error(challenge.error || "Could not authorize this wallet.");
      if (historyRequestId.current !== requestId || connectedWallet.current !== requestedWallet) return;
      const signature = await signMessageAsync({ message: challenge.message });
      if (historyRequestId.current !== requestId || connectedWallet.current !== requestedWallet) return;
      const response = await fetch("/api/worker/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worker_address: address,
          nonce: challenge.nonce,
          expires_at: challenge.expiresAt,
          signature,
          cursor: options.cursor,
          scan_before_block: options.scanBeforeBlock,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load confirmed withdrawal history.");
      if (historyRequestId.current !== requestId || connectedWallet.current !== requestedWallet) return;
      const nextRows = data.withdrawals as WithdrawalHistoryItem[];
      setHistory((current) => {
        const base = options.reset || historyWallet?.toLowerCase() !== requestedWallet ? [] : current;
        const rowsByKey = new Map(base.map((row) => [getWorkerWithdrawalEventKey({ chainId: row.chain_id, contractAddress: row.contract_address, transactionHash: row.tx_hash, logIndex: row.log_index }), row]));
        for (const row of nextRows) {
          rowsByKey.set(getWorkerWithdrawalEventKey({ chainId: row.chain_id, contractAddress: row.contract_address, transactionHash: row.tx_hash, logIndex: row.log_index }), row);
        }
        return [...rowsByKey.values()].sort((a, b) => BigInt(a.block_number) === BigInt(b.block_number)
          ? b.log_index - a.log_index
          : BigInt(a.block_number) > BigInt(b.block_number) ? -1 : 1);
      });
      setHistoryWallet(requestedWallet);
      setHistoryLoaded(true);
      setHistoryCursor(data.nextCursor ?? options.cursor);
      setScanBeforeBlock(data.scanBeforeBlock ?? options.scanBeforeBlock);
      setHistoryHasMore(Boolean(data.hasMore));
    } catch (cause) {
      if (historyRequestId.current === requestId && connectedWallet.current === requestedWallet) {
        setHistoryError(cause instanceof Error ? cause.message : "Unable to load withdrawal history.");
      }
    } finally {
      if (historyRequestId.current === requestId) {
        historyRequestInFlight.current = false;
        setHistoryLoading(false);
      }
    }
  }

  async function withdraw() {
    setError(""); setTxHash(null);
    if (!address || !isAddress(address)) return setError("Connect a valid worker wallet first.");
    if (chainId !== ARC_TESTNET_CHAIN_ID) return setError("Switch your wallet to Arc Testnet.");
    if (!publicClient) return setError("Arc Testnet RPC is unavailable.");
    let units: bigint;
    try { units = parseUnits(amount, 6); } catch { return setError("Enter a valid USDC amount with up to six decimals."); }
    if (units <= 0n) return setError("Withdrawal amount must be greater than zero.");
    if (typeof balance !== "bigint" || units > balance) return setError("Amount exceeds your available escrow earnings.");
    setBusy(true);
    try {
      const hash = await writeContractAsync({ address: DO_IT_ESCROW_ADDRESS, abi: DO_IT_ESCROW_ABI, functionName: "withdraw", args: [units], chainId: 5042002 });
      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Withdrawal transaction reverted.");
      const eventFound = receipt.logs.some((log) => {
        if (log.address.toLowerCase() !== DO_IT_ESCROW_ADDRESS.toLowerCase()) return false;
        try {
          const event = decodeEventLog({ abi: DO_IT_ESCROW_ABI, data: log.data, topics: log.topics, eventName: "EarningsWithdrawn" });
          return event.args.worker.toLowerCase() === address.toLowerCase() && event.args.amount === units;
        } catch { return false; }
      });
      if (!eventFound) throw new Error("Receipt did not contain the expected EarningsWithdrawn event.");
      try {
        const recordResponse = await fetch("/api/worker/withdrawals/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transaction_hash: hash }),
        });
        if (recordResponse.ok) {
          const recordData = await recordResponse.json();
          const recorded = recordData.withdrawals as WithdrawalHistoryItem[];
          if (historyLoaded && historyWallet?.toLowerCase() === address.toLowerCase()) {
            setHistory((current) => {
              const rows = new Map(current.map((row) => [getWorkerWithdrawalEventKey({ chainId: row.chain_id, contractAddress: row.contract_address, transactionHash: row.tx_hash, logIndex: row.log_index }), row]));
              for (const row of recorded) rows.set(getWorkerWithdrawalEventKey({ chainId: row.chain_id, contractAddress: row.contract_address, transactionHash: row.tx_hash, logIndex: row.log_index }), row);
              return [...rows.values()].sort((a, b) => BigInt(a.block_number) === BigInt(b.block_number)
                ? b.log_index - a.log_index
                : BigInt(a.block_number) > BigInt(b.block_number) ? -1 : 1);
            });
          }
        }
      } catch { console.error("Verified withdrawal will be indexed the next time history is loaded."); }
      setAmount("");
      await refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Withdrawal failed. Check your wallet and Arc Testnet connection.");
    } finally { setBusy(false); }
  }

  return <section className="mb-6 rounded-xl border bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="font-semibold">V2 escrow earnings</h2>
        <p className="mt-1 text-sm text-muted-foreground">Withdrawable USDC credited by verified V2 tasks. Separate from Circle Gateway balance.</p>
      </div>
      <div className="text-right">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Available</p>
        <p className="text-2xl font-semibold">{address && chainId === 5042002 && typeof balance === "bigint" ? formatUnits(balance, 6) : "—"} <span className="text-sm">USDC</span></p>
      </div>
    </div>
    {!address ? <p className="mt-4 text-sm text-muted-foreground">Connect your worker wallet to read escrow earnings.</p> : chainId !== ARC_TESTNET_CHAIN_ID ? <p className="mt-4 text-sm text-[var(--doit-brand-warning)]">Switch to Arc Testnet to read and withdraw V2 earnings.</p> : null}
    {address && chainId === ARC_TESTNET_CHAIN_ID && typeof balance === "bigint" && <div className="mt-3 text-sm">
      <span className="font-medium">$1.00 app withdrawal eligibility: </span>
      <span>{meetsWorkerWithdrawalMinimum(balance) ? "Eligible" : "Not yet eligible"}</span>
      <p className="mt-1 text-xs text-muted-foreground">Display indicator only in this phase. The existing contract accepts any positive withdrawal amount.</p>
    </div>}
    {readError && <p className="mt-3 text-sm text-[var(--doit-brand-error)]">Unable to read your V2 escrow balance. Check the Arc Testnet RPC.</p>}
    {isLoading && <p className="mt-3 text-sm text-muted-foreground">Loading escrow balance…</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      <input aria-label="USDC amount to withdraw" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount (USDC)" className="h-10 w-44 rounded-md border bg-background px-3 text-sm" disabled={busy || isPending || !address || chainId !== 5042002} />
      <button type="button" onClick={withdraw} disabled={busy || isPending || !address || chainId !== 5042002} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy || isPending ? "Withdrawing…" : "Withdraw earnings"}</button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-[var(--doit-brand-error)]">{error}</p>}
    {txHash && <p className="mt-3 text-sm">Withdrawal transaction: <a className="underline" href={`${explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">{txHash}</a></p>}
    <div className="mt-5 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">Confirmed withdrawal history</h3>
        {!historyLoaded || historyWallet?.toLowerCase() !== address?.toLowerCase()
          ? <button type="button" onClick={() => loadHistoryPage({ cursor: null, scanBeforeBlock: null, reset: true })} disabled={!address || historyLoading} className="rounded-md border px-3 py-2 text-sm disabled:opacity-50">{historyLoading ? "Verifying wallet…" : "Verify wallet and load history"}</button>
          : historyHasMore && <button type="button" onClick={() => loadHistoryPage({ cursor: historyCursor, scanBeforeBlock, reset: false })} disabled={historyLoading} className="rounded-md border px-3 py-2 text-sm disabled:opacity-50">{historyLoading ? "Loading…" : "Load older history"}</button>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">A wallet signature authorizes a read of this wallet’s history only. Event indexing scans stop 12 blocks behind the chain head. Receipts are checked against the current canonical block when recorded, but later reorganizations are not automatically reconciled.</p>
      {historyError && <p role="alert" className="mt-3 text-sm text-[var(--doit-brand-error)]">{historyError}</p>}
      {historyLoaded && historyWallet?.toLowerCase() === address?.toLowerCase() && (
        history.length ? <ul className="mt-3 divide-y rounded-md border">
          {history.filter((item) => item.status === "confirmed").map((item) => <li key={getWorkerWithdrawalEventKey({ chainId: item.chain_id, contractAddress: item.contract_address, transactionHash: item.tx_hash, logIndex: item.log_index })} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <span>{formatUnits(BigInt(item.amount_base_units), 6)} USDC</span>
            <span className="text-xs text-muted-foreground">{new Date(item.block_timestamp).toLocaleString()}</span>
            <a className="font-mono text-xs underline" href={`${explorer}/tx/${item.tx_hash}`} target="_blank" rel="noreferrer">{item.tx_hash.slice(0, 10)}…{item.tx_hash.slice(-8)}</a>
          </li>)}
        </ul> : <p className="mt-3 text-sm text-muted-foreground">No confirmed V2 escrow withdrawals found.</p>
      )}
      {historyLoaded && historyHasMore && <p className="mt-2 text-xs text-muted-foreground">Showing up to {PAGE_SIZE} records per page.</p>}
    </div>
  </section>;
}
