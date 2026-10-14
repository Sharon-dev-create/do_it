"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAccount, useSignMessage } from "wagmi";
import { isAddress } from "viem";
import { BrandLink } from "@/components/brand-link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  return (
    <main className="doit-shell bulk-task-shell">
      <header className="doit-nav task-detail-nav bulk-task-nav">
        <BrandLink compact />
        <div className="bulk-task-nav-actions">
          <Link href="/dashboard" className="text-action">Dashboard</Link>
          <ConnectButton />
        </div>
      </header>

      <section className="bulk-task-content">
        <div className="eyebrow">CREATOR TOOLS / CSV</div>
        <h1>Create tasks in bulk<span>.</span></h1>
        <div className="bulk-task-note">
          <strong>V1 Gateway tasks · no upfront deposit.</strong>{" "}
          CSV bulk creation uses the existing V1 Gateway payment path. Creating a
          task does not deposit USDC or guarantee Gateway funding; payment is
          attempted under the existing rules when a valid answer is accepted.
          This does not create V2 escrow allocations. Quantities are not supported
          by the current task schema.
        </div>

        {!isConnected && (
          <p className="bulk-task-hint" role="status">
            Connect a creator wallet to authorize and create tasks.
          </p>
        )}
        {isConnected && !authorized && (
          <Button type="button" disabled={authorizing} onClick={authorize}>
            {authorizing ? "Authorizing…" : "Authorize creator wallet"}
          </Button>
        )}

        {authorized && (
          <div className="bulk-task-workspace">
            {sourceId && (
              <div className="bulk-task-template">
                <Label htmlFor="bulk-template-copies">
                  Copies of this task template
                </Label>
                <p>
                  Title, description, reward, and expected answer are copied.
                  Each task gets a new ID with no copied submissions or payment
                  history.
                </p>
                <div className="bulk-task-actions">
                  <Input
                    id="bulk-template-copies"
                    aria-label="Number of task template copies"
                    className="bulk-task-copy-count"
                    type="number"
                    min={1}
                    max={BULK_TASK_MAX_ROWS}
                    value={copies}
                    onChange={(event) =>
                      setCopies(
                        Math.max(
                          1,
                          Math.min(
                            BULK_TASK_MAX_ROWS,
                            Number(event.target.value) || 1,
                          ),
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDuplicateLoaded(false);
                      setRows([]);
                    }}
                  >
                    Reload template copies
                  </Button>
                </div>
              </div>
            )}

            <div className="bulk-task-upload">
              <div>
                <Label htmlFor="bulk-csv-file">Upload a CSV file</Label>
                <Input
                  id="bulk-csv-file"
                  type="file"
                  accept=".csv,text/csv"
                  aria-describedby="bulk-csv-help"
                  onChange={(event) => void loadFile(event.target.files?.[0])}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  download(
                    "doit-task-template.csv",
                    `title,description,reward_usdc,correct_answer\n${csvEscape("Example task")},${csvEscape("Describe the task requirements here")},1.00,${csvEscape("example answer")}`,
                  )
                }
              >
                Download CSV template
              </Button>
            </div>
            <p id="bulk-csv-help" className="bulk-task-hint">
              CSV size limit: 2 MB. Maximum: {BULK_TASK_MAX_ROWS} rows. Required
              columns, in order: title, description, reward_usdc, correct_answer.
            </p>

            {!!rows.length && (
              <>
                <div className="bulk-task-summary">
                  <p aria-live="polite">
                    {validRows.length} valid for creation · {invalidRows.length}{" "}
                    excluded with errors
                  </p>
                  <label className="bulk-task-duplicate-toggle">
                    <input
                      type="checkbox"
                      checked={allowDuplicates}
                      onChange={(event) =>
                        setAllowDuplicates(event.target.checked)
                      }
                    />
                    Allow exact duplicate rows (useful for template copies)
                  </label>
                  {invalidRows.length > 0 && (
                    <Button
                      type="button"
                      variant="link"
                      onClick={downloadInvalid}
                    >
                      Download invalid-row report
                    </Button>
                  )}
                </div>

                <div className="bulk-task-table-wrap">
                  <table className="bulk-task-table">
                    <caption className="sr-only">
                      Review and edit imported tasks and their validation errors
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Row</th>
                        <th scope="col">Title</th>
                        <th scope="col">Description</th>
                        <th scope="col">Reward USDC</th>
                        <th scope="col">Expected answer</th>
                        <th scope="col">Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => {
                        const onlyDuplicate =
                          allowDuplicates &&
                          row.errors.length > 0 &&
                          row.errors.every((message) =>
                            message.startsWith("Duplicate of CSV row"),
                          );
                        const valid = row.errors.length === 0 || onlyDuplicate;
                        const validationId = `bulk-row-${row.rowNumber}-validation`;

                        return (
                          <tr key={row.rowNumber}>
                            <th scope="row">{row.rowNumber}</th>
                            {(
                              [
                                "title",
                                "description",
                                "reward_usdc",
                                "correct_answer",
                              ] as const
                            ).map((key) => (
                              <td key={key}>
                                <Input
                                  aria-label={`Row ${row.rowNumber} ${key.replace("_", " ")}`}
                                  aria-describedby={
                                    valid ? undefined : validationId
                                  }
                                  className="bulk-task-row-input"
                                  value={row.task[key]}
                                  onChange={(event) =>
                                    edit(index, key, event.target.value)
                                  }
                                />
                              </td>
                            ))}
                            <td
                              id={validationId}
                              className={
                                valid ? "bulk-task-valid" : "bulk-task-invalid"
                              }
                              aria-live={valid ? undefined : "polite"}
                            >
                              {valid
                                ? onlyDuplicate
                                  ? "Duplicate included by choice"
                                  : "Valid"
                                : row.errors.join("; ")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <Button
                  type="button"
                  className="bulk-task-submit"
                  disabled={busy || !validRows.length}
                  onClick={() => void submit()}
                >
                  {busy
                    ? "Creating batch…"
                    : `Create ${validRows.length} V1 task(s)`}
                </Button>
              </>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="bulk-task-feedback bulk-task-error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="bulk-task-feedback bulk-task-success">
            {message}
          </p>
        )}
      </section>
    </main>
  );
}

export default function BulkTaskPage() {
  return (
    <Suspense
      fallback={
        <main className="doit-shell bulk-task-shell">
          <header className="doit-nav task-detail-nav bulk-task-nav">
            <BrandLink compact />
            <Link href="/dashboard" className="text-action">
              Dashboard
            </Link>
          </header>
          <section className="task-detail-state">
            <div className="eyebrow">CREATOR TOOLS / LOADING</div>
            <h1>
              Loading<span>.</span>
            </h1>
            <p>Loading the bulk task creator.</p>
          </section>
        </main>
      }
    >
      <BulkCreator />
    </Suspense>
  );
}
