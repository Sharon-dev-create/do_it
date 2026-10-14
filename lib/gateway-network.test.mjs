import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";

process.env.NEXT_PUBLIC_ARC_NETWORK ??= "testnet";

const {
  getGatewayApiUrl,
  getGatewayChainConfig,
  getGatewayFacilitatorUrl,
  getGatewaySellerAddress,
  getGatewaySellerCredentials,
  getSupportedGatewayExtra,
  gatewayRequirementsMatch,
  hasArcMainnetMintLog,
} = await import("./gateway-network.ts");

test("Gateway selects the SDK's Arc chain, token and official contracts per environment", () => {
  const mainnet = getGatewayChainConfig("mainnet");
  assert.equal(mainnet.chain.id, 5042);
  assert.equal(mainnet.domain, 26);
  assert.equal(mainnet.usdc, "0x3600000000000000000000000000000000000000");
  assert.equal(mainnet.gatewayWallet, "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE");
  assert.equal(mainnet.gatewayMinter, "0x2222222d7164433c4C09B0b0D809a9b52C04C205");

  const testnet = getGatewayChainConfig("testnet");
  assert.equal(testnet.chain.id, 5042002);
  assert.equal(testnet.domain, 26);
  assert.equal(testnet.gatewayWallet, "0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
  assert.equal(testnet.gatewayMinter, "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B");
  assert.notEqual(testnet.chain.id, mainnet.chain.id);
});

test("Gateway API and facilitator URLs are selected without network fallback", () => {
  assert.equal(
    getGatewayApiUrl("mainnet", "/transfer"),
    "https://gateway-api.circle.com/v1/transfer",
  );
  assert.equal(
    getGatewayApiUrl("testnet", "/balances"),
    "https://gateway-api-testnet.circle.com/v1/balances",
  );
  assert.equal(getGatewayFacilitatorUrl("mainnet"), "https://gateway-api.circle.com");
  assert.equal(
    getGatewayFacilitatorUrl("testnet"),
    "https://gateway-api-testnet.circle.com",
  );
});

test("seller signing keys are environment-specific and must match their addresses", () => {
  const key = `0x${"01".padStart(64, "0")}`;
  const address = privateKeyToAccount(key).address;
  assert.throws(
    () => getGatewaySellerCredentials("mainnet", { SELLER_ADDRESS: address, SELLER_PRIVATE_KEY: key }),
    /SELLER_MAINNET_ADDRESS/,
  );
  assert.throws(
    () => getGatewaySellerCredentials("mainnet", { SELLER_MAINNET_ADDRESS: address }),
    /SELLER_MAINNET_PRIVATE_KEY/,
  );
  assert.throws(
    () => getGatewaySellerCredentials("mainnet", {
      SELLER_MAINNET_ADDRESS: "0x0000000000000000000000000000000000000001",
      SELLER_MAINNET_PRIVATE_KEY: key,
    }),
    /does not match/,
  );
  assert.equal(
    getGatewaySellerCredentials("mainnet", {
      SELLER_MAINNET_ADDRESS: address,
      SELLER_MAINNET_PRIVATE_KEY: key,
    }).address,
    address,
  );
  assert.equal(
    getGatewaySellerAddress("testnet", { SELLER_ADDRESS: address }),
    address,
  );
});

test("x402 requirements require Circle's exact supported Arc payment kind", () => {
  const chain = getGatewayChainConfig("mainnet");
  const extra = {
    name: "GatewayWalletBatched",
    version: "1",
    verifyingContract: chain.gatewayWallet,
    assets: [{ symbol: "USDC", address: chain.usdc, decimals: 6 }],
  };
  assert.deepEqual(
    getSupportedGatewayExtra(
      [{ x402Version: 2, scheme: "exact", network: "eip155:5042", extra }],
      chain,
    ),
    extra,
  );
  assert.throws(
    () => getSupportedGatewayExtra(
      [{ x402Version: 2, scheme: "exact", network: "eip155:5042002", extra }],
      chain,
    ),
    /does not advertise/,
  );
  assert.throws(
    () => getSupportedGatewayExtra(
      [{
        x402Version: 2,
        scheme: "exact",
        network: "eip155:5042",
        extra: {
          ...extra,
          assets: [{ symbol: "USDC", address: "0x3600000000000000000000000000000000000001", decimals: 6 }],
        },
      }],
      chain,
    ),
    /does not advertise/,
  );

  const requirements = {
    scheme: "exact",
    network: "eip155:5042",
    asset: chain.usdc,
    amount: "1000",
    payTo: "0x0000000000000000000000000000000000000001",
    maxTimeoutSeconds: 691200,
    extra,
  };
  assert.equal(gatewayRequirementsMatch(requirements, requirements), true);
  assert.equal(
    gatewayRequirementsMatch({ ...requirements, network: "eip155:5042002" }, requirements),
    false,
  );
  assert.equal(
    gatewayRequirementsMatch({ ...requirements, payTo: "0x0000000000000000000000000000000000000002" }, requirements),
    false,
  );
});

test("Arc Mainnet payout confirmation requires the exact native-USDC mint log", () => {
  const recipient = "0x0000000000000000000000000000000000000001";
  const amount = 1_250_000n;
  const log = {
    address: "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE",
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      `0x${"0".repeat(64)}`,
      `0x${recipient.slice(2).padStart(64, "0")}`,
    ],
    data: `0x${(amount * 10n ** 12n).toString(16).padStart(64, "0")}`,
  };

  assert.equal(hasArcMainnetMintLog([log], recipient, amount), true);
  assert.equal(hasArcMainnetMintLog([log], recipient, amount + 1n), false);
  assert.equal(
    hasArcMainnetMintLog([log], "0x0000000000000000000000000000000000000002", amount),
    false,
  );
});
