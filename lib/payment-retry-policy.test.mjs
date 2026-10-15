import assert from "node:assert/strict";
import test from "node:test";

const { isAuthorizedGatewayPaymentRetry } =
  await import("./payment-retry-policy.ts");

const payment = {
  id: "payment-1",
  task_id: "task-1",
  submission_id: "submission-1",
  worker_address: `0x${"11".repeat(20)}`,
  amount_usdc: "2.500000",
  payment_mechanism: "circle_gateway",
  status: "failed",
  tx_hash: null,
};
const task = {
  id: "task-1",
  status: "completed",
  reward_usdc: "2.5",
  contract_version: "v1",
  created_by: `0x${"33".repeat(20)}`,
};
const submission = {
  id: "submission-1",
  task_id: "task-1",
  worker_address: payment.worker_address,
  is_correct: true,
  status: "approved",
};

test("an authorized failed Gateway payment can be retried only for its approved worker and task reward", () => {
  assert.equal(isAuthorizedGatewayPaymentRetry(payment, task, submission), true);
  assert.equal(
    isAuthorizedGatewayPaymentRetry(
      { ...payment, worker_address: `0x${"22".repeat(20)}` },
      task,
      submission,
    ),
    false,
  );
  assert.equal(
    isAuthorizedGatewayPaymentRetry(
      { ...payment, amount_usdc: "2.500001" },
      task,
      submission,
    ),
    false,
  );
  assert.equal(
    isAuthorizedGatewayPaymentRetry(
      { ...payment, tx_hash: `0x${"aa".repeat(32)}` },
      task,
      submission,
    ),
    false,
  );
  assert.equal(
    isAuthorizedGatewayPaymentRetry(
      payment,
      task,
      { ...submission, is_correct: false },
    ),
    false,
  );
  assert.equal(
    isAuthorizedGatewayPaymentRetry(
      payment,
      { ...task, contract_version: "v2" },
      submission,
    ),
    false,
  );
  assert.equal(
    isAuthorizedGatewayPaymentRetry(
      payment,
      { ...task, contract_version: null },
      submission,
    ),
    false,
  );
});
