-- Phase 11: 社内タスク
-- docs/database.md 準拠。制作タスクのような複雑なステータスフローは持たせない。

create table if not exists public.internal_tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete set null,
  assignee_staff_id uuid not null references public.staff (id),
  category text not null,
  title text not null,
  description text,
  priority text not null default 'B' check (priority in ('A', 'B', 'C')),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'done')),
  due_at timestamptz,
  attachment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists internal_tasks_assignee_idx on public.internal_tasks (assignee_staff_id, status);
create index if not exists internal_tasks_client_idx on public.internal_tasks (client_id);
create index if not exists internal_tasks_due_at_idx on public.internal_tasks (due_at);

drop trigger if exists internal_tasks_set_updated_at on public.internal_tasks;
create trigger internal_tasks_set_updated_at
  before update on public.internal_tasks
  for each row execute function public.set_updated_at();

alter table public.internal_tasks enable row level security;

-- 現時点では全スタッフが作成・編集可能。削除は行わない方針のためdeleteポリシーは設けない。
drop policy if exists internal_tasks_select on public.internal_tasks;
create policy internal_tasks_select on public.internal_tasks
  for select to authenticated using (public.is_active_staff());

drop policy if exists internal_tasks_insert on public.internal_tasks;
create policy internal_tasks_insert on public.internal_tasks
  for insert to authenticated with check (public.is_active_staff());

drop policy if exists internal_tasks_update on public.internal_tasks;
create policy internal_tasks_update on public.internal_tasks
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());
