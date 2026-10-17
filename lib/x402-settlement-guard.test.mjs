import assert from "node:assert/strict";
import test from "node:test";

const {
  assertX402TestnetSettlementAllowed,
  settleX402OnTestnet,
} = await import("./x402-settlement-guard.ts");

const testnetEnvironment = {
  ARC_NETWORK: "testnet",
  NEXT_PUBLIC_ARC_NETWORK: "testnet",
};

test("Testnet settlement is allowed only with consistent trusted server configuration", async () => {
  assert.doesNotThrow(() =>
    assertX402TestnetSettlementAllowed("testnet", testnetEnvironment),
  );

  let providerCalls = 0;
  const result = await settleX402OnTestnet(
    "testnet",
    testnetEnvironment,
    async () => {
      providerCalls += 1;
      return "settled-on-testnet";
    },
  );
  assert.equal(result, "settled-on-testnet");
  assert.equal(providerCalls, 1);
});

test("Mainnet and missing, invalid, or contradictory settings reject before provider settlement", async () => {
  const invalidConfigurations = [
    ["mainnet", { ARC_NETWORK: "mainnet", NEXT_PUBLIC_ARC_NETWORK: "mainnet" }],
    ["testnet", { ARC_NETWORK: undefined, NEXT_PUBLIC_ARC_NETWORK: "testnet" }],
    ["testnet", { ARC_NETWORK: "testnet", NEXT_PUBLIC_ARC_NETWORK: undefined }],
    ["testnet", { ARC_NETWORK: "production", NEXT_PUBLIC_ARC_NETWORK: "production" }],
    ["testnet", { ARC_NETWORK: "testnet", NEXT_PUBLIC_ARC_NETWORK: "mainnet" }],
    ["mainnet", { ARC_NETWORK: "testnet", NEXT_PUBLIC_ARC_NETWORK: "testnet" }],
  ];

  for (const [serverNetwork, env] of invalidConfigurations) {
    let providerCalls = 0;
    await assert.rejects(
      settleX402OnTestnet(serverNetwork, env, async () => {
        providerCalls += 1;
      }),
      /x402 settlement is disabled/,
    );
    assert.equal(providerCalls, 0);
  }
});

test("the pre-provider gate rejects Mainnet before any Gateway API operation", () => {
  assert.throws(
    () => assertX402TestnetSettlementAllowed(
      "mainnet",
      { ARC_NETWORK: "mainnet", NEXT_PUBLIC_ARC_NETWORK: "mainnet" },
    ),
    /x402 settlement is disabled/,
  );
});
