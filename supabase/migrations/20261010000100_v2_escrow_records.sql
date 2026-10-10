-- Forward-only V2 metadata; existing rows retain the legacy V1/Gateway defaults.
alter table public.tasks
  add column if not exists contract_version text not null default 'v1'
    check (contract_version in ('v1', 'v2'));

alter table public.submissions
  add column if not exists claim_tx_hash text;

alter table public.task_payments
  add column if not exists payment_mechanism text not null default 'circle_gateway'
    check (payment_mechanism in ('circle_gateway', 'v2_reward_credit'));

alter table public.task_payments drop constraint if exists task_payments_status_check;
alter table public.task_payments add constraint task_payments_status_check
  check (status in ('pending', 'processing', 'submitted', 'confirmed', 'failed'));

create index if not exists tasks_contract_version_status_idx
  on public.tasks(contract_version, status);

create unique index if not exists tasks_create_tx_hash_unique
  on public.tasks(create_tx_hash)
  where create_tx_hash is not null;
