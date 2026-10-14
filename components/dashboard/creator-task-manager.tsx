"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAccount, useSignMessage } from "wagmi";
import { isAddress } from "viem";
import { getWorkerSessionChallengeMessage } from "@/lib/worker-session-auth";

type CreatorTask = { id: string; title: string; reward_usdc: string | number; status: string; archived_at: string | null; contract_version: string };
type TaskResult = { task_id: string; outcome: string; reason?: string };

export function CreatorTaskManager() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [authorized, setAuthorized] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tasks, setTasks] = useState<CreatorTask[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [includeArchived, setIncludeArchived] = useState(false);
  const walletRef = useRef(address?.toLowerCase() ?? null);
  walletRef.current = address?.toLowerCase() ?? null;
  const pageSize = 25;

  const load = useCallback(async () => {
    if (!address || authorized !== address.toLowerCase()) { setTasks([]); setSelected([]); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/creator/tasks?page=${page}&limit=${pageSize}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load tasks");
      if (walletRef.current !== address.toLowerCase()) return;
      setTasks(data.tasks ?? []); setTotal(data.total ?? 0); setSelected([]);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load tasks"); }
    finally { setBusy(false); }
  }, [address, authorized, page]);

  useEffect(() => {
    setAuthorized(null); setTasks([]); setSelected([]); setPage(1);
    if (!address) return;
    let active = true;
    fetch("/api/worker/auth/session", { cache: "no-store" }).then((r) => r.json()).then((data) => {
      if (active && walletRef.current === address.toLowerCase()) setAuthorized(data.worker_address?.toLowerCase() === address.toLowerCase() ? address.toLowerCase() : null);
    }).catch(() => { if (active) setError("Unable to check wallet authorization"); });
    return () => { active = false; };
  }, [address]);
  useEffect(() => { void load(); }, [load]);

  async function authorize() {
    if (!address || !isConnected || !isAddress(address, { strict: false })) return setError("Connect a valid creator wallet first.");
    const current = address.toLowerCase(); setBusy(true); setError("");
    try {
      const cr = await fetch("/api/worker/auth/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worker_address: address }) });
      const challenge = await cr.json(); if (!cr.ok) throw new Error(challenge.error || "Unable to start authorization");
      const signature = await signMessageAsync({ message: challenge.message });
      const vr = await fetch("/api/worker/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worker_address: address, nonce: challenge.nonce, expires_at: challenge.expiresAt, signature }) });
      const verified = await vr.json(); if (!vr.ok) throw new Error(verified.error || "Wallet authorization failed");
      if (walletRef.current === current) setAuthorized(current);
    } catch (e) { setError(e instanceof Error ? e.message : "Wallet authorization failed"); }
    finally { setBusy(false); }
  }

  async function remove(id: string, title: string) {
    const confirmed = window.confirm(`Delete “${title}”? A pristine open V1 task is permanently deleted. Tasks with history are archived. Unresolved payments and active or unsettled V2 escrow tasks are blocked. No blockchain transaction will be sent.`);
    if (!confirmed) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/tasks/${id}`, { method: "DELETE" }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Task deletion failed");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Task deletion failed"); }
    finally { setBusy(false); }
  }

  async function bulkRemove() {
    if (!selected.length) return;
    const titles = tasks.filter((t) => selected.includes(t.id)).map((t) => t.title);
    if (!window.confirm(`Delete ${selected.length} selected task(s)?\n\n${titles.slice(0, 5).map((t) => `• ${t}`).join("\n")}${titles.length > 5 ? `\n• and ${titles.length - 5} more` : ""}\n\nPristine open V1 tasks are permanently deleted. Tasks with history are archived. Unresolved payments and active or unsettled V2 escrow tasks are blocked. Results are reported per task.`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/tasks/bulk-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task_ids: selected }) });
      const data = await response.json();
      if (!response.ok && response.status !== 207) throw new Error(data.error || "Bulk deletion failed");
      const results = (data.results ?? []) as TaskResult[];
      const failures = results.filter((r) => !["deleted", "archived", "already_archived"].includes(r.outcome));
      if (failures.length) setError(failures.map((r) => `${r.task_id.slice(0, 8)}: ${r.reason || r.outcome}`).join("; "));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Bulk deletion failed"); }
    finally { setBusy(false); }
  }

  const currentTasks = useMemo(() => includeArchived ? tasks : tasks.filter((t) => !t.archived_at), [includeArchived, tasks]);
  const pageIds = currentTasks.map((t) => t.id);
  function toggleAll() { setSelected(selected.length === pageIds.length ? [] : pageIds); }

  return <section className="my-10 rounded-xl border p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-xl font-semibold">Your tasks</h2><p className="mt-1 text-sm text-muted-foreground">Manage tasks you created. Deletion never sends a blockchain transaction.</p></div>
      <Link className="rounded-md border px-3 py-2 text-sm" href="/create-task/bulk">Create tasks from CSV</Link>
    </div>
    {!isConnected && <p className="mt-4 text-sm">Connect your creator wallet to manage your tasks.</p>}
    {isConnected && authorized !== address?.toLowerCase() && <button className="mt-4 rounded-md border px-3 py-2 text-sm" disabled={busy} onClick={authorize}>{busy ? "Authorizing…" : "Authorize creator wallet"}</button>}
    {authorized === address?.toLowerCase() && <>
      <div className="my-4 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />Show archived tasks</label>
        <button className="rounded border px-3 py-1.5 disabled:opacity-50" disabled={busy || !currentTasks.length} onClick={toggleAll}>{selected.length === pageIds.length && pageIds.length ? "Clear page selection" : "Select all on page"}</button>
        <span>{selected.length} selected</span>
        <button className="rounded bg-destructive px-3 py-1.5 text-white disabled:opacity-50" disabled={busy || !selected.length} onClick={bulkRemove}>Delete selected</button>
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-[var(--doit-brand-error)]">{error}</p>}
      {busy && <p className="mb-2 text-xs text-muted-foreground">Working…</p>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Select</th><th className="p-2">Task</th><th className="p-2">Reward</th><th className="p-2">State</th><th className="p-2">Actions</th></tr></thead><tbody>
        {currentTasks.map((task) => <tr key={task.id} className="border-b"><td className="p-2"><input aria-label={`Select ${task.title}`} type="checkbox" checked={selected.includes(task.id)} onChange={(e) => setSelected((s) => e.target.checked ? [...s, task.id] : s.filter((id) => id !== task.id))} /></td><td className="p-2"><Link className="underline" href={`/tasks/${task.id}`}>{task.title}</Link><div className="text-xs text-muted-foreground">{task.contract_version.toUpperCase()}</div></td><td className="p-2">{task.reward_usdc} USDC</td><td className="p-2">{task.archived_at ? "Archived" : task.status}</td><td className="p-2"><div className="flex gap-2"><Link className="underline" href={`/create-task/bulk?source=${task.id}`}>Duplicate</Link>{!task.archived_at && <button className="text-[var(--doit-brand-error)] underline disabled:opacity-50" disabled={busy} onClick={() => void remove(task.id, task.title)}>Delete</button>}</div></td></tr>)}
        {!currentTasks.length && <tr><td colSpan={5} className="p-4 text-muted-foreground">No tasks on this page.</td></tr>}
      </tbody></table></div>
      <div className="mt-4 flex items-center justify-between text-sm"><span>{total} task(s) · Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span><div className="flex gap-2"><button className="rounded border px-3 py-1 disabled:opacity-50" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>Previous</button><button className="rounded border px-3 py-1 disabled:opacity-50" disabled={page >= Math.ceil(total / pageSize) || busy} onClick={() => setPage(page + 1)}>Next</button></div></div>
    </>}
  </section>;
}
