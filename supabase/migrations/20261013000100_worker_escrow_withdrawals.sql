create table public.worker_escrow_withdrawals (
  id uuid primary key default gen_random_uuid(),
  worker_address text not null check (worker_address ~ '^0x[0-9a-f]{40}$'),
  amount_base_units numeric(78, 0) not null check (amount_base_units > 0),
  chain_id bigint not null check (chain_id > 0),
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  block_number bigint not null check (block_number >= 0),
  block_timestamp timestamptz not null,
  status text not null check (status in ('submitted', 'confirmed', 'failed')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint worker_escrow_withdrawals_confirmed_timestamp_check
    check (status <> 'confirmed' or confirmed_at is not null),
  constraint worker_escrow_withdrawals_chain_event_unique
    unique (chain_id, contract_address, tx_hash, log_index)
);

create index worker_escrow_withdrawals_wallet_history_idx
  on public.worker_escrow_withdrawals(worker_address, block_number desc, log_index desc);

alter table public.worker_escrow_withdrawals enable row level security;
revoke all on public.worker_escrow_withdrawals from anon, authenticated;

create table public.worker_withdrawal_auth_challenges (
  nonce text primary key,
  worker_address text not null check (worker_address ~ '^0x[0-9a-f]{40}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index worker_withdrawal_auth_challenges_expiry_idx
  on public.worker_withdrawal_auth_challenges(expires_at);

alter table public.worker_withdrawal_auth_challenges enable row level security;
revoke all on public.worker_withdrawal_auth_challenges from anon, authenticated;
