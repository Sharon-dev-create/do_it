export type TaskSubmissionPayload = {
  worker_address: string;
  answer: string;
  submission_id?: string;
  claim_tx_hash?: `0x${string}`;
};

export function isTaskRewardConfirmed(
  contractVersion: "v1" | "v2",
  result: { correct?: boolean; credited?: boolean } | null,
) {
  return Boolean(
    result?.correct && (contractVersion === "v1" || result.credited),
  );
}

export function getTaskSubmissionNotice(result: { correct?: boolean; error?: string; message?: string } | null) {
  if (!result) return null;
  if (result.error) return result.error;
  if (result.correct === false && result.message) return result.message;
  return null;
}

export function postTaskAnswer(taskId: string, payload: TaskSubmissionPayload, fetcher: typeof fetch = fetch) {
  return fetcher(`/api/tasks/${encodeURIComponent(taskId)}/submit`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
