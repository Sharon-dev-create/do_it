import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20261015000200_lock_down_core_marketplace_tables.sql",
    import.meta.url,
  ),
  "utf8",
);

test("core marketplace tables are RLS protected and only service_role has table privileges", () => {
  for (const table of ["tasks", "submissions", "task_payments"]) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security;`),
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all privileges on table public\\.${table} from public, anon, authenticated;`,
      ),
    );
    assert.match(
      migration,
      new RegExp(`grant all privileges on table public\\.${table} to service_role;`),
    );
    assert.doesNotMatch(
      migration,
      new RegExp(`create policy[^;]*on public\\.${table}`, "i"),
    );
  }
});

test("migration is additive and does not delete marketplace data", () => {
  assert.doesNotMatch(migration, /\b(drop table|truncate|delete from)\b/i);
});
