-- Phase 3 修正: production_tasksの初期状態、投稿実績の正本(post_records)
-- docs/database.md, docs/workflows.md 準拠

-- ---------------------------------------------------------------------------
-- post_records（月間実績の正本。production_tasks.status=completed は業務フロー上の
-- 完了状態として使うが、「実際に何本投稿したか」はここから算出する）
-- ---------------------------------------------------------------------------

create table if not exists public.post_records (
  id uuid primary key default gen_random_uuid(),
  production_task_id uuid references public.production_tasks (id),
  client_id uuid not null references public.clients (id) on delete cascade,
  post_type text not null check (post_type in ('reel', 'feed', 'story')),
  posted_at timestamptz not null default now(),
  posted_by_staff_id uuid not null references public.staff (id),
  title text,
  social_post_url text,
  canva_url text,
  final_drive_file_id text,
  final_drive_url text,
  source_material_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists post_records_client_idx on public.post_records (client_id);
create index if not exists post_records_task_idx on public.post_records (production_task_id);

alter table public.post_records enable row level security;

drop policy if exists post_records_select on public.post_records;
create policy post_records_select on public.post_records
  for select to authenticated using (public.is_active_staff());

drop policy if exists post_records_insert on public.post_records;
create policy post_records_insert on public.post_records
  for insert to authenticated with check (public.is_active_staff());

-- 過去実績は書き換えない方針のため、update/deleteポリシーは設けない
-- (訂正が必要な場合はPhase8で改めて設計する)
