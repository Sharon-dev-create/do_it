"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";

type Task = {
  id: string;
  title: string;
  description: string;
  reward_usdc: string | number;
  created_by: string;
  status: string;
  created_at: string;
};

type SubmitResult = {
  error?: string;
  correct?: boolean;
  message?: string;
  txHash?: string;
  payment?: {
    status?: string;
    tx_hash?: string | null;
    amount_usdc?: string | number;
  };
};

type Props = {
  params: Promise<{ id: string }>;
};

export default function TaskDetailPage({ params }: Props) {
  const [taskId, setTaskId] = useState("");
  const [task, setTask] = useState<Task | null>(null);

  const [walletAddress, setWalletAddress] = useState("");
  const [answer, setAnswer] = useState("");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);

  useEffect(() => {
    params.then(({ id }) => {
      setTaskId(id);

      const savedWallet = window.localStorage.getItem("do-it-worker-address");
      if (savedWallet) {
        setWalletAddress(savedWallet);
      }

      fetch(`/api/tasks/${id}`)
        .then(async (response) => {
          const payload = await response.json();

          if (!response.ok) {
            throw new Error(payload.error || "Unable to load mission.");
          }

          return payload as { task: Task };
        })
        .then((payload) => {
          setTask(payload.task);
        })
        .catch((reason: unknown) => {
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load mission.",
          );
        })
        .finally(() => {
          setLoading(false);
        });
    });
  }, [params]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setResult(null);

    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress.trim())) {
      setError("Enter a valid Arc wallet address.");
      return;
    }

    if (!answer.trim()) {
      setError("Enter an answer before submitting.");
      return;
    }

    if (!task) {
      setError("Mission data is unavailable.");
      return;
    }

    setSubmitting(true);

    try {
      window.localStorage.setItem(
        "do-it-worker-address",
        walletAddress.trim(),
      );

      const response = await fetch(`/api/tasks/${taskId}/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          worker_address: walletAddress.trim(),
          answer: answer.trim(),
        }),
      });

      const payload = (await response.json()) as SubmitResult;

      setResult(payload);

      if (!response.ok) {
        setError(payload.error || "Submission failed.");
        return;
      }

      if (payload.correct) {
        setTask((current) =>
          current
            ? {
                ...current,
                status: "completed",
              }
            : current,
        );
      }
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : "Submission failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="doit-shell marketplace-page">
        <TaskNav />

        <section className="task-detail-state">
          <span className="eyebrow">MISSION / SYNCING</span>
          <h1>Loading mission<span>.</span></h1>
          <p>Connecting to the Do-It task network.</p>
        </section>
      </main>
    );
  }

  if (error && !task) {
    return (
      <main className="doit-shell marketplace-page">
        <TaskNav />

        <section className="task-detail-state">
          <span className="eyebrow">MISSION / UNAVAILABLE</span>
          <h1>Mission not found<span>.</span></h1>
          <p>{error}</p>
          <Link className="task-back-link" href="/tasks">
            <ArrowLeft size={14} />
            Back to missions
          </Link>
        </section>
      </main>
    );
  }

  if (!task) return null;

  const isOpen = task.status.toLowerCase() === "open";
  const paymentTxHash = result?.txHash || result?.payment?.tx_hash;

  return (
    <main className="doit-shell marketplace-page">
      <TaskNav />

      <section className="task-detail-heading">
        <div>
          <Link className="task-back-link" href="/tasks">
            <ArrowLeft size={14} />
            All missions
          </Link>

          <p className="eyebrow task-eyebrow">
            <span className="market-heading-dot" />
            MISSION / ARC TESTNET
          </p>

          <h1>
            {task.title}
            <span>.</span>
          </h1>

          <p className="task-id mono">
            #{task.id.replaceAll("-", "").slice(0, 8).toUpperCase()}
          </p>
        </div>

        <div className="task-reward">
          <span className="eyebrow">REWARD</span>
          <strong>
            {Number(task.reward_usdc).toFixed(3)}
            <small>USDC</small>
          </strong>
          <span className="mono">ARC TESTNET</span>
        </div>
      </section>

      <section className="task-detail-grid">
        <article className="task-panel task-description-panel">
          <span className="eyebrow">01 / MISSION BRIEF</span>

          <h2>Complete the task.</h2>

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
              <span className="eyebrow">NETWORK</span>
              <strong>ARC</strong>
            </div>
          </div>
        </article>

        <article className="task-panel task-submit-panel">
          <span className="eyebrow">02 / SUBMISSION</span>

          {!isOpen ? (
            <div className="task-closed-state">
              <h2>Mission completed.</h2>
              <p>
                This mission is no longer accepting submissions.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="task-field">
                <span className="eyebrow">WORKER WALLET</span>
                <input
                  value={walletAddress}
                  onChange={(event) => setWalletAddress(event.target.value)}
                  placeholder="0x..."
                  spellCheck={false}
                  autoComplete="off"
                />
                <small>
                  Your Arc wallet receives the USDC reward.
                </small>
              </label>

              <label className="task-field">
                <span className="eyebrow">YOUR ANSWER</span>
                <input
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="Enter your answer"
                  disabled={submitting}
                />
              </label>

              {error && (
                <div className="task-result task-result-error">
                  <span className="eyebrow">SUBMISSION ERROR</span>
                  <p>{error}</p>
                </div>
              )}

              {result && !error && (
                <div className="task-result task-result-success">
                  <span className="eyebrow">MISSION VERIFIED</span>
                  <h3>
                    {result.message || "Task completed successfully."}
                  </h3>

                  {paymentTxHash && (
                    <a
                      href={`https://testnet.arcscan.app/tx/${paymentTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View payment transaction
                      <ArrowUpRight size={14} />
                    </a>
                  )}
                </div>
              )}

              <button
                className="task-submit-button"
                type="submit"
                disabled={submitting}
              >
                {submitting ? "Submitting…" : "Submit mission"}
                <ArrowUpRight size={15} />
              </button>
            </form>
          )}
        </article>
      </section>

      <footer className="market-footer">
        <span>DO-IT · Autonomous task marketplace</span>
        <span className="mono">
          VERIFIED WORK → USDC SETTLEMENT
        </span>
      </footer>
    </main>
  );
}

function TaskNav() {
  return (
    <header className="doit-nav">
      <Link href="/" className="brand">
        DO-IT<span className="brand-period">.</span>
      </Link>

      <nav aria-label="Main navigation">
        <Link className="nav-current" href="/tasks">
          Missions
        </Link>
        <Link href="/#network">Navigation</Link>
        <Link href="/payments">Payments</Link>
        <Link href="/#agents">Agents</Link>
      </nav>

      <div className="nav-right">
        <span className="network-online">
          <i />
          Arc Testnet online
        </span>

        <Link className="wallet-link" href="/dashboard">
          Open dashboard <ArrowUpRight size={14} />
        </Link>
      </div>
    </header>
  );
}
