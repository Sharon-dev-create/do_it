export type BulkTaskRow = { title: string; description: string; reward_usdc: string; correct_answer: string };
export type ParsedBulkRow = { rowNumber: number; task: BulkTaskRow; errors: string[]; duplicateOf?: number };
const HEADERS = ["title", "description", "reward_usdc", "correct_answer"];
export const BULK_TASK_MAX_ROWS = 250;
export const BULK_TASK_MAX_FILE_BYTES = 2 * 1024 * 1024;

function csvRecords(input: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.length === 0) quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field); records.push(row); row = []; field = "";
    } else field += ch;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  if (field.length || row.length) { row.push(field); records.push(row); }
  return records.filter((record) => record.some((cell) => cell.trim() !== ""));
}

function identity(task: BulkTaskRow) { return [task.title, task.description, task.reward_usdc, task.correct_answer].map((v) => v.trim().toLowerCase()).join("\u0000"); }

export function parseBulkTaskCsv(input: string): ParsedBulkRow[] {
  const records = csvRecords(input);
  if (!records.length) throw new Error("CSV is empty");
  const header = records[0].map((v) => v.trim().toLowerCase());
  if (header.length !== HEADERS.length || header.some((v, i) => v !== HEADERS[i])) throw new Error("CSV header must be: title,description,reward_usdc,correct_answer");
  if (records.length - 1 > BULK_TASK_MAX_ROWS) throw new Error(`CSV can contain at most ${BULK_TASK_MAX_ROWS} task rows`);
  const seen = new Map<string, number>();
  return records.slice(1).map((record, index) => {
    const rowNumber = index + 2;
    const task: BulkTaskRow = { title: record[0] ?? "", description: record[1] ?? "", reward_usdc: record[2] ?? "", correct_answer: record[3] ?? "" };
    const errors: string[] = [];
    if (record.length !== HEADERS.length) errors.push("Expected exactly 4 columns");
    if (task.title.trim().length < 3 || task.title.trim().length > 120) errors.push("Title must be 3–120 characters");
    if (task.description.trim().length < 10 || task.description.trim().length > 10000) errors.push("Description must be 10–10,000 characters");
    if (!/^\d+(?:\.\d{1,6})?$/.test(task.reward_usdc.trim()) || Number(task.reward_usdc) <= 0) errors.push("Reward must be a positive USDC amount with up to 6 decimals");
    if (!task.correct_answer.trim() || task.correct_answer.length > 1000) errors.push("Expected answer must be 1–1,000 characters");
    const key = identity(task);
    const duplicateOf = seen.get(key);
    if (duplicateOf) errors.push(`Duplicate of CSV row ${duplicateOf}`);
    else seen.set(key, rowNumber);
    return { rowNumber, task, errors, duplicateOf };
  });
}

export function csvEscape(value: string) { return `"${value.replace(/"/g, '""')}"`; }
