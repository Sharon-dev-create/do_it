import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../supabase/migrations/20261016000100_x402_payment_intents.sql", import.meta.url),
  "utf8",
);

test("x402 intent migration isolates records and provides unique authorization and transfer keys", () => {
  assert.match(migration, /alter table public\.x402_payment_intents enable row level security/i);
  assert.match(migration, /from public, anon, authenticated/i);
  assert.match(migration, /unique \(network, domain_id, verifying_contract, payer, authorization_nonce\)/i);
  assert.match(migration, /unique \(network, provider_transfer_id\)/i);
  assert.match(migration, /unique index payment_events_intent_id_unique/i);
});

test("x402 acceptance and payment-event insertion share a transaction and retry is one-shot", () => {
  assert.match(migration, /status = 'settlement_submitted'[\s\S]*?attempt_count = 1/i);
  assert.match(migration, /status = 'verified'[\s\S]*?attempt_count = 0/i);
  const accept = migration.slice(
    migration.indexOf("create or replace function public.record_x402_provider_acceptance"),
    migration.indexOf("create or replace function public.save_x402_payment_response"),
  );
  assert.match(accept, /update public\.x402_payment_intents/i);
  assert.match(accept, /insert into public\.payment_events/i);
  assert.match(accept, /intent_id/i);
});
