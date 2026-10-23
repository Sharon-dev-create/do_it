import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_ARC_NETWORK ??= "testnet";
const { validateArcTestnetEscrowDeployment, assertServerArcEscrowDeployment } =
  await import("./arc-deployment-validation.ts");

function client({ chainId = 5042002, code = "0x60016000", error } = {}) {
  return {
    async getChainId() { if (error) throw error; return chainId; },
    async getCode() { if (error) throw error; return code; },
  };
}

const settings = { network: "testnet", publicNetwork: "testnet", rpcUrl: "https://rpc.testnet.arc.io" };

test("server deployment validation accepts Arc Testnet with escrow bytecode", async () => {
  await assert.doesNotReject(validateArcTestnetEscrowDeployment(client(), settings));
});

test("server deployment validation fails closed when configuration is missing or invalid", async () => {
  await assert.rejects(validateArcTestnetEscrowDeployment(client(), { ...settings, rpcUrl: undefined }), /ARC_TESTNET_RPC_URL/);
  await assert.rejects(validateArcTestnetEscrowDeployment(client(), { ...settings, rpcUrl: "file:///tmp/rpc" }), /valid HTTP\(S\) URL/);
  await assert.rejects(validateArcTestnetEscrowDeployment(client(), { ...settings, network: undefined }), /ARC_NETWORK=testnet/);
  await assert.rejects(validateArcTestnetEscrowDeployment(client(), { ...settings, publicNetwork: "mainnet" }), /must match/);
});

test("server deployment validation rejects a wrong RPC chain", async () => {
  await assert.rejects(validateArcTestnetEscrowDeployment(client({ chainId: 5042 }), settings), /does not match Arc Testnet/);
});

test("server deployment validation rejects missing escrow bytecode", async () => {
  await assert.rejects(validateArcTestnetEscrowDeployment(client({ code: "0x" }), settings), /No escrow contract is deployed/);
  await assert.rejects(validateArcTestnetEscrowDeployment(client({ code: undefined }), settings), /No escrow contract is deployed/);
});

test("RPC errors reject deployment validation", async () => {
  await assert.rejects(validateArcTestnetEscrowDeployment(client({ error: new Error("RPC unavailable") }), settings), /RPC unavailable/);
});

test("create-task preflight stops before contract writes when server validation fails", async () => {
  let writes = 0;
  const badServer = async () => new Response(JSON.stringify({ error: "Escrow unavailable" }), { status: 503 });
  await assert.rejects(assertServerArcEscrowDeployment(badServer), /Escrow unavailable/);
  try {
    await assertServerArcEscrowDeployment(badServer);
    writes += 1;
  } catch {}
  assert.equal(writes, 0);
});
