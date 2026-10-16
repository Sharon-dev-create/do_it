import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bulkRoute = await readFile(
  new URL("../app/api/tasks/bulk/route.ts", import.meta.url),
  "utf8",
);
const submissionRoute = await readFile(
  new URL("../app/api/tasks/[id]/submit/route.ts", import.meta.url),
  "utf8",
);
const retryRoute = await readFile(
  new URL("../app/api/payments/[id]/retry/route.ts", import.meta.url),
  "utf8",
);
const x402 = await readFile(new URL("./x402.ts", import.meta.url), "utf8");

test("Mainnet V1 bulk creation and submission are stopped before database or payout mutation", () => {
  assert.match(bulkRoute, /getV1GatewayPayoutUnavailableMessage/);
  const v1Function = submissionRoute.slice(
    submissionRoute.indexOf("async function submitV1"),
    submissionRoute.indexOf("\n}\n\nexport async function POST"),
  );
  assert.match(v1Function, /getV1GatewayPayoutUnavailableMessage/);
  assert.ok(
    v1Function.indexOf("if (payoutUnavailable)") <
      v1Function.indexOf('.update({ status: "completed"'),
  );
});

test("payment retries require recipient session authorization, matching approved submission and atomic hash-free claim", () => {
  assert.match(retryRoute, /getWorkerAddressFromSessionToken/);
  assert.match(retryRoute, /sessionWallet !== payment\.worker_address\.toLowerCase\(\)/);
  assert.match(retryRoute, /isAuthorizedGatewayPaymentRetry\(payment, task, submission\)/);
  assert.match(retryRoute, /\.eq\("status", "failed"\)\s*\.is\("tx_hash", null\)/);
});

test("x402 does not serve paid content when its settlement record cannot be persisted", () => {
  assert.match(x402, /prepare_x402_payment_intent/);
  assert.match(x402, /claim_x402_payment_intent/);
  assert.match(x402, /record_x402_provider_acceptance/);
  assert.match(x402, /save_x402_payment_response/);
  assert.ok(x402.indexOf('.from("x402_payment_intents")') < x402.indexOf("facilitator.verify("));
  assert.match(x402, /status === "response_ready"[\s\S]*?PAYMENT-RESPONSE/);
  assert.match(x402, /flow\.kind === "pending"[\s\S]*?status: 503/);
  assert.doesNotMatch(x402, /supabase\.from\("payment_events"\)\.insert/);
});
