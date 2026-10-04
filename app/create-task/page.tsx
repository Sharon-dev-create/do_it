"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function CreateTaskPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rewardUsdc, setRewardUsdc] = useState("10");
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          reward_usdc: Number(rewardUsdc),
          correct_answer: correctAnswer.trim(),
          created_by: createdBy.trim(),
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Unable to create task.");
      }

      const taskId = payload.task?.id;
      if (taskId) {
        router.push(`/tasks/${taskId}`);
        return;
      }

      router.push("/dashboard");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to create task.",
      );
    } finally {
      setIsSubmitting(false);
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

            <form onSubmit={handleSubmit} className="mt-8 space-y-6">
              <div>
                <label htmlFor="title" className="mb-2 block text-sm font-medium text-[#111111]">
                  Task title
                </label>
                <input
                  id="title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Example: Validate market data snapshot"
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

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="reward" className="mb-2 block text-sm font-medium text-[#111111]">
                    Reward (USDC)
                  </label>
                  <input
                    id="reward"
                    type="number"
                    min="0"
                    step="0.01"
                    value={rewardUsdc}
                    onChange={(event) => setRewardUsdc(event.target.value)}
                    className="w-full rounded-xl border border-[#d8d6d4] bg-[#faf9f8] px-4 py-3 text-sm outline-none transition focus:border-[#111111]"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="createdBy" className="mb-2 block text-sm font-medium text-[#111111]">
                    Created by
                  </label>
                  <input
                    id="createdBy"
                    value={createdBy}
                    onChange={(event) => setCreatedBy(event.target.value)}
                    placeholder="0x... or operator name"
                    className="w-full rounded-xl border border-[#d8d6d4] bg-[#faf9f8] px-4 py-3 text-sm outline-none transition focus:border-[#111111]"
                    required
                  />
                </div>
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

              <div className="flex items-center justify-between gap-4 pt-2">
                <Link href="/" className="text-sm text-[#585653] hover:text-[#111111]">
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={isSubmitting}
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
