export type TaskSubmissionPayload = {
  worker_address: string;
  answer: string;
  submission_id?: string;
  claim_tx_hash?: `0x${string}`;
};

export function postTaskAnswer(taskId: string, payload: TaskSubmissionPayload, fetcher: typeof fetch = fetch) {
  return fetcher(`/api/tasks/${encodeURIComponent(taskId)}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
