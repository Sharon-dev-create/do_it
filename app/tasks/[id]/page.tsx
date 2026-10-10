"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";
import { isAddress } from "viem";

type Task = {
  id: string;
  title: string;
  description: string;
  reward_usdc: number | string;
  created_by: string;
  status: string;
  created_at: string;
  blockchain_task_id: string | number | null;
  contract_version: "v1" | "v2";
  create_tx_hash: string | null;
  fund_tx_hash: string | null;
};

type SubmitResult = {
  correct?: boolean;
  message?: string;
  error?: string;
  txHash?: string;
  requiresClaim?: boolean;
  submissionId?: string;
  credited?: boolean;
  paymentId?: string;
  requiresReconciliation?: boolean;
};

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [pendingClaim, setPendingClaim] = useState<{ submissionId: string; paymentId: string; claimTxHash?: `0x${string}` } | null>(null);

  useEffect(() => {
    if (!id) return;

    async function loadTask() {
      try {
        const response = await fetch(`/api/tasks/${id}`);

        if (!response.ok) {
          throw new Error("Task not found");
        }

        const data = await response.json();
        setTask(data.task);
      } catch (error) {
        console.error("Failed to load task:", error);
      } finally {
        setLoading(false);
      }
    }

    loadTask();
  }, [id]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isConnected || !address) {
      setResult({ error: "Connect the test worker wallet before submitting." });
      return;
    }
    if (!answer.trim()) {
      setResult({
        error: "Enter your answer.",
      });
      return;
    }
    if (task?.contract_version === "v2" && chainId !== 5042002) {
      setResult({ error: "Switch your connected wallet to Arc Testnet before submitting a V2 task." });
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const response = await fetch(`/api/tasks/${id}/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          worker_address: address,
          answer: answer.trim(),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setResult({
          error: data.error || "Submission failed.",
        });
        return;
      }

      if (data.requiresClaim && task?.contract_version === "v2") {
        setPendingClaim({ submissionId: data.submissionId, paymentId: data.paymentId });
        setResult({ correct: true, message: data.message });
        await finalizeClaim(data.submissionId);
      } else {
        setResult(data);
      }

      if (data.correct && !data.requiresClaim) setTask((current) => current ? { ...current, status: data.credited ? "completed" : "claimed" } : current);
    } catch (error) {
      setResult((current) => ({ ...current, error: error instanceof Error ? error.message : "Something went wrong while submitting." }));
    } finally {
      setSubmitting(false);
    }
  }

  async function finalizeClaim(submissionId: string) {
    if (!task?.blockchain_task_id || !publicClient || !address) {
      setResult((current) => ({ ...current, error: "Arc Testnet wallet or task details are unavailable. Your accepted submission remains reserved." }));
      return;
    }
    setSubmitting(true);
    try {
      let claimTxHash = pendingClaim?.submissionId === submissionId ? pendingClaim.claimTxHash : undefined;
      if (!claimTxHash) {
        claimTxHash = await writeContractAsync({ address: DO_IT_ESCROW_ADDRESS, abi: DO_IT_ESCROW_ABI, functionName: "claimTask", args: [BigInt(task.blockchain_task_id)], chainId: 5042002 });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: claimTxHash });
        if (receipt.status !== "success") throw new Error(`Claim transaction reverted: ${claimTxHash}`);
        setPendingClaim((current) => current ? { ...current, claimTxHash } : current);
      }
      const response = await fetch(`/api/tasks/${id}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worker_address: address, answer: answer.trim(), submission_id: submissionId, claim_tx_hash: claimTxHash }) });
      const data = await response.json();
      setResult({ ...data, error: response.ok ? data.error : data.error || "Reward credit needs reconciliation." });
      if (data.credited) {
        setPendingClaim(null);
        setTask((current) => current ? { ...current, status: "completed" } : current);
      } else if (data.requiresReconciliation) {
        setPendingClaim(null);
        setTask((current) => current ? { ...current, status: "claimed" } : current);
      }
    } catch (error) {
      setResult((current) => ({ ...current, error: error instanceof Error ? error.message : "Claim transaction failed. The submission remains reserved." }));
    } finally { setSubmitting(false); }
  }

  async function reconcileCredit() {
    if (!result?.paymentId) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/payments/${result.paymentId}/reconcile`, { method: "POST" });
      const data = await response.json();
      setResult({ ...result, ...data, credited: data.status === "confirmed", error: data.error || (data.status === "confirmed" ? undefined : data.message) });
      if (data.status === "confirmed") setTask((current) => current ? { ...current, status: "completed" } : current);
    } catch { setResult((current) => ({ ...current, error: "Unable to check the reward transaction yet. Keep its transaction hash for reconciliation." })); }
    finally { setSubmitting(false); }
  }

  if (loading) {
    return (
      <main className="doit-shell">
        <section className="task-detail-state">
          <div className="eyebrow">TASK / LOADING</div>
          <h1>
            Loading<span>.</span>
          </h1>
          <p>Fetching the mission details.</p>
        </section>
      </main>
    );
  }

  if (!task) {
    return (
      <main className="doit-shell">
        <section className="task-detail-state">
          <div className="eyebrow">TASK / 404</div>
          <h1>
            Not found<span>.</span>
          </h1>
          <p>This task does not exist or is no longer available.</p>
          <Link className="text-action" href="/tasks">
            <ArrowLeft size={14} />
            Back to marketplace
          </Link>
        </section>
      </main>
    );
  }

  const isOpen = task.status === "open";

  return (
    <main className="doit-shell">
      <div>
        <ConnectButton />
      </div>

      <section className="task-detail-heading">
        <div>
          <Link className="task-back-link" href="/tasks">
            <ArrowLeft size={13} />
            Back to marketplace
          </Link>

          <div className="task-eyebrow eyebrow">
            <span>MISSION</span>
            <span>•</span>
            <span className="task-id">
              {task.id.slice(0, 8).toUpperCase()}
            </span>
          </div>

          <h1>
            {task.title}
            <span>.</span>
          </h1>
        </div>

        <div className="task-reward">
          <strong>
            {Number(task.reward_usdc).toFixed(4)}
            <small>USDC</small>
          </strong>

          <span className="mono">
            REWARD / PER COMPLETION
          </span>
        </div>
      </section>

      <section className="task-detail-grid">
        <article className="task-panel task-description-panel">
          <div className="eyebrow">MISSION BRIEF</div>

          <h2>What you need to do.</h2>

          <p>{task.description}</p>

          <div className="task-meta">
            <div>
              <span className="eyebrow">STATUS</span>

              <strong className={isOpen ? "task-open" : "task-closed"}>
                <i />
                {task.status.toUpperCase()}
              </strong>
            </div>

            <div>
              <span className="eyebrow">REWARD</span>

              <strong>
                {Number(task.reward_usdc).toFixed(4)} USDC
              </strong>
            </div>
          </div>
        </article>

        <article className="task-panel task-submit-panel">
          <div className="eyebrow">SUBMISSION</div>

          {isOpen ? (
            <form onSubmit={handleSubmit}>
              {result?.error && (
                <div className="task-result task-result-error">
                  <span className="eyebrow">SUBMISSION FAILED</span>
                  <p>{result.error}</p>
                </div>
              )}

              {result?.correct && (
                <div className="task-result task-result-success">
                  <span className="eyebrow">{result.credited ? "EARNINGS CREDITED" : "MISSION COMPLETE"}</span>

                  <h3>{result.message}</h3>

                  {result.txHash && (
                    <a
                      href={`https://testnet.arcscan.app/tx/${result.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View reward-credit transaction
                      <ArrowUpRight size={13} />
                    </a>
                  )}
                </div>
              )}

              {pendingClaim && (
                <button className="task-submit-button" type="button" disabled={submitting || chainId !== 5042002} onClick={() => finalizeClaim(pendingClaim.submissionId)}>
                  {submitting ? "WAITING FOR ARC..." : "CONTINUE: CLAIM ON ARC"}
                </button>
              )}
              {result?.requiresReconciliation && result.paymentId && (
                <button className="task-submit-button" type="button" disabled={submitting} onClick={reconcileCredit}>
                  {submitting ? "CHECKING..." : "CHECK REWARD CREDIT STATUS"}
                </button>
              )}

              <p className="task-field">
                <span className="eyebrow">CONNECTED WORKER</span>
                <small>{isConnected && address && isAddress(address) ? address : "Connect your wallet above."}</small>
              </p>

              <label className="task-field">
                <span className="eyebrow">YOUR ANSWER</span>

                <input
                  type="text"
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="Enter your answer"
                  disabled={submitting}
                />
              </label>

              <button
                className="task-submit-button"
                type="submit"
                disabled={submitting || Boolean(pendingClaim) || !isConnected || (task.contract_version === "v2" && chainId !== 5042002)}
              >
                {submitting ? "VERIFYING / CLAIMING..." : "SUBMIT ANSWER"}
              </button>
              {task.contract_version === "v2" && <p className="mt-4 text-xs text-amber-800">Testnet only: V2 earnings are credited to the escrow balance; they are not transferred until you withdraw. Only configured test workers may use this flow. The contract itself still permits unrestricted direct claims, so this is not a public-marketplace security boundary.</p>}
            </form>
          ) : (
            <div className="task-closed-state">
              <span className="eyebrow">MISSION CLOSED</span>

              <h2>This mission is no longer available.</h2>

              <p>
                Another worker may have already completed this task.
              </p>
            </div>
          )}
        </article>
      </section>
    </main>
      );
}
