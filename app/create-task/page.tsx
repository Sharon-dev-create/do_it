"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { decodeEventLog, parseUnits } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";
import { ARC_TESTNET_USDC, ERC20_ABI } from "@/lib/contracts/usdc";

async function waitForArcReceipt(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  hash: `0x${string}`,
) {
  const timeouts = 180_000; // 2 minutes
  const pollingMs = 3_000; // 3 seconds
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeouts) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash });

      if (receipt.status !== "success") {
        throw new Error("The transaction was reverted on Arc.");
      }

      return receipt;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("reverted on Arc")
      ) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, pollingMs));
    }
  }

  throw new Error(
    `Arc transaction was submitted but its receipt was not available after ${timeouts / 1000} seconds. Transaction: ${hash}`,
  );
}

export default function CreateTaskPage() {
  const router = useRouter();
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rewardUsdc, setRewardUsdc] = useState("10");
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [fundedRecovery, setFundedRecovery] = useState<{ taskId: string; createTxHash: `0x${string}`; fundTxHash: `0x${string}` } | null>(null);

  async function retryMetadataSave() {
    if (!fundedRecovery || !address) return;
    setIsSubmitting(true);
    setError("");
    setProgress("Reconciling the already funded task metadata...");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(), description: description.trim(), reward_usdc: rewardUsdc,
          correct_answer: correctAnswer.trim(), created_by: address,
          blockchain_task_id: fundedRecovery.taskId, create_tx_hash: fundedRecovery.createTxHash,
          fund_tx_hash: fundedRecovery.fundTxHash,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.task?.id) throw new Error(payload.error || "Metadata reconciliation is still pending.");
      router.push(`/tasks/${payload.task.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Metadata reconciliation failed. Keep the original transaction hashes.");
    } finally { setIsSubmitting(false); setProgress(""); }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!isConnected || !address) {
      setError("Connect your wallet before creating a task.");
      return;
    }

    if (!publicClient) {
      setError("The Arc Testnet blockchain client is unavailable. Refresh and try again.");
      return;
    }

    if (chainId !== 5042002) {
      setError("Switch your wallet to Arc Testnet before creating a task.");
      return;
    }

    if (title.trim().length < 3 || description.trim().length < 10 || !correctAnswer.trim()) {
      setError("Enter a title (at least 3 characters), a useful description (at least 10 characters), and the answer.");
      return;
    }
    if (!/^\d+(\.\d{1,6})?$/.test(rewardUsdc) || Number(rewardUsdc) <= 0) {
      setError("Enter a positive USDC reward with no more than six decimal places.");
      return;
    }

    setIsSubmitting(true);
    setProgress("");
    let stage = "Creating task on Arc";
    let createTxHash: `0x${string}` | undefined;
    let fundTxHash: `0x${string}` | undefined;
    let blockchainTaskId: bigint | undefined;
    let fundingConfirmed = false;

    try {
      const reward = parseUnits(rewardUsdc, 6);
      if (reward > 99_999_999_999_999_999_999n) {
        throw new Error("Reward exceeds the supported 14-digit USDC maximum.");
      }

      setProgress("Creating task on Arc...");
      createTxHash = await writeContractAsync({
        address: DO_IT_ESCROW_ADDRESS,
        abi: DO_IT_ESCROW_ABI,
        functionName: "createTask",
        args: [reward],
        chainId: 5042002,
      });
      const createReceipt = await publicClient.waitForTransactionReceipt({
        hash: createTxHash,
      });

      if (createReceipt.status !== "success") {
        throw new Error("The create transaction was reverted.");
      }

      const createdLog = createReceipt.logs
        .filter((log) => log.address.toLowerCase() === DO_IT_ESCROW_ADDRESS.toLowerCase())
        .map((log) => {
          try {
            return decodeEventLog({
              abi: DO_IT_ESCROW_ABI,
              data: log.data,
              topics: log.topics,
              eventName: "TaskCreated",
            });
          } catch {
            return null;
          }
        })
        .find((eventLog) => eventLog !== null);

      if (!createdLog) {
        throw new Error("The create transaction succeeded, but its TaskCreated event was not found.");
      }
      blockchainTaskId = createdLog.args.taskId;

      stage = "Approving USDC";
      setProgress("Approving USDC...");
      const approvalTxHash = await writeContractAsync({
        address: ARC_TESTNET_USDC,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [DO_IT_ESCROW_ADDRESS, reward],
        chainId: 5042002,
      });

      const approvalReceipt = await publicClient.waitForTransactionReceipt({
        hash: approvalTxHash,
      });
      if (approvalReceipt.status !== "success") {
        throw new Error("The USDC approval transaction was reverted.");
      }

      stage = "Funding task";
      setProgress("Funding task...");
      fundTxHash = await writeContractAsync({
        address: DO_IT_ESCROW_ADDRESS,
        abi: DO_IT_ESCROW_ABI,
        functionName: "fundTask",
        args: [blockchainTaskId],
        chainId: 5042002,
      });
      const fundReceipt = await publicClient.waitForTransactionReceipt({
        hash: fundTxHash,
      });
      if (fundReceipt.status !== "success") {
        throw new Error("The funding transaction was reverted.");
      }
      fundingConfirmed = true;

      stage = "Saving task";
      setProgress("Saving task...");
      if (!isConnected || !address) {
        setError("Connect your wallet before creating a task.");
        setIsSubmitting(false);
        return;
      }

      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          reward_usdc: rewardUsdc,
          correct_answer: correctAnswer.trim(),
          created_by: address,
          blockchain_task_id: blockchainTaskId.toString(),
          create_tx_hash: createTxHash,
          fund_tx_hash: fundTxHash,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(`On-chain task was created and funded, but its metadata could not be saved. Do not create or fund it again. Recovery details: task ID ${blockchainTaskId}; create tx ${createTxHash}; funding tx ${fundTxHash}. ${payload.error || "Contact support to reconcile this task."}`);
      }

      const savedTaskId = payload.task?.id;
      if (savedTaskId) {
        router.push(`/tasks/${savedTaskId}`);
        return;
      }

      router.push("/dashboard");
    } catch (submitError) {
      if (fundingConfirmed && blockchainTaskId !== undefined && createTxHash && fundTxHash) {
        setFundedRecovery({ taskId: blockchainTaskId.toString(), createTxHash, fundTxHash });
      }
      const details = submitError instanceof Error ? submitError.message : "Unknown error.";
      setError(
        `${stage} failed: ${details}${blockchainTaskId !== undefined && fundTxHash ? ` Recovery details: task ID ${blockchainTaskId}; create tx ${createTxHash}; funding tx ${fundTxHash}. Do not create or fund another task.` : ""}`,
      );
    } finally {
      setIsSubmitting(false);
      setProgress("");
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f3f1] text-[#111111]">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-10 flex items-center justify-between gap-4">
          <Link href="/" className="text-lg font-semibold tracking-[0.2em] text-[#111111]">
            DO-IT<span className="text-[#e87513]">.</span>
          </Link>
          <Link href="/dashboard" className="rounded-full border border-[#d7d5d3] px-4 py-2 text-sm text-[#111111] hover:border-[#111111]">
            Back to dashboard
          </Link>
        </header>

        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[28px] border border-[#e0dfdd] bg-white p-6 shadow-[0_18px_50px_rgba(17,17,17,0.04)] sm:p-8">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.25em] text-[#6e6b68]">
              Mission intake
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Create a new task
            </h1>
            <p className="mt-3 max-w-xl text-sm text-[#585653]">
              Define a task, set the reward, and route it to the worker network.
            </p>
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Arc Testnet V2 is restricted to configured test workers. The contract still allows any wallet to claim directly, so this restriction does not make it safe for a public marketplace.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-6">
              <div className="rounded-2xl border border-[#e0dfdd] bg-[#faf9f8] p-4">
                <p className="mb-3 text-sm font-medium">Creator wallet</p>
                <ConnectButton />
                {isConnected && address ? (
                  <p className="mt-3 break-all text-xs text-[#585653]">
                    Connected: {address}
                  </p>
                ) : (
                  <p className="mt-3 text-xs text-[#585653]">
                    Connect your wallet to create and fund a task.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="title" className="mb-2 block text-sm font-medium text-[#111111]">
                  Task title
                </label>
                <input
                  id="title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Give your task a clear title"
                  className="w-full rounded-xl border border-[#d8d6d4] bg-[#faf9f8] px-4 py-3 text-sm outline-none transition focus:border-[#111111]"
                  required
                />
              </div>

              <div>
                <label htmlFor="description" className="mb-2 block text-sm font-medium text-[#111111]">
                  Description
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={6}
                  placeholder="Describe expected work, deliverables, and verification criteria."
                  className="w-full rounded-xl border border-[#d8d6d4] bg-[#faf9f8] px-4 py-3 text-sm outline-none transition focus:border-[#111111]"
                  required
                />
              </div>

              <div>
                <label htmlFor="reward" className="mb-2 block text-sm font-medium text-[#111111]">
                  Reward (USDC)
                </label>
                <input
                  id="reward"
                  type="number"
                  min="0"
                  step="0.000001"
                  value={rewardUsdc}
                  onChange={(event) => setRewardUsdc(event.target.value)}
                  className="w-full rounded-xl border border-[#d8d6d4] bg-[#faf9f8] px-4 py-3 text-sm outline-none transition focus:border-[#111111]"
                  required
                />
              </div>

              <div>
                <label htmlFor="correctAnswer" className="mb-2 block text-sm font-medium text-[#111111]">
                  Correct answer
                </label>
                <input
                  id="correctAnswer"
                  value={correctAnswer}
                  onChange={(event) => setCorrectAnswer(event.target.value)}
                  placeholder="Expected answer or verification value"
                  className="w-full rounded-xl border border-[#d8d6d4] bg-[#faf9f8] px-4 py-3 text-sm outline-none transition focus:border-[#111111]"
                  required
                />
              </div>

              {error ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </p>
              ) : null}

              {progress ? (
                <p role="status" className="text-sm text-[#585653]">
                  {progress}
                </p>
              ) : null}

              {fundedRecovery && <div role="status" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p>The on-chain task is already funded. Do not create or fund another task. Recovery uses the original task ID {fundedRecovery.taskId} and transaction hashes.</p><button type="button" disabled={isSubmitting} onClick={retryMetadataSave} className="rounded-full bg-[#111111] px-4 py-2 text-white disabled:opacity-60">{isSubmitting ? "Reconciling..." : "Retry metadata save"}</button></div>}

              <div className="flex items-center justify-between gap-4 pt-2">
                <Link href="/" className="text-sm text-[#585653] hover:text-[#111111]">
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={isSubmitting || !isConnected || Boolean(fundedRecovery)}
                  className="rounded-full bg-[#111111] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#2e2d2b] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Creating..." : "Create task"}
                </button>
              </div>
            </form>
          </section>

          <aside className="rounded-[28px] border border-[#e0dfdd] bg-[#111111] p-6 text-[#f4f3f1] sm:p-8">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-[#c9c7c4]">
              Route summary
            </p>
            <div className="mt-8 space-y-6">
              <div>
                <p className="text-sm text-[#bdb9b4]">Task intake</p>
                <p className="mt-2 text-2xl font-semibold">Open mission</p>
              </div>
              <div>
                <p className="text-sm text-[#bdb9b4]">Verification</p>
                <p className="mt-2 text-2xl font-semibold">AI + worker checks</p>
              </div>
              <div>
                <p className="text-sm text-[#bdb9b4]">Settlement</p>
                <p className="mt-2 text-2xl font-semibold">USDC on Arc</p>
              </div>
            </div>

            <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-[#c9c7c4]">Mission brief</p>
              <p className="mt-3 text-sm leading-6 text-[#f4f3f1]">
                Clear tasks yield faster routing, stronger verification, and cleaner payout flows across the worker network.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
