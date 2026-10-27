import { isValidTaskId } from "./task-id";

export function fetchTaskDetails(
  taskId: unknown,
  workerAddress: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<Response> | null {
  if (!isValidTaskId(taskId)) return null;

  const suffix = workerAddress ? `?worker=${encodeURIComponent(workerAddress)}` : "";
  return fetcher(`/api/tasks/${taskId}${suffix}`);
}
