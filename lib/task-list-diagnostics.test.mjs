import assert from "node:assert/strict";
import test from "node:test";
import { PostgrestError } from "@supabase/postgrest-js";
import {
  runTaskListQuery,
  taskListFailureDiagnostic,
  validateTaskListSupabaseConfig,
} from "./task-list-diagnostics.ts";

test("validates Supabase URL and service key without returning their values", () => {
  assert.deepEqual(
    validateTaskListSupabaseConfig("https://project.example.test", "a-valid-looking-key"),
    [],
  );
  assert.deepEqual(validateTaskListSupabaseConfig(undefined, undefined), [
    "SUPABASE_URL_MISSING",
    "SUPABASE_SERVICE_ROLE_KEY_MISSING",
  ]);
  assert.deepEqual(validateTaskListSupabaseConfig("not-a-url", "invalid\nkey"), [
    "SUPABASE_URL_INVALID",
    "SUPABASE_SERVICE_ROLE_KEY_INVALID",
  ]);
});

test("returned PostgREST query errors are classified and safely summarized", async () => {
  const databaseError = new PostgrestError({
    code: "PGRST204",
    message: "Could not find the 'archived_at' column of 'tasks' in the schema cache",
    details: "Sensitive task content must not be logged",
    hint: "Private diagnostic detail must not be logged",
  });
  const diagnostics = [];

  const result = await runTaskListQuery(
    async () => ({ data: null, error: databaseError }),
    (error) => diagnostics.push(taskListFailureDiagnostic(error, "query")),
  );

  assert.deepEqual(result, { ok: false });
  assert.deepEqual(diagnostics, [{
    category: "database",
    stage: "query",
    code: "PGRST204",
    message: "Task-list schema is missing field archived_at.",
  }]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /Sensitive task content|Private diagnostic detail/);
});

test("thrown query failures are classified without logging arbitrary messages", async () => {
  const diagnostics = [];
  const result = await runTaskListQuery(
    async () => { throw new Error("unexpected failure containing private task data"); },
    (error) => diagnostics.push(taskListFailureDiagnostic(error, "query")),
  );

  assert.deepEqual(result, { ok: false });
  assert.deepEqual(diagnostics, [{ category: "unexpected", stage: "query" }]);
});
