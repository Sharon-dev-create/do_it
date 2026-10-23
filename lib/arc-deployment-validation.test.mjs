import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.NEXT_PUBLIC_ARC_NETWORK ??= "testnet";
const { validateArcTestnetEscrowDeployment, assertServerArcEscrowDeployment } =
  await import("./arc-deployment-validation.ts");
const {
  ARC_PREFLIGHT_PUBLIC_ERROR,
  ArcPreflightError,
  classifyArcPreflightFailure,
  createArcPreflightErrorResponse,
  logArcPreflightFailure,
} = await import("./arc-preflight-diagnostics.ts");

function client(options = {}) {
  const chainId = options.chainId ?? 5042002;
  const code = Object.hasOwn(options, "code") ? options.code : "0x60016000";
  const error = options.error;
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
  await assert.rejects(
    validateArcTestnetEscrowDeployment(client({ error: new Error("RPC unavailable") }), settings),
    (error) => error.code === "RPC_UNAVAILABLE" && error.stage === "rpc_chain_id",
  );
});

test("preflight failures map to allowlisted diagnostic codes and stages", () => {
  const cases = [
    ["NETWORK_CONFIG_INVALID", "network_config"],
    ["RPC_URL_MISSING", "rpc_url"],
    ["RPC_URL_INVALID", "rpc_url"],
    ["RPC_UNAVAILABLE", "rpc_chain_id"],
    ["RPC_WRONG_CHAIN", "rpc_chain_id"],
    ["ESCROW_CODE_MISSING", "escrow_code_check"],
    ["VERIFIER_CONFIG_INVALID", "verifier_config"],
    ["USDC_ADDRESS_INVALID", "usdc_address_check"],
    ["USDC_DECIMALS_INVALID", "usdc_decimals_check"],
    ["ESCROW_CONFIGURATION_INVALID", "escrow_configuration_check"],
    ["PREFLIGHT_UNEXPECTED_ERROR", "unexpected"],
  ];
  for (const [code, stage] of cases) {
    const error = new ArcPreflightError(code, stage, "safe message");
    assert.deepEqual(classifyArcPreflightFailure(error, "unexpected"), { code, stage });
  }
  assert.deepEqual(classifyArcPreflightFailure(new Error("private detail"), "usdc_decimals_read"), {
    code: "RPC_UNAVAILABLE",
    stage: "usdc_decimals_read",
  });
});

test("diagnostic logs and HTTP response exclude sensitive exception details", async () => {
  const sensitive = "https://user:secret@rpc.example/?token=private";
  const logged = [];
  const diagnostic = logArcPreflightFailure(
    new Error(sensitive),
    "rpc_chain_id",
    (entry) => logged.push(entry),
  );
  assert.deepEqual(diagnostic, { code: "RPC_UNAVAILABLE", stage: "rpc_chain_id" });
  assert.deepEqual(logged, [diagnostic]);
  assert.equal(JSON.stringify(logged).includes(sensitive), false);

  const response = createArcPreflightErrorResponse();
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.equal(body, JSON.stringify({ error: ARC_PREFLIGHT_PUBLIC_ERROR }));
  assert.equal(body.includes(sensitive), false);
});

test("create-task preflight stops before contract writes when server validation fails", async () => {
  const page = await readFile(new URL("../app/create-task/page.tsx", import.meta.url), "utf8");
  assert.ok(page.indexOf("await assertServerArcEscrowDeployment()") < page.indexOf("writeContractAsync({"));
  let writes = 0;
  const badServer = async () => new Response(JSON.stringify({ error: "Escrow unavailable" }), { status: 503 });
  await assert.rejects(assertServerArcEscrowDeployment(badServer), /Escrow unavailable/);
  try {
    await assertServerArcEscrowDeployment(badServer);
    writes += 1;
  } catch {}
  assert.equal(writes, 0);
});
