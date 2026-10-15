-- Core marketplace records contain task answers and payment authorization data.
-- Browser clients must use the authenticated server routes rather than direct table access.
alter table public.tasks enable row level security;
alter table public.submissions enable row level security;
alter table public.task_payments enable row level security;

revoke all privileges on table public.tasks from public, anon, authenticated;
revoke all privileges on table public.submissions from public, anon, authenticated;
revoke all privileges on table public.task_payments from public, anon, authenticated;

grant all privileges on table public.tasks to service_role;
grant all privileges on table public.submissions to service_role;
grant all privileges on table public.task_payments to service_role;
