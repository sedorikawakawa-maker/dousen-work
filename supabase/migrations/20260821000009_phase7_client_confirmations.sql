-- Phase 7: 顧客確認
-- docs/database.md, docs/workflows.md, docs/automation-rules.md 準拠

create table if not exists public.client_confirmations (
  id uuid primary key default gen_random_uuid(),
  production_task_id uuid not null references public.production_tasks (id) on delete cascade,
  requested_by_staff_id uuid not null references public.staff (id),
  status text not null default 'waiting' check (status in ('waiting', 'approved', 'revision_requested')),
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  revision_comment text,
  created_at timestamptz not null default now()
);

create index if not exists client_confirmations_task_idx
  on public.client_confirmations (production_task_id, requested_at desc);
create index if not exists client_confirmations_status_idx
  on public.client_confirmations (status, requested_at);

alter table public.client_confirmations enable row level security;

drop policy if exists client_confirmations_select on public.client_confirmations;
create policy client_confirmations_select on public.client_confirmations
  for select to authenticated using (public.is_active_staff());

drop policy if exists client_confirmations_insert on public.client_confirmations;
create policy client_confirmations_insert on public.client_confirmations
  for insert to authenticated with check (public.is_active_staff());

drop policy if exists client_confirmations_update on public.client_confirmations;
create policy client_confirmations_update on public.client_confirmations
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());
