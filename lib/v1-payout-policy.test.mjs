import assert from "node:assert/strict";
import test from "node:test";

const { getV1GatewayPayoutUnavailableMessage, isV1GatewayPayoutAllowed } =
  await import("./v1-payout-policy.ts");

test("unfunded V1 Gateway payouts are disabled on Mainnet but remain available on Testnet", () => {
  assert.equal(isV1GatewayPayoutAllowed("testnet"), true);
  assert.equal(isV1GatewayPayoutAllowed("mainnet"), false);
  assert.equal(getV1GatewayPayoutUnavailableMessage("testnet"), null);
  assert.match(
    getV1GatewayPayoutUnavailableMessage("mainnet"),
    /creator-funded or explicitly reserved payout budget/,
  );
});
