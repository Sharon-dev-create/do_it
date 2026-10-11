import assert from "node:assert/strict";
import test from "node:test";
import { getV2TestWorkerDiagnostic } from "./v2-test-workers.ts";

const worker = "0x4686a159487a97F8b2747485eF0653568aa6d521";

test("reports missing allowlist configuration without allowing the worker", () => {
  assert.deepEqual(getV2TestWorkerDiagnostic(undefined, worker), {
    configured: false,
    workerAllowed: false,
  });
});

test("allows the worker when present in the comma-separated allowlist", () => {
  assert.deepEqual(getV2TestWorkerDiagnostic(`0x0000000000000000000000000000000000000001, ${worker}`, worker), {
    configured: true,
    workerAllowed: true,
  });
});

test("does not allow a worker that is absent from the allowlist", () => {
  assert.deepEqual(getV2TestWorkerDiagnostic("0x0000000000000000000000000000000000000001", worker), {
    configured: true,
    workerAllowed: false,
  });
});

test("matches an allowlist entry case-insensitively", () => {
  const uppercaseEntry = worker.toUpperCase().replace("0X", "0x");
  assert.deepEqual(getV2TestWorkerDiagnostic(uppercaseEntry, worker), {
    configured: true,
    workerAllowed: true,
  });
});
