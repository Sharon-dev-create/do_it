import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20261015000100_creator_task_archive_and_delete.sql", import.meta.url), "utf8");
const submissionRoute = await readFile(new URL("../app/api/tasks/[id]/submit/route.ts", import.meta.url), "utf8");
const bulkDeleteRoute = await readFile(new URL("../app/api/tasks/bulk-delete/route.ts", import.meta.url), "utf8");
const taskRoute = await readFile(new URL("../app/api/tasks/[id]/route.ts", import.meta.url), "utf8");
const v2Archive = await readFile(new URL("./v2-task-archive.ts", import.meta.url), "utf8");
const refundScanner = await readFile(new URL("./v2-refund-log-scan.ts", import.meta.url), "utf8");
const receiptVerifier = await readFile(new URL("./v2-archive-receipt-verification.ts", import.meta.url), "utf8");

test("obsolete delete overloads are dropped and security-definer functions pin search_path", () => {
  assert.match(migration, /drop function if exists public\.delete_creator_tasks\(uuid\[\], text\);/);
  assert.match(migration, /drop function if exists public\.delete_creator_task\(uuid, text\);/);
  assert.equal((migration.match(/set search_path = pg_catalog, public/g) ?? []).length, 4);
  for (const signature of [
    "delete_creator_task(uuid, text, integer)",
    "delete_creator_tasks(uuid[], text, jsonb)",
    "create_creator_task_batch(uuid, text, text, jsonb)",
    "record_rejected_task_submission(uuid, text, text)",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature.replace(/[()[\],]/g, "\\$&")} from public, anon, authenticated`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${signature.replace(/[()[\],]/g, "\\$&")} to service_role`));
  }
});

test("a retry cannot recreate rows missing from an existing creation batch", () => {
  assert.match(migration, /inserted_batch := found;/);
  assert.match(migration, /if not inserted_batch and task_total <> batch_row\.row_count then[\s\S]*?'incomplete_batch'/);
  assert.match(migration, /if inserted_batch then[\s\S]*?insert into public\.tasks\(/);
});

test("incorrect submissions serialize with deletion and reject archived tasks", () => {
  assert.match(migration, /record_rejected_task_submission[\s\S]*?from public\.tasks where id = p_task_id for update/);
  assert.match(migration, /if task_archived_at is not null then[\s\S]*?'archived'/);
  assert.equal((submissionRoute.match(/rpc\("record_rejected_task_submission"/g) ?? []).length, 2);
});

test("correct V1 and V2 submissions conditionally reserve only unarchived open tasks", () => {
  assert.equal((submissionRoute.match(/\.eq\("status", "open"\)\.is\("archived_at", null\)/g) ?? []).length, 2);
  for (const marker of ["if (!reserved)", "if (!claimed)"]) assert.ok(submissionRoute.includes(marker));
  assert.ok(submissionRoute.indexOf("if (!reserved)") < submissionRoute.indexOf("from(\"submissions\").insert", submissionRoute.indexOf("if (!reserved)")));
  assert.ok(submissionRoute.indexOf("if (!claimed)") < submissionRoute.indexOf("payWorker(", submissionRoute.indexOf("if (!claimed)")));
});

test("V2 archival requires a verified terminal chain status and verified settlement evidence", () => {
  assert.match(migration, /p_v2_chain_status is null or p_v2_chain_status not in \(3, 4\)/);
  assert.match(migration, /status = 'confirmed' and tx_hash is not null/);
  assert.match(migration, /grant execute on function public\.delete_creator_task\(uuid, text, integer\) to service_role/);
  assert.match(bulkDeleteRoute, /getVerifiedV2TerminalStatus/);
  assert.match(taskRoute, /getVerifiedV2TerminalStatus/);
  assert.match(v2Archive, /getTransactionReceipt/);
  assert.match(receiptVerifier, /decodeEventLog/);
  assert.match(refundScanner, /V2_REFUND_SCAN_BLOCK_WINDOW = 10_000n/);
  assert.match(v2Archive, /scanRefundLogRanges/);
  assert.match(v2Archive, /toBlock,/);
  assert.match(receiptVerifier, /event\.args\.taskId !== taskId/);
  assert.match(receiptVerifier, /receipt\.status === "success"/);
});

test("bulk deletion uses one database RPC and exposes ambiguous failures without claiming rollback", () => {
  assert.match(bulkDeleteRoute, /rpc\("delete_creator_tasks"/);
  assert.match(bulkDeleteRoute, /Unable to confirm the bulk deletion result/);
  assert.doesNotMatch(bulkDeleteRoute, /failed without applying any task changes/i);
});
