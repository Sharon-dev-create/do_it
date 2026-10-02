alter table public.task_payments
add constraint task_payments_task_id_unique unique (task_id);
