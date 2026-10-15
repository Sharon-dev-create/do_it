import { isAddress, parseUnits } from "viem";

type RetryPayment = {
  id: string;
  task_id: string;
  submission_id: string | null;
  worker_address: string;
  amount_usdc: string | number;
  payment_mechanism: string;
  status: string;
  tx_hash: string | null;
};

type RetryTask = {
  id: string;
  status: string;
  reward_usdc: string | number;
  contract_version: string | null;
  created_by: string;
};

type RetrySubmission = {
  id: string;
  task_id: string;
  worker_address: string;
  is_correct: boolean | null;
  status: string;
};

export function isAuthorizedGatewayPaymentRetry(
  payment: RetryPayment,
  task: RetryTask,
  submission: RetrySubmission | null,
): boolean {
  if (
    payment.payment_mechanism !== "circle_gateway" ||
    payment.status !== "failed" ||
    payment.tx_hash !== null ||
    payment.task_id !== task.id ||
    task.status !== "completed" ||
    task.contract_version !== "v1" ||
    !submission ||
    !isAddress(payment.worker_address) ||
    !isAddress(task.created_by) ||
    !isAddress(submission.worker_address) ||
    payment.submission_id !== submission.id ||
    submission.task_id !== task.id ||
    submission.worker_address.toLowerCase() !== payment.worker_address.toLowerCase() ||
    task.created_by.toLowerCase() === payment.worker_address.toLowerCase() ||
    submission.is_correct !== true ||
    submission.status !== "approved"
  ) {
    return false;
  }

  try {
    return (
      parseUnits(String(payment.amount_usdc), 6) > 0n &&
      parseUnits(String(payment.amount_usdc), 6) ===
        parseUnits(String(task.reward_usdc), 6)
    );
  } catch {
    return false;
  }
}
