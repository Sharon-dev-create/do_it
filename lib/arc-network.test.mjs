import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";

process.env.NEXT_PUBLIC_ARC_NETWORK ??= "testnet";

const {
  ARC_USDC_ADDRESS,
  assertArcNetworkPair,
  assertArcChainId,
  assertNotTestnetDeploymentAddress,
  assertGatewayNetwork,
  assertPaymentNetwork,
  assertRuntimeCodeHash,
  getArcRpcOverride,
  getArcNetworkConfig,
  getArcTransactionUrl,
  getArcVerifierPrivateKey,
  parseArcNetworkName,
  ARC_TESTNET_ESCROW_ADDRESS,
  ARC_TESTNET_VERIFIER_ADDRESS,
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
  assert.equal(testnet.rpcUrl, "https://rpc.testnet.arc.io");
  assert.equal(testnet.gatewayChain, "arcTestnet");
  assert.equal(testnet.usdcAddress, ARC_USDC_ADDRESS);
});

test("network selection rejects missing, invalid, and mismatched environment values", () => {
  assert.throws(() => parseArcNetworkName(undefined), /must be explicitly set/);
  assert.throws(() => parseArcNetworkName("production"), /must be explicitly set/);
  assert.throws(() => assertArcNetworkPair("mainnet", "testnet"), /mixed-network/);
  assert.doesNotThrow(() => assertArcNetworkPair("mainnet", "mainnet"));
});

test("Mainnet requires explicit valid RPCs and rejects the Testnet chain ID", () => {
  assert.throws(() => getArcRpcOverride("mainnet", undefined, "ARC_MAINNET_RPC_URL"), /explicitly configured/);
  assert.throws(() => getArcRpcOverride("mainnet", "not-a-url", "ARC_MAINNET_RPC_URL"), /valid HTTP\(S\) URL/);
  assert.equal(getArcRpcOverride("mainnet", "https://rpc.mainnet.arc.io", "ARC_MAINNET_RPC_URL"), "https://rpc.mainnet.arc.io");
  assert.equal(getArcRpcOverride("testnet", undefined, "ARC_TESTNET_RPC_URL"), undefined);
  assert.doesNotThrow(() => assertArcChainId("mainnet", 5042));
  assert.throws(() => assertArcChainId("mainnet", 5042002), /does not match/);
});

test("Mainnet escrow and verifier addresses cannot reuse the known Testnet deployments", () => {
  assert.throws(() => assertNotTestnetDeploymentAddress("mainnet", ARC_TESTNET_ESCROW_ADDRESS, ARC_TESTNET_ESCROW_ADDRESS, "escrow"), /Testnet escrow/);
  assert.throws(() => assertNotTestnetDeploymentAddress("mainnet", ARC_TESTNET_VERIFIER_ADDRESS, ARC_TESTNET_VERIFIER_ADDRESS, "verifier"), /Testnet verifier/);
  assert.doesNotThrow(() => assertNotTestnetDeploymentAddress("testnet", ARC_TESTNET_ESCROW_ADDRESS, ARC_TESTNET_ESCROW_ADDRESS, "escrow"));
});

test("Mainnet verifier signing fails closed instead of falling back to Testnet secrets", () => {
  const testnetKey = `0x${"11".repeat(32)}`;
  assert.throws(() => getArcVerifierPrivateKey("mainnet", undefined, testnetKey, testnetKey), /mainnet V2 verifier signer is not configured/);
  assert.throws(() => getArcVerifierPrivateKey("mainnet", "invalid", testnetKey, testnetKey), /mainnet V2 verifier signer is not configured/);
  assert.equal(getArcVerifierPrivateKey("mainnet", testnetKey, undefined, undefined), testnetKey);
});

test("Circle Gateway Mainnet is disabled when the installed SDK lacks an Arc chain config", () => {
  assert.throws(() => assertGatewayNetwork("mainnet"), /2\.0\.4 SDK does not expose/);
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
