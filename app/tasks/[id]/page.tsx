"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";

type Task = {
  id: string;
  title: string;
  description: string;
  reward_usdc: number | string;
  created_by: string;
  status: string;
  created_at: string;
};

type SubmitResult = {
  correct?: boolean;
  message?: string;
  error?: string;
  txHash?: string;
};

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [answer, setAnswer] = useState("");
  const [workerAddress, setWorkerAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

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

    if (!workerAddress.trim() || !answer.trim()) {
      setResult({
        error: "Enter your wallet address and answer.",
      });
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      console.info("SUBMIT: sending request", { taskId: id });
      const response = await fetch(`/api/tasks/${id}/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          worker_address: workerAddress.trim(),
          answer: answer.trim(),
        }),
      });
      console.info("SUBMIT: response received", { status: response.status });

      const data = await response.json();
      console.info("SUBMIT: response parsed", {
        correct: data.correct,
        hasError: Boolean(data.error),
        hasTxHash: Boolean(data.txHash),
      });

      if (!response.ok) {
        setResult({
          error: data.error || "Submission failed.",
        });
        return;
      }

      setResult(data);

      if (data.correct) {
        setTask((current) =>
          current ? { ...current, status: "completed" } : current,
        );
      }
    } catch (error) {
      console.error("Submission error:", error);

      setResult({
        error: "Something went wrong while submitting.",
      });
    } finally {
      setSubmitting(false);
      console.info("SUBMIT: request finished");
    }
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
                  <span className="eyebrow">MISSION COMPLETE</span>

                  <h3>{result.message}</h3>

                  {result.txHash && (
                    <a
                      href={`https://testnet.arcscan.app/tx/${result.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View payment
                      <ArrowUpRight size={13} />
                    </a>
                  )}
                </div>
              )}

              <label className="task-field">
                <span className="eyebrow">WALLET ADDRESS</span>

                <input
                  type="text"
                  value={workerAddress}
                  onChange={(event) =>
                    setWorkerAddress(event.target.value)
                  }
                  placeholder="0x..."
                  disabled={submitting}
                />

                <small>
                  This is where your reward will be sent.
                </small>
              </label>

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
                disabled={submitting}
              >
                {submitting ? "SUBMITTING..." : "SUBMIT ANSWER"}
              </button>
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
