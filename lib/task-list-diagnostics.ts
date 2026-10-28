export type TaskListFailureStage = "client_init" | "query" | "serialize";

export type TaskListConfigIssue =
  | "SUPABASE_URL_MISSING"
  | "SUPABASE_URL_INVALID"
  | "SUPABASE_SERVICE_ROLE_KEY_MISSING"
  | "SUPABASE_SERVICE_ROLE_KEY_INVALID";

const TASK_FIELDS = new Set([
  "id",
  "title",
  "description",
  "reward_usdc",
  "created_by",
  "status",
  "created_at",
  "updated_at",
  "blockchain_task_id",
  "create_tx_hash",
  "fund_tx_hash",
  "contract_version",
  "archived_at",
]);

export function validateTaskListSupabaseConfig(
  url: string | undefined,
  serviceRoleKey: string | undefined,
): TaskListConfigIssue[] {
  const issues: TaskListConfigIssue[] = [];

  if (!url?.trim()) {
    issues.push("SUPABASE_URL_MISSING");
  } else {
    try {
      const parsed = new URL(url);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        !parsed.hostname ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      ) {
        issues.push("SUPABASE_URL_INVALID");
      }
    } catch {
      issues.push("SUPABASE_URL_INVALID");
    }
  }

  if (!serviceRoleKey?.trim()) {
    issues.push("SUPABASE_SERVICE_ROLE_KEY_MISSING");
  } else if (
    serviceRoleKey !== serviceRoleKey.trim() ||
    /[\u0000-\u001f\u007f]/.test(serviceRoleKey)
  ) {
    issues.push("SUPABASE_SERVICE_ROLE_KEY_INVALID");
  }

  return issues;
}

function getErrorProperty(error: unknown, key: "code" | "message"): string | undefined {
  if (!error || typeof error !== "object" || !(key in error)) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function safeDatabaseMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;

  const missingField = message.match(
    /(?:column|field)\s+["']?([a-z_]+)["']?\s+(?:of\s+relation\s+["']?tasks["']?\s+)?does not exist/i,
  )?.[1]?.toLowerCase();
  const cachedField = message.match(
    /could not find the ["']([a-z_]+)["'] column of ["']tasks["'] in the schema cache/i,
  )?.[1]?.toLowerCase();
  const field = missingField ?? cachedField;
  if (field && TASK_FIELDS.has(field)) {
    return `Task-list schema is missing field ${field}.`;
  }
  if (/permission denied for table ["']?tasks["']?/i.test(message)) {
    return "Database denied access to the tasks table.";
  }
  if (/relation ["']?tasks["']? does not exist/i.test(message)) {
    return "Task-list schema is missing the tasks table.";
  }
  if (/schema cache/i.test(message)) {
    return "PostgREST could not resolve the task-list schema.";
  }
  if (/fetch failed|failed to fetch|network error/i.test(message)) {
    return "Supabase request failed before receiving a database response.";
  }
  if (/timed? ?out|timeout/i.test(message)) {
    return "Supabase task query timed out.";
  }
  return undefined;
}

export function taskListFailureDiagnostic(
  error: unknown,
  stage: TaskListFailureStage,
) {
  const rawCode = getErrorProperty(error, "code");
  const code = rawCode && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(rawCode)
    ? rawCode
    : undefined;
  const message = safeDatabaseMessage(getErrorProperty(error, "message"));

  return {
    category: code ? "database" : error instanceof TypeError ? "supabase_request" : "unexpected",
    stage,
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
  };
}

export async function runTaskListQuery<T>(
  query: () => PromiseLike<{ data: T | null; error: unknown }>,
  onFailure: (error: unknown) => void,
): Promise<{ ok: true; data: T | null } | { ok: false }> {
  try {
    const { data, error } = await query();
    if (error) {
      onFailure(error);
      return { ok: false };
    }
    return { ok: true, data };
  } catch (error) {
    onFailure(error);
    return { ok: false };
  }
}
