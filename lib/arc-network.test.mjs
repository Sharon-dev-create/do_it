import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";

process.env.NEXT_PUBLIC_ARC_NETWORK ??= "testnet";

const {
  ARC_USDC_ADDRESS,
  assertArcNetworkPair,
  assertGatewayNetwork,
  assertPaymentNetwork,
  assertRuntimeCodeHash,
  getArcNetworkConfig,
  getArcTransactionUrl,
  parseArcNetworkName,
} = await import("./arc-network.ts");

test("Arc network config returns documented chain, RPC, explorer, USDC and decimals", () => {
  const mainnet = getArcNetworkConfig("mainnet");
  assert.equal(mainnet.chainId, 5042);
  assert.equal(mainnet.rpcUrl, "https://rpc.mainnet.arc.io");
  assert.equal(mainnet.explorerUrl, "https://explorer.arc.io");
  assert.equal(mainnet.usdcAddress, ARC_USDC_ADDRESS);
  assert.equal(mainnet.usdcDecimals, 6);
  assert.equal(mainnet.nativeCurrencyDecimals, 18);

  const testnet = getArcNetworkConfig("testnet");
  assert.equal(testnet.chainId, 5042002);
  assert.equal(testnet.rpcUrl, "https://rpc.testnet.arc.network");
  assert.equal(testnet.gatewayChain, "arcTestnet");
  assert.equal(testnet.usdcAddress, ARC_USDC_ADDRESS);
});

test("network selection rejects missing, invalid, and mismatched environment values", () => {
  assert.throws(() => parseArcNetworkName(undefined), /must be explicitly set/);
  assert.throws(() => parseArcNetworkName("production"), /must be explicitly set/);
  assert.throws(() => assertArcNetworkPair("mainnet", "testnet"), /mixed-network/);
  assert.doesNotThrow(() => assertArcNetworkPair("mainnet", "mainnet"));
});

test("Circle Gateway and payment requirements reject unsupported Arc Mainnet", () => {
  assert.throws(() => assertGatewayNetwork("mainnet"), /unavailable in the installed SDK/);
  assert.doesNotThrow(() => assertGatewayNetwork("testnet"));
  assert.throws(() => assertPaymentNetwork("mainnet", "eip155:5042002"), /does not match/);
  assert.doesNotThrow(() => assertPaymentNetwork("mainnet", "eip155:5042"));
});

test("Arc transaction links use the selected network explorer", () => {
  const hash = `0x${"1".repeat(64)}`;
  assert.equal(getArcTransactionUrl("mainnet", hash), `https://explorer.arc.io/tx/${hash}`);
  assert.equal(getArcTransactionUrl("testnet", hash), `https://explorer.testnet.arc.io/tx/${hash}`);
});

test("runtime bytecode hashes must match the reviewed deployment", () => {
  const bytecode = "0x600160005260016000f3";
  const expected = keccak256(bytecode);
  assert.doesNotThrow(() => assertRuntimeCodeHash(bytecode, expected));
  assert.throws(() => assertRuntimeCodeHash(bytecode, `0x${"0".repeat(64)}`), /does not match/);
  assert.throws(() => assertRuntimeCodeHash(bytecode, undefined), /does not match/);
});
