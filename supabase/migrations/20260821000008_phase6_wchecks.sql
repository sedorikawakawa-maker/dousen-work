-- Phase 6: Wチェック
-- docs/database.md, docs/workflows.md, docs/automation-rules.md, docs/requirements.md 準拠

create table if not exists public.w_checks (
  id uuid primary key default gen_random_uuid(),
  production_task_id uuid not null references public.production_tasks (id) on delete cascade,
  requested_by_staff_id uuid not null references public.staff (id),
  reviewer_staff_id uuid references public.staff (id),
  asset_type text not null check (asset_type in ('drive_video', 'canva')),
  asset_url text not null,
  status text not null default 'waiting' check (status in ('waiting', 'approved', 'revision_requested')),
  -- 登録時の補足（requirements.mdのWチェック登録項目「補足」。database.mdには無いカラムだが、
  -- 差し戻し時のrevision_commentとは別に、登録時点の申し送り事項を残すために追加）
  notes text,
  revision_comment text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists w_checks_task_idx on public.w_checks (production_task_id, requested_at desc);
create index if not exists w_checks_status_idx on public.w_checks (status, requested_at);

alter table public.w_checks enable row level security;

-- Wチェックは全スタッフが対応可能（reviewer指定は「目立たせる」ためのものであり、
-- 指定者以外の操作を制限しない）
drop policy if exists w_checks_select on public.w_checks;
create policy w_checks_select on public.w_checks
  for select to authenticated using (public.is_active_staff());

drop policy if exists w_checks_insert on public.w_checks;
create policy w_checks_insert on public.w_checks
  for insert to authenticated with check (public.is_active_staff());

drop policy if exists w_checks_update on public.w_checks;
create policy w_checks_update on public.w_checks
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());
