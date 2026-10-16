import assert from "node:assert/strict";
import test from "node:test";

const { executeX402PaymentFlow } = await import("./x402-payment-flow.ts");

function intent(status = "verified", overrides = {}) {
  return {
    id: "intent-1",
    status,
    response_status: null,
    response_body: null,
    provider_transfer_id: null,
    provider_status: null,
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  const calls = {
    settle: 0,
    claim: 0,
    record: 0,
    save: 0,
    handle: 0,
    recovery: [],
  };
  return {
    calls,
    deps: {
      prepare: async () => intent(),
      claim: async () => {
        calls.claim += 1;
        return { claimed: true, status: "settlement_submitted" };
      },
      settle: async () => {
        calls.settle += 1;
        return {
          success: true,
          network: "eip155:5042002",
          transaction: "provider-transfer-uuid",
          payer: "0x1111111111111111111111111111111111111111",
        };
      },
      markRecoveryPending: async (_id, code) => calls.recovery.push(code),
      recordProviderAcceptance: async () => {
        calls.record += 1;
      },
      buildResponse: async () => {
        calls.handle += 1;
        return { status: 200, body: { result: "paid" } };
      },
      saveResponse: async (_id, status, body) => {
        calls.save += 1;
        return { status, body };
      },
      expectedNetwork: "eip155:5042002",
      expectedPayer: "0x1111111111111111111111111111111111111111",
      createPaymentResponse: (id) => `response:${id}`,
      onRecoveryStateWriteFailure: () => {},
      ...overrides,
    },
  };
}

test("concurrent duplicate requests allow only the atomic claimant to settle", async () => {
  const state = { status: "verified", settleCount: 0 };
  const first = dependencies({
    prepare: async () => intent(state.status),
    claim: async () => {
      if (state.status !== "verified") {
        return { claimed: false, status: state.status };
      }
      state.status = "settlement_submitted";
      return { claimed: true, status: state.status };
    },
    settle: async () => {
      state.settleCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        success: true,
        network: "eip155:5042002",
        transaction: "provider-transfer-uuid",
        payer: "0x1111111111111111111111111111111111111111",
      };
    },
  });
  const second = dependencies({
    ...first.deps,
    prepare: async () => intent(state.status),
  });

  const results = await Promise.all([
    executeX402PaymentFlow(first.deps),
    executeX402PaymentFlow(second.deps),
  ]);
  assert.equal(state.settleCount, 1);
  assert.equal(results.filter((result) => result.kind === "response").length, 1);
  assert.equal(results.filter((result) => result.kind === "pending").length, 1);
});

test("a timeout after dispatch is recovery-pending and never resettled", async () => {
  const first = dependencies({
    settle: async () => {
      throw new Error("timeout");
    },
  });
  const result = await executeX402PaymentFlow(first.deps);
  assert.deepEqual(result, { kind: "pending", status: "recovery_pending" });
  assert.deepEqual(first.calls.recovery, ["settlement_outcome_unknown"]);

  const retry = dependencies({
    prepare: async () => intent("recovery_pending"),
  });
  await executeX402PaymentFlow(retry.deps);
  assert.equal(retry.calls.settle, 0);
});

test("accepted settlement with failed event persistence withholds content and does not resettle", async () => {
  const first = dependencies({
    recordProviderAcceptance: async () => {
      throw new Error("database unavailable");
    },
  });
  const result = await executeX402PaymentFlow(first.deps);
  assert.deepEqual(result, { kind: "pending", status: "recovery_pending" });
  assert.equal(first.calls.handle, 0);

  const retry = dependencies({
    prepare: async () => intent("recovery_pending"),
  });
  await executeX402PaymentFlow(retry.deps);
  assert.equal(retry.calls.settle, 0);
});

test("provider acceptance survives a crash before delivery and response is stored on replay", async () => {
  const first = dependencies({
    prepare: async () => intent("provider_accepted", {
      provider_transfer_id: "provider-transfer-uuid",
    }),
    buildResponse: async () => {
      throw new Error("simulated crash before response generation");
    },
  });
  const result = await executeX402PaymentFlow(first.deps);
  assert.deepEqual(result, { kind: "pending", status: "provider_accepted" });
  assert.equal(first.calls.settle, 0);

  const replay = dependencies({
    prepare: async () => intent("provider_accepted", {
      provider_transfer_id: "provider-transfer-uuid",
    }),
  });
  const replayResult = await executeX402PaymentFlow(replay.deps);
  assert.equal(replayResult.kind, "response");
  assert.equal(replay.calls.settle, 0);
  assert.equal(replay.calls.save, 1);
});

test("a recorded response is replayed without settlement or content regeneration", async () => {
  const existing = dependencies({
    prepare: async () => intent("response_ready", {
      provider_transfer_id: "provider-transfer-uuid",
      response_status: 200,
      response_body: { result: "original" },
    }),
  });
  const result = await executeX402PaymentFlow(existing.deps);
  assert.deepEqual(result, {
    kind: "response",
    response: {
      status: 200,
      body: { result: "original" },
      paymentResponse: "response:provider-transfer-uuid",
    },
  });
  assert.equal(existing.calls.settle, 0);
  assert.equal(existing.calls.handle, 0);
});

test("provider lookup with no record remains unresolved; reconciliation never settles", async () => {
  const lookup = { transfers: [] };
  const recovery = dependencies({
    prepare: async () => intent("recovery_pending"),
    settle: async () => {
      throw new Error("must not run");
    },
  });
  const result = await executeX402PaymentFlow(recovery.deps);
  assert.deepEqual(lookup.transfers, []);
  assert.deepEqual(result, { kind: "pending", status: "recovery_pending" });
  assert.equal(recovery.calls.settle, 0);
});

test("wrong network, payer, or missing provider ID cannot record or deliver", async () => {
  for (const settlement of [
    {
      success: true,
      network: "eip155:5042",
      transaction: "id",
      payer: "0x1111111111111111111111111111111111111111",
    },
    {
      success: true,
      network: "eip155:5042002",
      transaction: "id",
      payer: "0x2222222222222222222222222222222222222222",
    },
    {
      success: true,
      network: "eip155:5042002",
      transaction: "",
      payer: "0x1111111111111111111111111111111111111111",
    },
  ]) {
    const run = dependencies({ settle: async () => settlement });
    const result = await executeX402PaymentFlow(run.deps);
    assert.deepEqual(result, { kind: "pending", status: "recovery_pending" });
    assert.equal(run.calls.record, 0);
    assert.equal(run.calls.handle, 0);
  }
});
