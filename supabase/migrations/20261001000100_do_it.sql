create table public.task (
    id uuid primary key default gen_random_uuid(),

    title text not null,
    description text not null,

    reward_usd numeric(20, 6) not null,
       check (reward_usd > 0),

       correct_answer text,

    created_by text not null,

    status text not null default 'open' 
      check (status in ('open', 'claimed', 'completed', 'cancelled')),

    created_at timestampz not null default now(),
    updated_at timestampz not null default now()  
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

    created_at timestampz not null default now(),
    updated_at timestampz  
);

create index task_status_idx on public.task(status);

create index submissions_task_id_idx on public.submissions(task_id);

create index submissions_worker_address_idx on public.submissions(worker_address);

create index task_payment_task_id_idx on public.task_payment(task_id);

create index task_payment_worker_address_idx on public.task_payment(worker_address);
