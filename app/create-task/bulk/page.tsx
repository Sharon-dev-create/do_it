"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAccount, useSignMessage } from "wagmi";
import { isAddress } from "viem";
import { BrandLink } from "@/components/brand-link";
import { getWorkerSessionChallengeMessage } from "@/lib/worker-session-auth";
import { BULK_TASK_MAX_FILE_BYTES, BULK_TASK_MAX_ROWS, BulkTaskRow, csvEscape, isValidRewardAmount, parseBulkTaskCsv, ParsedBulkRow } from "@/lib/bulk-task-csv";

function validateRows(rows: ParsedBulkRow[]) {
  const seen = new Map<string, number>();
  return rows.map((item) => {
    const task = item.task; const errors: string[] = [];
    if (task.title.trim().length < 3 || task.title.trim().length > 120) errors.push("Title must be 3–120 characters");
    if (task.description.trim().length < 10 || task.description.trim().length > 10000) errors.push("Description must be 10–10,000 characters");
    if (!isValidRewardAmount(task.reward_usdc)) errors.push("Reward must be a positive supported USDC amount with up to 6 decimals");
    if (!task.correct_answer.trim() || task.correct_answer.length > 1000) errors.push("Expected answer must be 1–1,000 characters");
    const key = [task.title, task.description, task.reward_usdc, task.correct_answer].map((v) => v.trim().toLowerCase()).join("\u0000");
    const duplicateOf = seen.get(key);
    if (duplicateOf) errors.push(`Duplicate of CSV row ${duplicateOf}`); else seen.set(key, item.rowNumber);
    return { ...item, errors, duplicateOf };
  });
}

function BulkCreator() {
  const search = useSearchParams(); const sourceId = search.get("source");
  const { address, isConnected } = useAccount(); const { signMessageAsync } = useSignMessage();
  const [authorized, setAuthorized] = useState(false); const [authorizing, setAuthorizing] = useState(false);
  const [rows, setRows] = useState<ParsedBulkRow[]>([]); const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [copies, setCopies] = useState(1); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [message, setMessage] = useState(""); const [duplicateLoaded, setDuplicateLoaded] = useState(false);
  const walletRef = useRef(address?.toLowerCase() ?? null); walletRef.current = address?.toLowerCase() ?? null;
  const validRows = useMemo(() => rows.filter((r) => !r.errors.length || (allowDuplicates && r.errors.every((e) => e.startsWith("Duplicate of CSV row")))), [rows, allowDuplicates]);
  const invalidRows = rows.filter((r) => !validRows.includes(r));

  useEffect(() => {
    setAuthorized(false); setRows([]); setMessage(""); setError("");
    if (!address) return;
    let active = true;
    fetch("/api/worker/auth/session", { cache: "no-store" }).then((r) => r.json()).then((data) => {
      if (active && walletRef.current === address.toLowerCase()) setAuthorized(data.worker_address?.toLowerCase() === address.toLowerCase());
    }).catch(() => { if (active) setError("Unable to check creator wallet authorization"); });
    return () => { active = false; };
  }, [address]);

  useEffect(() => {
    if (!sourceId || !authorized || duplicateLoaded) return;
    let active = true;
    fetch(`/api/creator/tasks/${sourceId}`, { cache: "no-store" }).then(async (r) => {
      const data = await r.json(); if (!r.ok) throw new Error(data.error || "Unable to load source task"); return data;
    }).then((data) => {
      if (!active) return;
      const task = data.task as BulkTaskRow;
      setRows(validateRows(Array.from({ length: Math.min(copies, BULK_TASK_MAX_ROWS) }, (_, i) => ({ rowNumber: i + 2, task: { title: task.title, description: task.description, reward_usdc: String(task.reward_usdc), correct_answer: task.correct_answer }, errors: [] }))));
      setAllowDuplicates(true); setDuplicateLoaded(true);
    }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "Unable to load source task"); });
    return () => { active = false; };
  }, [sourceId, authorized, duplicateLoaded, copies]);

  async function authorize() {
    if (!address || !isConnected || !isAddress(address, { strict: false })) { setError("Connect a valid creator wallet first."); return; }
    const activeWallet = address.toLowerCase(); setAuthorizing(true); setError("");
    try {
      const cr = await fetch("/api/worker/auth/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worker_address: address }) });
      const challenge = await cr.json(); if (!cr.ok) throw new Error(challenge.error || "Unable to start wallet authorization");
      const signature = await signMessageAsync({ message: challenge.message });
      const vr = await fetch("/api/worker/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worker_address: address, nonce: challenge.nonce, expires_at: challenge.expiresAt, signature }) });
      const data = await vr.json(); if (!vr.ok) throw new Error(data.error || "Wallet authorization failed");
      if (walletRef.current === activeWallet) setAuthorized(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Wallet authorization failed"); }
    finally { setAuthorizing(false); }
  }

  async function loadFile(file?: File) {
    setError(""); setMessage("");
    if (!file) return;
    if (file.size > BULK_TASK_MAX_FILE_BYTES) { setError("CSV must be 2 MB or smaller."); return; }
    try { setRows(parseBulkTaskCsv(await file.text())); setAllowDuplicates(false); }
    catch (e) { setRows([]); setError(e instanceof Error ? e.message : "Unable to parse CSV"); }
  }

  function edit(index: number, key: keyof BulkTaskRow, value: string) {
    const changed = rows.map((row, i) => i === index ? { ...row, task: { ...row.task, [key]: value } } : row);
    setRows(validateRows(changed));
  }

  function download(name: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
  }
  function downloadInvalid() {
    const lines = [["row_number", "title", "description", "reward_usdc", "correct_answer", "errors"].join(",")];
    for (const row of invalidRows) lines.push([String(row.rowNumber), row.task.title, row.task.description, row.task.reward_usdc, row.task.correct_answer, row.errors.join("; ")].map(csvEscape).join(","));
    download("doit-invalid-task-rows.csv", lines.join("\n"));
  }

  async function submit() {
    if (!address || !authorized || !validRows.length) return;
    if (!window.confirm(`Create ${validRows.length} V1 Gateway task(s)? Tasks will be listed immediately with no USDC deposited at creation. Payment occurs through the existing Gateway flow if a valid answer is accepted. This action cannot be undone from this dialog.`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const tasks = validRows.map(({ task }) => ({ title: task.title.trim(), description: task.description.trim(), reward_usdc: task.reward_usdc.trim(), correct_answer: task.correct_answer.trim() }));
      const content = JSON.stringify(tasks);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
      const contentHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      const storageKey = `doit:creator-batch:${address.toLowerCase()}:${contentHash}`;
      let batchId = sessionStorage.getItem(storageKey);
      if (!batchId) { batchId = crypto.randomUUID(); sessionStorage.setItem(storageKey, batchId); }
      const response = await fetch("/api/tasks/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch_id: batchId, tasks }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Task batch creation failed");
      setMessage(`${data.created} V1 Gateway task(s) ${data.replayed ? "were already saved by this batch" : "created"}. No funds were deposited at creation.`);
    } catch (e) { setError(e instanceof Error ? `${e.message} Retry this exact batch without changing its rows.` : "Task batch creation failed. Retry without changing the rows."); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-6xl px-5 py-10">
    <header className="mb-8 flex items-center justify-between gap-4 border-b pb-4">
      <BrandLink compact />
      <Link href="/dashboard" className="text-sm underline">← Dashboard</Link>
    </header>
    <h1 className="mt-4 text-3xl font-semibold">Create tasks in bulk</h1>
    <div className="my-5 rounded-lg border border-amber-500/40 bg-amber-50 p-4 text-sm text-amber-950"><strong>V1 Gateway tasks · no upfront deposit.</strong> CSV bulk creation uses the existing V1 Gateway payment path. Creating a task does not deposit USDC or guarantee Gateway funding; payment is attempted under the existing rules when a valid answer is accepted. This does not create V2 escrow allocations. Quantities are not supported by the current task schema.</div>
    {!isConnected && <p className="my-4">Connect the creator wallet using the wallet control in the site header.</p>}
    {isConnected && !authorized && <button className="rounded border px-4 py-2" disabled={authorizing} onClick={authorize}>{authorizing ? "Authorizing…" : "Authorize creator wallet"}</button>}
    {authorized && <>
      {sourceId && <div className="my-4 rounded border p-3 text-sm"><label>Copies of this task template (copied: title, description, reward, and expected answer; every task gets a new ID and has no copied submissions or payment history): <input className="ml-2 w-20 rounded border p-1" type="number" min={1} max={BULK_TASK_MAX_ROWS} value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(BULK_TASK_MAX_ROWS, Number(e.target.value) || 1)))} /></label><button className="ml-3 underline" onClick={() => { setDuplicateLoaded(false); setRows([]); }}>Reload template copies</button></div>}
      <div className="my-4 flex flex-wrap gap-3"><input type="file" accept=".csv,text/csv" onChange={(e) => void loadFile(e.target.files?.[0])} /><button className="rounded border px-3 py-2 text-sm" onClick={() => download("doit-task-template.csv", `title,description,reward_usdc,correct_answer\n${csvEscape("Example task")},${csvEscape("Describe the task requirements here")},1.00,${csvEscape("example answer")}`)}>Download CSV template</button></div>
      <p className="text-xs text-muted-foreground">CSV size limit: 2 MB. Maximum: {BULK_TASK_MAX_ROWS} rows. Required columns, in order: title, description, reward_usdc, correct_answer.</p>
      {!!rows.length && <>
        <div className="my-4 flex flex-wrap items-center justify-between gap-3"><span>{validRows.length} valid for creation · {invalidRows.length} excluded with errors</span><label className="text-sm"><input type="checkbox" checked={allowDuplicates} onChange={(e) => setAllowDuplicates(e.target.checked)} /> Allow exact duplicate rows (useful for template copies)</label>{invalidRows.length > 0 && <button className="underline" onClick={downloadInvalid}>Download invalid-row report</button>}</div>
        <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead><tr className="border-b"><th className="p-2">Row</th><th className="p-2">Title</th><th className="p-2">Description</th><th className="p-2">Reward USDC</th><th className="p-2">Expected answer</th><th className="p-2">Validation</th></tr></thead><tbody>{rows.map((row, i) => {
          const onlyDuplicate = allowDuplicates && row.errors.length > 0 && row.errors.every((e) => e.startsWith("Duplicate of CSV row"));
          const valid = row.errors.length === 0 || onlyDuplicate;
          return <tr key={row.rowNumber} className="border-b align-top"><td className="p-2">{row.rowNumber}</td>{(["title", "description", "reward_usdc", "correct_answer"] as const).map((key) => <td className="p-2" key={key}><input className="w-full min-w-28 rounded border p-1" value={row.task[key]} onChange={(e) => edit(i, key, e.target.value)} /></td>)}<td className={`p-2 ${valid ? "text-green-700" : "text-red-700"}`}>{valid ? (onlyDuplicate ? "Duplicate included by choice" : "Valid") : row.errors.join("; ")}</td></tr>;
        })}</tbody></table></div>
        <button className="mt-5 rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" disabled={busy || !validRows.length} onClick={() => void submit()}>{busy ? "Creating batch…" : `Create ${validRows.length} V1 task(s)`}</button>
      </>}
    </>}
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}{message && <p role="status" className="mt-4 text-sm text-green-700">{message}</p>}
  </main>;
}

export default function BulkTaskPage() { return <Suspense fallback={<main className="mx-auto max-w-6xl px-5 py-8"><BrandLink compact /><p className="mt-6">Loading task creator…</p></main>}><BulkCreator /></Suspense>; }
