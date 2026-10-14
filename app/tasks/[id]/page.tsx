"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import { DO_IT_ESCROW_ABI, DO_IT_ESCROW_ADDRESS } from "@/lib/contracts/doItEscrow";
import { isAddress } from "viem";
import { getWorkerSessionChallengeMessage } from "@/lib/worker-session-auth";
import { getTaskSubmissionNotice, isTaskRewardConfirmed, postTaskAnswer } from "@/lib/task-submission-client";
import { BrandLink } from "@/components/brand-link";
import { ThemeToggle } from "@/components/theme-toggle";

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

function TaskDetailHeader() {
  return (
    <header className="doit-nav task-detail-nav">
      <BrandLink />
      <div className="task-detail-nav-actions">
        <ThemeToggle />
        <ConnectButton />
      </div>
    </header>
  );
}

function TaskDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [pendingClaim, setPendingClaim] = useState<{ submissionId: string; paymentId: string; claimTxHash?: `0x${string}` } | null>(null);
  const [authorizedWorker, setAuthorizedWorker] = useState<string | null>(null);
  const [authorizingWorker, setAuthorizingWorker] = useState(false);
  const [authorizationError, setAuthorizationError] = useState("");
  const [deletingTask, setDeletingTask] = useState(false);
  const activeWallet = useRef(address?.toLowerCase() ?? null);
  activeWallet.current = address?.toLowerCase() ?? null;
  const isWorkerAuthorized = Boolean(address && authorizedWorker === address.toLowerCase());
  const isCreator = Boolean(address && task && isAddress(address, { strict: false }) && isAddress(task.created_by, { strict: false }) && address.toLowerCase() === task.created_by.toLowerCase());
  const submissionNotice = getTaskSubmissionNotice(result);

  useEffect(() => {
    let cancelled = false;
    setAuthorizedWorker(null);
    setAuthorizationError("");
    if (!address) return () => { cancelled = true; };
    fetch("/api/worker/auth/session", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : { worker_address: null })
      .then((data) => {
        if (!cancelled && activeWallet.current === address.toLowerCase()) {
          setAuthorizedWorker(typeof data.worker_address === "string" ? data.worker_address.toLowerCase() : null);
        }
      })
      .catch(() => {
        if (!cancelled) setAuthorizationError("Unable to check wallet authorization.");
      });
    return () => { cancelled = true; };
  }, [address]);

  async function authorizeWorkerWallet() {
    if (!isConnected || !address || !isAddress(address, { strict: false })) {
      setAuthorizationError("Connect a valid worker wallet before authorizing it.");
      return;
    }
    const requestedWallet = address.toLowerCase();
    setAuthorizingWorker(true);
    setAuthorizationError("");
    try {
      const challengeResponse = await fetch("/api/worker/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_address: address }),
      });
      const challenge = await challengeResponse.json();
      if (!challengeResponse.ok) throw new Error(challenge.error || "Unable to start wallet authorization.");
      if (activeWallet.current !== requestedWallet) return;
      const signature = await signMessageAsync({ message: challenge.message });
      if (activeWallet.current !== requestedWallet) return;
      const verifyResponse = await fetch("/api/worker/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_address: address, nonce: challenge.nonce, expires_at: challenge.expiresAt, signature }),
      });
      const verified = await verifyResponse.json();
      if (!verifyResponse.ok) throw new Error(verified.error || "Wallet authorization failed.");
      if (activeWallet.current === requestedWallet && verified.worker_address?.toLowerCase() === requestedWallet) {
        setAuthorizedWorker(requestedWallet);
      }
    } catch (error) {
      if (activeWallet.current === requestedWallet) setAuthorizationError(error instanceof Error ? error.message : "Wallet authorization failed.");
    } finally {
      setAuthorizingWorker(false);
    }
  }

  async function deleteCreatedTask() {
    if (!task || !isWorkerAuthorized || !isCreator || deletingTask) return;
    const confirmed = window.confirm(`Delete “${task.title}”? A pristine open V1 task is permanently deleted. Tasks with submissions or payment history are archived. Tasks with unresolved payments or active or unsettled V2 escrow are blocked. No blockchain transaction will be sent.`);
    if (!confirmed) return;
    setDeletingTask(true); setAuthorizationError("");
    try {
      const response = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Task deletion failed");
      router.push("/dashboard");
    } catch (error) {
      setAuthorizationError(error instanceof Error ? error.message : "Task deletion failed");
    } finally { setDeletingTask(false); }
  }

  useEffect(() => {
    if (!id) return;

    async function loadTask() {
      setLoading(true);
      setTask(null);
      setLoadError(false);
      setPendingClaim(null);
      setResult(null);
      try {
        const suffix = address ? `?worker=${encodeURIComponent(address)}` : "";
        const response = await fetch(`/api/tasks/${id}${suffix}`);

        if (!response.ok) {
          if (response.status !== 404) {
            throw new Error("Unable to load this task.");
          }
          setTask(null);
          return;
        }

        const data = await response.json();
        setTask(data.task);
        if (data.pendingRewardFlow) {
          const flow = data.pendingRewardFlow;
          setPendingClaim({ submissionId: flow.submissionId, paymentId: flow.paymentId, claimTxHash: flow.claimTxHash || undefined });
          if (["submitted", "processing"].includes(flow.paymentStatus)) {
            setPendingClaim(null);
            setResult({ correct: true, credited: false, requiresReconciliation: true, paymentId: flow.paymentId, txHash: flow.txHash, error: "Your claim is recorded. Check the reward credit transaction before taking further action." });
          } else if (flow.paymentStatus === "confirmed") {
            setPendingClaim(null);
            setResult({ correct: true, credited: true, paymentId: flow.paymentId, txHash: flow.txHash, message: "Reward credited to your on-chain earnings." });
          }
        }
      } catch (error) {
        console.error("Failed to load task:", error);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    }

    loadTask();
  }, [id, address, loadAttempt]);

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
    if (!isWorkerAuthorized) {
      setResult({ error: "Authorize this connected worker wallet before submitting." });
      return;
    }
    if (task?.contract_version === "v2" && chainId !== 5042002) {
      setResult({ error: "Switch your connected wallet to Arc Testnet before submitting a V2 task." });
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const response = await postTaskAnswer(id, { worker_address: address, answer: answer.trim() });
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          setAuthorizedWorker(null);
          setAuthorizationError(data.error || "Authorize the connected wallet again.");
        }
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
    if (!isWorkerAuthorized) {
      setResult((current) => ({ ...current, error: "Authorize this connected worker wallet before continuing the claim." }));
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
      const response = await postTaskAnswer(id, { worker_address: address, answer: answer.trim(), submission_id: submissionId, claim_tx_hash: claimTxHash });
      const data = await response.json();
      if (response.status === 401) {
        setAuthorizedWorker(null);
        setAuthorizationError(data.error || "Authorize the connected wallet again.");
      }
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
        <TaskDetailHeader />
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
        <TaskDetailHeader />
        <section className="task-detail-state">
          <div className="eyebrow">{loadError ? "TASK / ERROR" : "TASK / 404"}</div>
          <h1>
            {loadError ? "Unable to load" : "Not found"}<span>.</span>
          </h1>
          <p>
            {loadError
              ? "We could not fetch this task. Check your connection and try again."
              : "This task does not exist or is no longer available."}
          </p>
          {loadError && (
            <button
              className="task-submit-button"
              type="button"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              Retry
            </button>
          )}
          <Link className="text-action" href="/tasks">
            <ArrowLeft size={14} />
            Back to marketplace
          </Link>
        </section>
      </main>
    );
  }

  const isOpen = task.status === "open" || Boolean(pendingClaim) || Boolean(result?.requiresReconciliation);
  return (
    <main className="doit-shell">
      <TaskDetailHeader />

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

          {isCreator ? (
            <div className="task-closed-state">
              <span className="eyebrow">CREATOR WALLET</span>
              <h2>You created this task.</h2>
              <p>Creator wallets cannot submit answers to their own tasks.</p>
              {!isWorkerAuthorized && <button className="task-submit-button" type="button" disabled={authorizingWorker || deletingTask} onClick={authorizeWorkerWallet}>{authorizingWorker ? "VERIFYING WALLET…" : "AUTHORIZE TO MANAGE TASK"}</button>}
              {isWorkerAuthorized && <button className="task-submit-button" type="button" disabled={deletingTask} onClick={() => void deleteCreatedTask()}>{deletingTask ? "DELETING…" : "DELETE TASK"}</button>}
              {authorizationError && <p role="alert" className="task-result-error">{authorizationError}</p>}
            </div>
          ) : isOpen ? (
            <form onSubmit={handleSubmit}>
              {submissionNotice && (
                <div className="task-result task-result-error">
                  <span className="eyebrow">{result?.correct === false ? "ANSWER NOT ACCEPTED" : "SUBMISSION NEEDS ATTENTION"}</span>
                  <p>{submissionNotice}</p>
                </div>
              )}

              {result && isTaskRewardConfirmed(task.contract_version, result) && (
                <div className="task-result task-result-success">
                  <span className="eyebrow">{task.contract_version === "v2" ? "EARNINGS CREDITED" : "PAYMENT CONFIRMED"}</span>

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
                <>
                <div className="task-result task-result-pending" role="status">
                  <span className="eyebrow">ANSWER ACCEPTED</span>
                  <p>Confirm the Arc Testnet claim transaction to continue. Earnings are not credited yet.</p>
                </div>
                <button className="task-submit-button" type="button" disabled={submitting || chainId !== 5042002 || !isWorkerAuthorized} onClick={() => finalizeClaim(pendingClaim.submissionId)}>
                  {submitting ? "WAITING FOR ARC..." : "CONTINUE: CLAIM ON ARC"}
                </button>
                </>
              )}
              {result?.requiresReconciliation && result.paymentId && (
                <>
                <div className="task-result task-result-pending" role="status">
                  <span className="eyebrow">REWARD CREDIT PENDING</span>
                  <p>The claim was accepted, but the reward is not confirmed in your earnings yet. Check its on-chain status before taking further action.</p>
                  {result.txHash && (
                    <a href={`https://testnet.arcscan.app/tx/${result.txHash}`} target="_blank" rel="noreferrer">
                      View transaction <ArrowUpRight size={13} />
                    </a>
                  )}
                </div>
                <button className="task-submit-button" type="button" disabled={submitting} onClick={reconcileCredit}>
                  {submitting ? "CHECKING..." : "CHECK REWARD CREDIT STATUS"}
                </button>
                </>
              )}

              <p className="task-field">
                <span className="eyebrow">CONNECTED WORKER</span>
                <small>{isConnected && address && isAddress(address) ? address : "Connect your wallet above."}</small>
              </p>

              {isConnected && address && !isWorkerAuthorized && <div className="task-field">
                <button className="task-submit-button" type="button" disabled={authorizingWorker || submitting} onClick={authorizeWorkerWallet}>
                  {authorizingWorker ? "VERIFYING WALLET…" : "AUTHORIZE WORKER WALLET"}
                </button>
                <small>Your wallet signature creates a short-lived session. Submitting an answer then uses the application API without another signature prompt.</small>
                {authorizationError && <p role="alert" className="task-result-error">{authorizationError}</p>}
              </div>}
              {isWorkerAuthorized && <p className="task-field"><small>Worker wallet authorized for this browser session.</small></p>}

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
                disabled={submitting || Boolean(pendingClaim) || !isConnected || !isWorkerAuthorized || (task.contract_version === "v2" && chainId !== 5042002)}
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

export default function TaskDetailPage() {
  return <Suspense fallback={<main className="doit-shell"><TaskDetailHeader /><section className="task-detail-state"><div className="eyebrow">TASK / LOADING</div><h1>Loading<span>.</span></h1><p>Fetching the mission details.</p></section></main>}><TaskDetailContent /></Suspense>;
}
