import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20261015000100_creator_task_archive_and_delete.sql", import.meta.url), "utf8");
const submissionRoute = await readFile(new URL("../app/api/tasks/[id]/submit/route.ts", import.meta.url), "utf8");
const bulkDeleteRoute = await readFile(new URL("../app/api/tasks/bulk-delete/route.ts", import.meta.url), "utf8");

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
});

test("V2 archival requires a verified terminal chain status and verified settlement evidence", () => {
  assert.match(migration, /p_v2_chain_status is null or p_v2_chain_status not in \(3, 4\)/);
  assert.match(migration, /status = 'confirmed' and tx_hash is not null/);
  assert.match(migration, /grant execute on function public\.delete_creator_task\(uuid, text, integer\) to service_role/);
  assert.match(bulkDeleteRoute, /getVerifiedV2TerminalStatus/);
});

test("bulk deletion uses one database RPC and exposes ambiguous failures without claiming rollback", () => {
  assert.match(bulkDeleteRoute, /rpc\("delete_creator_tasks"/);
  assert.match(bulkDeleteRoute, /Unable to confirm the bulk deletion result/);
  assert.doesNotMatch(bulkDeleteRoute, /failed without applying any task changes/i);
});
