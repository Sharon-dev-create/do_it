create table public.worker_auth_challenges (
  nonce text primary key,
  worker_address text not null check (worker_address ~ '^0x[0-9a-f]{40}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index worker_auth_challenges_expiry_idx
  on public.worker_auth_challenges(expires_at);

alter table public.worker_auth_challenges enable row level security;
revoke all on public.worker_auth_challenges from anon, authenticated;
