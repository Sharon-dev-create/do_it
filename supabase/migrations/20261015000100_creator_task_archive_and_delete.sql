alter table public.tasks
  add column if not exists archived_at timestamptz,
  add column if not exists creation_batch_id uuid,
  add column if not exists creation_row_number integer;

create table if not exists public.task_creation_batches (
  id uuid primary key,
  creator_wallet text not null check (creator_wallet ~ '^0x[0-9a-f]{40}$'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  row_count integer not null check (row_count between 1 and 250),
  created_at timestamptz not null default now()
);

alter table public.tasks drop constraint if exists tasks_creation_batch_fk;
alter table public.tasks
  add constraint tasks_creation_batch_fk foreign key (creation_batch_id)
    references public.task_creation_batches(id) on delete restrict;

create unique index if not exists tasks_creation_batch_row_unique
  on public.tasks(creation_batch_id, creation_row_number)
  where creation_batch_id is not null;

alter table public.task_creation_batches enable row level security;
revoke all on public.task_creation_batches from anon, authenticated;

create index if not exists tasks_open_unarchived_created_at_idx
  on public.tasks(created_at desc)
  where status = 'open' and archived_at is null;

create or replace function public.delete_creator_task(p_task_id uuid, p_creator_wallet text, p_v2_chain_status integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.tasks%rowtype;
  has_submissions boolean;
  has_payments boolean;
  has_unresolved_payment boolean;
begin
  select * into task_row from public.tasks where id = p_task_id for update;
  if not found then
    return jsonb_build_object('task_id', p_task_id, 'outcome', 'not_found');
  end if;

  if p_creator_wallet is null or lower(task_row.created_by) <> lower(p_creator_wallet) then
    return jsonb_build_object('task_id', p_task_id, 'outcome', 'forbidden');
  end if;

  if task_row.archived_at is not null then
    return jsonb_build_object('task_id', p_task_id, 'outcome', 'already_archived');
  end if;

  select exists(select 1 from public.submissions where task_id = p_task_id) into has_submissions;
  select exists(select 1 from public.task_payments where task_id = p_task_id) into has_payments;
  select exists(select 1 from public.task_payments where task_id = p_task_id and status <> 'confirmed') into has_unresolved_payment;

  if has_unresolved_payment then
    return jsonb_build_object('task_id', p_task_id, 'outcome', 'blocked', 'reason', 'A payment is pending, failed, or may still be retried. Resolve it before archiving.');
  end if;

  if task_row.contract_version = 'v2' then
    if p_v2_chain_status is null or p_v2_chain_status not in (3, 4) or task_row.blockchain_task_id is null or
       task_row.create_tx_hash is null or task_row.fund_tx_hash is null then
      return jsonb_build_object('task_id', p_task_id, 'outcome', 'blocked', 'reason', 'V2 tasks can only be archived after the escrow contract reports a verified completed or refunded state.');
    end if;
    if p_v2_chain_status = 3 and (
      task_row.status <> 'completed' or not exists (
        select 1 from public.task_payments
        where task_id = p_task_id and payment_mechanism = 'v2_reward_credit'
          and status = 'confirmed' and tx_hash is not null
      )
    ) then
      return jsonb_build_object('task_id', p_task_id, 'outcome', 'blocked', 'reason', 'The completed V2 escrow has no confirmed reward-credit transaction.');
    end if;
    if p_v2_chain_status = 4 and exists (
      select 1 from public.task_payments
      where task_id = p_task_id and payment_mechanism = 'v2_reward_credit' and status = 'confirmed'
    ) then
      return jsonb_build_object('task_id', p_task_id, 'outcome', 'blocked', 'reason', 'The recorded V2 reward state conflicts with the escrow refund state.');
    end if;
  end if;

  if task_row.status = 'claimed' then
    return jsonb_build_object('task_id', p_task_id, 'outcome', 'blocked', 'reason', 'The task is claimed and its reward flow is unresolved.');
  end if;

  if has_submissions or has_payments or task_row.create_tx_hash is not null or task_row.fund_tx_hash is not null then
    update public.tasks set archived_at = now(), updated_at = now() where id = p_task_id;
    return jsonb_build_object('task_id', p_task_id, 'outcome', 'archived');
  end if;

  if task_row.contract_version = 'v1' and task_row.status = 'open' then
    delete from public.tasks where id = p_task_id;
    return jsonb_build_object('task_id', p_task_id, 'outcome', 'deleted');
  end if;

  return jsonb_build_object('task_id', p_task_id, 'outcome', 'blocked', 'reason', 'This task state is not eligible for deletion.');
end;
$$;

create or replace function public.delete_creator_tasks(p_task_ids uuid[], p_creator_wallet text, p_v2_chain_statuses jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  task_id uuid;
  chain_status integer;
  outcomes jsonb := '[]'::jsonb;
begin
  if p_task_ids is null or cardinality(p_task_ids) < 1 or cardinality(p_task_ids) > 100 then
    raise exception 'Batch must contain between 1 and 100 task IDs';
  end if;
  if (select count(*) from unnest(p_task_ids) as ids(id)) <> (select count(distinct id) from unnest(p_task_ids) as ids(id)) then
    raise exception 'Duplicate task IDs are not allowed';
  end if;

  if p_v2_chain_statuses is not null and jsonb_typeof(p_v2_chain_statuses) <> 'object' then
    raise exception 'V2 chain statuses must be an object';
  end if;
  for task_id in select ids.id from unnest(p_task_ids) as ids(id) order by ids.id loop
    chain_status := null;
    if p_v2_chain_statuses is not null and p_v2_chain_statuses ? task_id::text then
      begin
        chain_status := (p_v2_chain_statuses->>task_id::text)::integer;
      exception when others then
        chain_status := null;
      end;
    end if;
    outcomes := outcomes || jsonb_build_array(public.delete_creator_task(task_id, p_creator_wallet, chain_status));
  end loop;
  return outcomes;
end;
$$;

revoke all on function public.delete_creator_task(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.delete_creator_tasks(uuid[], text, jsonb) from public, anon, authenticated;
grant execute on function public.delete_creator_task(uuid, text, integer) to service_role;
grant execute on function public.delete_creator_tasks(uuid[], text, jsonb) to service_role;

create or replace function public.create_creator_task_batch(
  p_batch_id uuid,
  p_creator_wallet text,
  p_payload_hash text,
  p_tasks jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_row public.task_creation_batches%rowtype;
  task_total integer;
  batch_tasks jsonb;
  inserted_batch boolean;
begin
  if p_batch_id is null or p_creator_wallet is null or p_creator_wallet !~ '^0x[0-9a-f]{40}$' or
     p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' or p_tasks is null or jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'Invalid task batch metadata';
  end if;
  task_total := jsonb_array_length(p_tasks);
  if task_total < 1 or task_total > 250 then
    raise exception 'Batch must contain between 1 and 250 tasks';
  end if;

  insert into public.task_creation_batches(id, creator_wallet, payload_hash, row_count)
  values (p_batch_id, p_creator_wallet, p_payload_hash, task_total)
  on conflict (id) do nothing;
  inserted_batch := found;
  select * into batch_row from public.task_creation_batches where id = p_batch_id for update;

  if batch_row.creator_wallet <> p_creator_wallet or batch_row.payload_hash <> p_payload_hash or batch_row.row_count <> task_total then
    return jsonb_build_object('outcome', 'idempotency_conflict');
  end if;

  select count(*) into task_total from public.tasks where creation_batch_id = p_batch_id;
  if not inserted_batch and task_total <> batch_row.row_count then
    return jsonb_build_object('outcome', 'incomplete_batch');
  end if;
  if inserted_batch then
    insert into public.tasks(
      title, description, reward_usdc, correct_answer, created_by, status,
      contract_version, creation_batch_id, creation_row_number
    )
    select
      value->>'title', value->>'description', (value->>'reward_usdc')::numeric,
      value->>'correct_answer', p_creator_wallet, 'open', 'v1', p_batch_id, ordinal::integer
    from jsonb_array_elements(p_tasks) with ordinality as rows(value, ordinal);
  end if;

  select jsonb_agg(jsonb_build_object(
    'id', id, 'row_number', creation_row_number, 'title', title, 'description', description,
    'reward_usdc', reward_usdc, 'status', status, 'contract_version', contract_version,
    'created_at', created_at
  ) order by creation_row_number)
  into batch_tasks
  from public.tasks where creation_batch_id = p_batch_id;

  return jsonb_build_object('outcome', 'created', 'replayed', not inserted_batch, 'tasks', coalesce(batch_tasks, '[]'::jsonb));
end;
$$;

revoke all on function public.create_creator_task_batch(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_creator_task_batch(uuid, text, text, jsonb) to service_role;

create or replace function public.record_rejected_task_submission(
  p_task_id uuid,
  p_worker_address text,
  p_answer text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  task_status text;
  task_archived_at timestamptz;
  submission_row public.submissions%rowtype;
begin
  select status, archived_at into task_status, task_archived_at
  from public.tasks where id = p_task_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if task_archived_at is not null then
    return jsonb_build_object('outcome', 'archived');
  end if;
  if task_status <> 'open' then
    return jsonb_build_object('outcome', 'closed');
  end if;
  insert into public.submissions(task_id, worker_address, answer, is_correct, status, verified_at)
  values (p_task_id, p_worker_address, p_answer, false, 'rejected', now())
  returning * into submission_row;
  return jsonb_build_object(
    'outcome', 'recorded',
    'submission', jsonb_build_object(
      'id', submission_row.id, 'task_id', submission_row.task_id,
      'worker_address', submission_row.worker_address, 'is_correct', submission_row.is_correct,
      'status', submission_row.status, 'created_at', submission_row.created_at
    )
  );
end;
$$;
revoke all on function public.record_rejected_task_submission(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_rejected_task_submission(uuid, text, text) to service_role;
