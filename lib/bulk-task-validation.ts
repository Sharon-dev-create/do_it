import { parseUnits } from "viem";

export type NewBulkTask = { title: string; description: string; reward_usdc: string; correct_answer: string };

export function isValidBulkTask(value: unknown): value is NewBulkTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.title !== "string" || row.title.trim().length < 3 || row.title.trim().length > 120 ||
      typeof row.description !== "string" || row.description.trim().length < 10 || row.description.trim().length > 10000 ||
      typeof row.correct_answer !== "string" || !row.correct_answer.trim() || row.correct_answer.length > 1000 ||
      typeof row.reward_usdc !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(row.reward_usdc.trim())) return false;
  try {
    const amount = parseUnits(row.reward_usdc.trim(), 6);
    return amount > 0n && amount <= 99_999_999_999_999_999_999n;
  } catch { return false; }
}
