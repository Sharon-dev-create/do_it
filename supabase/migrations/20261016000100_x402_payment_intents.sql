-- Durable x402 authorization state. Signed authorizations and signatures are
-- intentionally not stored.
create table public.x402_payment_intents (
  id uuid primary key default gen_random_uuid(),
  network text not null,
  domain_id integer not null check (domain_id >= 0),
  verifying_contract text not null,
  payer text not null,
  recipient text not null,
  token text not null,
  amount_base_units numeric(78, 0) not null check (amount_base_units > 0),
  authorization_nonce text not null,
  endpoint text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in (
    'verified',
    'settlement_submitted',
    'recovery_pending',
    'provider_accepted',
    'response_ready',
    'operator_review',
    'rejected'
  )),
  provider_transfer_id text,
  provider_status text,
  attempt_count integer not null default 0 check (attempt_count between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settlement_submitted_at timestamptz,
  provider_accepted_at timestamptz,
  response_ready_at timestamptz,
  response_status integer check (response_status between 100 and 599),
  response_body jsonb,
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  unique (network, domain_id, verifying_contract, payer, authorization_nonce),
  unique (network, provider_transfer_id)
);

alter table public.x402_payment_intents enable row level security;
revoke all privileges on table public.x402_payment_intents
  from public, anon, authenticated, service_role;

alter table public.payment_events
  add column intent_id uuid references public.x402_payment_intents(id);
create unique index payment_events_intent_id_unique
  on public.payment_events(intent_id)
  where intent_id is not null;

-- Payment events from this point on are written only through the atomic
-- acceptance RPC, so an event and its intent state cannot diverge.
revoke insert, update, delete on table public.payment_events
  from public, anon, authenticated, service_role;
revoke all privileges on table public.payment_events from service_role;

create or replace function public.get_x402_payment_intent(
  p_network text,
  p_domain_id integer,
  p_verifying_contract text,
  p_payer text,
  p_authorization_nonce text
)
returns table (
  intent_id uuid,
  network text,
  domain_id integer,
  verifying_contract text,
  payer text,
  recipient text,
  token text,
  amount_base_units numeric,
  authorization_nonce text,
  endpoint text,
  request_hash text,
  status text,
  response_status integer,
  response_body jsonb,
  provider_transfer_id text,
  provider_status text
)
language sql
security definer
set search_path = pg_catalog
as $$
  select
    i.id,
    i.network,
    i.domain_id,
    i.verifying_contract,
    i.payer,
    i.recipient,
    i.token,
    i.amount_base_units,
    i.authorization_nonce,
    i.endpoint,
    i.request_hash,
    i.status,
    i.response_status,
    i.response_body,
    i.provider_transfer_id,
    i.provider_status
  from public.x402_payment_intents i
  where i.network = p_network
    and i.domain_id = p_domain_id
    and i.verifying_contract = lower(p_verifying_contract)
    and i.payer = lower(p_payer)
    and i.authorization_nonce = lower(p_authorization_nonce)
$$;

create or replace function public.prepare_x402_payment_intent(
  p_network text,
  p_domain_id integer,
  p_verifying_contract text,
  p_payer text,
  p_recipient text,
  p_token text,
  p_amount_base_units numeric,
  p_authorization_nonce text,
  p_endpoint text,
  p_request_hash text
)
returns table (
  intent_id uuid,
  intent_status text,
  response_status integer,
  response_body jsonb,
  provider_transfer_id text,
  provider_status text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_intent public.x402_payment_intents%rowtype;
begin
  insert into public.x402_payment_intents (
    network, domain_id, verifying_contract, payer, recipient, token,
    amount_base_units, authorization_nonce, endpoint, status
    , request_hash
  )
  values (
    p_network, p_domain_id, lower(p_verifying_contract), lower(p_payer),
    lower(p_recipient), lower(p_token), p_amount_base_units,
    lower(p_authorization_nonce), p_endpoint, 'verified', p_request_hash
  )
  on conflict (network, domain_id, verifying_contract, payer, authorization_nonce)
  do nothing;

  select * into strict v_intent
  from public.x402_payment_intents i
  where i.network = p_network
    and i.domain_id = p_domain_id
    and i.verifying_contract = lower(p_verifying_contract)
    and i.payer = lower(p_payer)
    and i.authorization_nonce = lower(p_authorization_nonce)
  for update;

  if v_intent.recipient <> lower(p_recipient)
    or v_intent.token <> lower(p_token)
    or v_intent.amount_base_units <> p_amount_base_units
    or v_intent.endpoint <> p_endpoint
    or v_intent.request_hash <> p_request_hash then
    raise exception 'x402 authorization was already bound to different payment requirements';
  end if;

  return query select
    v_intent.id,
    v_intent.status,
    v_intent.response_status,
    v_intent.response_body,
    v_intent.provider_transfer_id,
    v_intent.provider_status;
end;
$$;

create or replace function public.claim_x402_payment_intent(p_intent_id uuid)
returns table (claimed boolean, intent_status text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_status text;
begin
  update public.x402_payment_intents i
  set status = 'settlement_submitted',
      attempt_count = 1,
      settlement_submitted_at = now(),
      updated_at = now()
  where i.id = p_intent_id
    and i.status = 'verified'
    and i.attempt_count = 0;

  if found then
    return query select true, 'settlement_submitted'::text;
    return;
  end if;

  select i.status into v_status
  from public.x402_payment_intents i
  where i.id = p_intent_id;
  if not found then
    raise exception 'x402 payment intent not found';
  end if;
  return query select false, v_status;
end;
$$;

create or replace function public.mark_x402_payment_recovery_pending(
  p_intent_id uuid,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  update public.x402_payment_intents i
  set status = 'recovery_pending',
      last_error_code = case
        when p_error_code ~ '^[a-z0-9_]{1,64}$' then p_error_code
        else 'settlement_outcome_unknown'
      end,
      updated_at = now()
  where i.id = p_intent_id
    and i.status = 'settlement_submitted';
  if not found then
    raise exception 'x402 intent is not awaiting settlement recovery';
  end if;
end;
$$;

create or replace function public.record_x402_provider_acceptance(
  p_intent_id uuid,
  p_provider_transfer_id text,
  p_provider_status text
)
returns table (intent_status text, event_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_intent public.x402_payment_intents%rowtype;
  v_event_id uuid;
begin
  select * into strict v_intent
  from public.x402_payment_intents i
  where i.id = p_intent_id
  for update;

  if v_intent.status in ('provider_accepted', 'response_ready') then
    if v_intent.provider_transfer_id is distinct from p_provider_transfer_id then
      raise exception 'x402 intent already has a different provider transfer ID';
    end if;
    select e.id into strict v_event_id
    from public.payment_events e
    where e.intent_id = p_intent_id;
    return query select v_intent.status, v_event_id;
    return;
  end if;

  if v_intent.status not in ('settlement_submitted', 'recovery_pending')
    or p_provider_transfer_id is null
    or length(p_provider_transfer_id) = 0 then
    raise exception 'x402 intent cannot accept this provider result';
  end if;

  update public.x402_payment_intents i
  set status = 'provider_accepted',
      provider_transfer_id = p_provider_transfer_id,
      provider_status = p_provider_status,
      provider_accepted_at = now(),
      last_error_code = null,
      updated_at = now()
  where i.id = p_intent_id;

  insert into public.payment_events (
    endpoint, payer, amount_usdc, network, gateway_tx, raw, intent_id
  )
  values (
    v_intent.endpoint,
    v_intent.payer,
    div(v_intent.amount_base_units, 1000000)::text || '.' ||
      lpad(mod(v_intent.amount_base_units, 1000000)::text, 6, '0'),
    v_intent.network,
    p_provider_transfer_id,
    jsonb_build_object('provider_status', p_provider_status),
    v_intent.id
  )
  returning id into v_event_id;

  return query select 'provider_accepted'::text, v_event_id;
end;
$$;

create or replace function public.save_x402_payment_response(
  p_intent_id uuid,
  p_response_status integer,
  p_response_body jsonb
)
returns table (intent_status text, response_status integer, response_body jsonb)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_intent public.x402_payment_intents%rowtype;
begin
  select * into strict v_intent
  from public.x402_payment_intents i
  where i.id = p_intent_id
  for update;

  if v_intent.status = 'response_ready' then
    return query select v_intent.status, v_intent.response_status, v_intent.response_body;
    return;
  end if;

  if v_intent.status <> 'provider_accepted'
    or p_response_status < 100
    or p_response_status > 599
    or p_response_body is null then
    raise exception 'x402 response cannot be persisted for this intent';
  end if;

  update public.x402_payment_intents i
  set status = 'response_ready',
      response_status = p_response_status,
      response_body = p_response_body,
      response_ready_at = now(),
      updated_at = now()
  where i.id = p_intent_id
  returning i.* into v_intent;

  return query select v_intent.status, v_intent.response_status, v_intent.response_body;
end;
$$;

revoke all on function public.get_x402_payment_intent(
  text, integer, text, text, text
) from public, anon, authenticated;
revoke all on function public.prepare_x402_payment_intent(
  text, integer, text, text, text, text, numeric, text, text, text
) from public, anon, authenticated;
revoke all on function public.claim_x402_payment_intent(uuid)
  from public, anon, authenticated;
revoke all on function public.mark_x402_payment_recovery_pending(uuid, text)
  from public, anon, authenticated;
revoke all on function public.record_x402_provider_acceptance(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.save_x402_payment_response(uuid, integer, jsonb)
  from public, anon, authenticated;

grant execute on function public.get_x402_payment_intent(
  text, integer, text, text, text
) to service_role;
grant execute on function public.prepare_x402_payment_intent(
  text, integer, text, text, text, text, numeric, text, text, text
) to service_role;
grant execute on function public.claim_x402_payment_intent(uuid) to service_role;
grant execute on function public.mark_x402_payment_recovery_pending(uuid, text)
  to service_role;
grant execute on function public.record_x402_provider_acceptance(uuid, text, text)
  to service_role;
grant execute on function public.save_x402_payment_response(uuid, integer, jsonb)
  to service_role;
