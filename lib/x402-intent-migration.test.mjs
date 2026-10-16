import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../supabase/migrations/20261016000100_x402_payment_intents.sql", import.meta.url),
  "utf8",
);
const route = await readFile(new URL("./x402.ts", import.meta.url), "utf8");

function compact(value) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim()
    .toLowerCase();
}

function rpcDeclaration(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = migration.match(new RegExp(
    `create or replace function public\\.${escapedName}\\(([\\s\\S]*?)\\)\\s*returns\\s+([\\s\\S]*?)\\s+language`,
    "i",
  ));
  assert.ok(match, `missing RPC declaration: ${name}`);
  return { args: compact(match[1]), returns: compact(match[2]) };
}

test("RPC signatures and results match the named Supabase calls", () => {
  const declarations = {
    get_x402_payment_intent: {
      args: "p_network text, p_domain_id integer, p_verifying_contract text, p_payer text, p_authorization_nonce text",
      returns: "table (intent_id uuid, network text, domain_id integer, verifying_contract text, payer text, recipient text, token text, amount_base_units numeric, authorization_nonce text, endpoint text, request_hash text, status text, response_status integer, response_body jsonb, provider_transfer_id text, provider_status text)",
      call: /"get_x402_payment_intent",\s*\{\s*p_network: requirements\.network,\s*p_domain_id: chainConfig\.domain,\s*p_verifying_contract: verifyingContract,\s*p_payer: payer,\s*p_authorization_nonce: authorization\.nonce/s,
    },
    prepare_x402_payment_intent: {
      args: "p_network text, p_domain_id integer, p_verifying_contract text, p_payer text, p_recipient text, p_token text, p_amount_base_units numeric, p_authorization_nonce text, p_endpoint text, p_request_hash text",
      returns: "table (intent_id uuid, intent_status text, response_status integer, response_body jsonb, provider_transfer_id text, provider_status text)",
      call: /"prepare_x402_payment_intent",\s*\{\s*p_network: requirements\.network,\s*p_domain_id: chainConfig\.domain,\s*p_verifying_contract: verifyingContract,\s*p_payer: payer,\s*p_recipient: requirements\.payTo,\s*p_token: requirements\.asset,\s*p_amount_base_units: requirements\.amount,\s*p_authorization_nonce: authorization\.nonce,\s*p_endpoint: endpoint,\s*p_request_hash: requestHash/s,
    },
    claim_x402_payment_intent: {
      args: "p_intent_id uuid",
      returns: "table (claimed boolean, intent_status text)",
      call: /"claim_x402_payment_intent",\s*\{\s*p_intent_id: intentId/s,
    },
    mark_x402_payment_recovery_pending: {
      args: "p_intent_id uuid, p_error_code text",
      returns: "void",
      call: /"mark_x402_payment_recovery_pending",\s*\{\s*p_intent_id: intentId,\s*p_error_code: errorCode/s,
    },
    record_x402_provider_acceptance: {
      args: "p_intent_id uuid, p_provider_transfer_id text, p_provider_status text",
      returns: "table (intent_status text, event_id uuid)",
      call: /"record_x402_provider_acceptance",\s*\{\s*p_intent_id: intentId,\s*p_provider_transfer_id: transferId,\s*p_provider_status: null/s,
    },
    save_x402_payment_response: {
      args: "p_intent_id uuid, p_response_status integer, p_response_body jsonb",
      returns: "table (intent_status text, response_status integer, response_body jsonb)",
      call: /"save_x402_payment_response",\s*\{\s*p_intent_id: intentId,\s*p_response_status: status,\s*p_response_body: body/s,
    },
  };

  for (const [name, expected] of Object.entries(declarations)) {
    const actual = rpcDeclaration(name);
    assert.equal(actual.args, expected.args, `${name} argument signature`);
    assert.equal(actual.returns, expected.returns, `${name} return shape`);
    assert.match(route, expected.call, `${name} TypeScript parameter names`);
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?\\)\\s+to service_role`, "i"),
      `${name} must be executable by service_role`,
    );
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?\\)\\s+from public, anon, authenticated`, "i"),
      `${name} must not be executable by browser roles`,
    );
  }
});

test("x402 intent migration isolates records and provides unique authorization and transfer keys", () => {
  assert.match(migration, /alter table public\.x402_payment_intents enable row level security/i);
  assert.match(migration, /from public, anon, authenticated/i);
  assert.match(migration, /unique \(network, domain_id, verifying_contract, payer, authorization_nonce\)/i);
  assert.match(migration, /unique \(network, provider_transfer_id\)/i);
  assert.match(migration, /unique index payment_events_intent_id_unique/i);
  assert.match(migration, /request_hash text not null/i);
  assert.match(migration, /revoke all privileges on table public\.x402_payment_intents[\s\S]*?service_role/i);
  assert.match(migration, /grant execute on function public\.get_x402_payment_intent/i);
  assert.doesNotMatch(migration, /grant select, insert, update on table public\.x402_payment_intents/i);
  assert.equal((migration.match(/set search_path = pg_catalog\b/gi) ?? []).length, 6);
  assert.doesNotMatch(migration, /set search_path =[^;\n]*public/i);
  assert.match(migration, /revoke insert, update, delete on table public\.payment_events[\s\S]*?service_role/i);
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
