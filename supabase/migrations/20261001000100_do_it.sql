create table public.tasks (
    id uuid primary key default gen_random_uuid(),

    title text not null,
    description text not null,

    reward_usdc numeric(20, 6) not null,
       check (reward_usdc > 0),

       correct_answer text,

    created_by text not null,

    status text not null default 'open' 
      check (status in ('open', 'claimed', 'completed', 'cancelled')),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()  
);


create table public.submissions (
    id uuid primary key default gen_random_uuid(),

    task_id uuid not null 
      references public.task(id)
       on delete cascade,

    worker_address text not null,

    answer text not null,

    is_correct boolean,


    status text not null default 'pending' 
      check (status in ('pending', 'approved', 'rejected')),

    created_at timestamptz not null default now(),
    updated_at timestamptz  
);

create table public.task_payments (
  id uuid primary key default gen_random_uuid(),

  task_id uuid not null
    references public.task(id)
      on delete cascade,

  submission_id uuid
     references public.submissions(id)
       on delete set null,

  worker_address text not null,

  amount numeric(20, 6) not null
    check (amount > 0),

  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'confirmed', 'failed')), 

  tx_hash text,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);
  
create index task_status_idx on public.tasks(status);

create index submissions_task_id_idx on public.submissions(task_id);

create index submissions_worker_address_idx on public.submissions(worker_address);

create index task_payment_task_id_idx on public.task_payments(task_id);

create index task_payment_worker_address_idx on public.task_payments(worker_address);

alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.submissions;
alter publication supabase_realtime add table public.task_payments;
