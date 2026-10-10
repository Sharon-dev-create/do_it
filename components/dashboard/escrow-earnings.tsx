"use client";

import { useState } from "react";
import { decodeEventLog, formatUnits, isAddress, parseUnits } from "viem";
import { useAccount, useReadContract, usePublicClient, useWriteContract } from "wagmi";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";

const explorer = "https://testnet.arcscan.app";

export function EscrowEarnings() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const { data: balance, isLoading, error: readError, refetch } = useReadContract({
    address: DO_IT_ESCROW_ADDRESS,
    abi: DO_IT_ESCROW_ABI,
    functionName: "availableBalance",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && chainId === 5042002), refetchInterval: 12_000, refetchOnWindowFocus: true },
  });

  async function withdraw() {
    setError(""); setTxHash(null);
    if (!address || !isAddress(address)) return setError("Connect a valid worker wallet first.");
    if (chainId !== 5042002) return setError("Switch your wallet to Arc Testnet.");
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
    {!address ? <p className="mt-4 text-sm text-muted-foreground">Connect your worker wallet to read escrow earnings.</p> : chainId !== 5042002 ? <p className="mt-4 text-sm text-amber-700">Switch to Arc Testnet to read and withdraw V2 earnings.</p> : null}
    {readError && <p className="mt-3 text-sm text-red-600">Unable to read your V2 escrow balance. Check the Arc Testnet RPC.</p>}
    {isLoading && <p className="mt-3 text-sm text-muted-foreground">Loading escrow balance…</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      <input aria-label="USDC amount to withdraw" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Amount (USDC)" className="h-10 w-44 rounded-md border bg-background px-3 text-sm" disabled={busy || isPending || !address || chainId !== 5042002} />
      <button type="button" onClick={withdraw} disabled={busy || isPending || !address || chainId !== 5042002} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy || isPending ? "Withdrawing…" : "Withdraw earnings"}</button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    {txHash && <p className="mt-3 text-sm">Withdrawal transaction: <a className="underline" href={`${explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">{txHash}</a></p>}
  </section>;
}
