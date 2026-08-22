-- Phase 9: 催促ログ
-- docs/database.md 準拠。催促済みにしても素材待ち/顧客確認待ち状態は自動解除しない。

create table if not exists public.reminder_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  production_task_id uuid references public.production_tasks (id) on delete set null,
  reminder_type text not null check (reminder_type in ('material', 'client_confirmation')),
  reminded_by_staff_id uuid not null references public.staff (id),
  reminded_at timestamptz not null default now(),
  note text
);

create index if not exists reminder_logs_client_idx
  on public.reminder_logs (client_id, reminder_type, reminded_at desc);
create index if not exists reminder_logs_task_idx
  on public.reminder_logs (production_task_id, reminded_at desc);

alter table public.reminder_logs enable row level security;

drop policy if exists reminder_logs_select on public.reminder_logs;
create policy reminder_logs_select on public.reminder_logs
  for select to authenticated using (public.is_active_staff());

drop policy if exists reminder_logs_insert on public.reminder_logs;
create policy reminder_logs_insert on public.reminder_logs
  for insert to authenticated with check (public.is_active_staff());
