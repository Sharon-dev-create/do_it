alter table public.tasks
  add column if not exists archived_at timestamptz;

create index if not exists tasks_open_unarchived_created_at_idx
  on public.tasks(created_at desc)
  where status = 'open' and archived_at is null;

create or replace function public.delete_creator_task(p_task_id uuid, p_creator_wallet text)
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

  if task_row.contract_version = 'v2' and task_row.status in ('open', 'claimed') then
    return jsonb_build_object('task_id', p_task_id, 'outcome', 'blocked', 'reason', 'V2 escrow may still hold this task allocation. Use a verified refund or settlement flow before deleting it.');
  end if;

  if task_row.contract_version = 'v2' and task_row.fund_tx_hash is not null and (
    task_row.status <> 'completed' or not exists (
      select 1 from public.task_payments
      where task_id = p_task_id and payment_mechanism = 'v2_reward_credit' and status = 'confirmed'
    )
  ) then
    return jsonb_build_object('task_id', p_task_id, 'outcome', 'blocked', 'reason', 'The V2 escrow allocation has no confirmed settlement record. Verify refund or settlement before deleting it.');
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

create or replace function public.delete_creator_tasks(p_task_ids uuid[], p_creator_wallet text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  task_id uuid;
  outcomes jsonb := '[]'::jsonb;
begin
  if p_task_ids is null or cardinality(p_task_ids) < 1 or cardinality(p_task_ids) > 100 then
    raise exception 'Batch must contain between 1 and 100 task IDs';
  end if;
  if (select count(*) from unnest(p_task_ids) as ids(id)) <> (select count(distinct id) from unnest(p_task_ids) as ids(id)) then
    raise exception 'Duplicate task IDs are not allowed';
  end if;

  foreach task_id in array p_task_ids loop
    outcomes := outcomes || jsonb_build_array(public.delete_creator_task(task_id, p_creator_wallet));
  end loop;
  return outcomes;
end;
$$;

revoke all on function public.delete_creator_task(uuid, text) from public, anon, authenticated;
revoke all on function public.delete_creator_tasks(uuid[], text) from public, anon, authenticated;
grant execute on function public.delete_creator_task(uuid, text) to service_role;
grant execute on function public.delete_creator_tasks(uuid[], text) to service_role;
