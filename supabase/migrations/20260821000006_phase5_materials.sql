-- Phase 5: 素材
-- docs/database.md, docs/requirements.md, docs/automation-rules.md 準拠

-- ---------------------------------------------------------------------------
-- production_tasks: タスク単位の素材待ち開始日時
-- （database.mdには無いカラムだが、1顧客に複数タスクが同時に素材待ちになり得るため、
-- 　顧客単位のmaterial_wait_started_atとは別にタスク単位で保持する。要ユーザー確認）
-- ---------------------------------------------------------------------------

alter table public.production_tasks
  add column if not exists material_wait_started_at timestamptz;

-- ---------------------------------------------------------------------------
-- materials
-- ---------------------------------------------------------------------------

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  title text not null,
  post_usage text,
  requested_post_timing text,
  editing_instructions text,
  caption_instructions text,
  contact_notes text,
  shot_date date,
  received_at timestamptz not null default now(),
  drive_file_id text,
  drive_url text,
  submitted_by_type text not null default 'client' check (submitted_by_type in ('client', 'staff')),
  created_at timestamptz not null default now()
);

create index if not exists materials_client_idx on public.materials (client_id, received_at desc);

alter table public.materials enable row level security;

drop policy if exists materials_select on public.materials;
create policy materials_select on public.materials
  for select to authenticated using (public.is_active_staff());

drop policy if exists materials_insert on public.materials;
create policy materials_insert on public.materials
  for insert to authenticated with check (public.is_active_staff());

-- 顧客向け公開フォームからの登録はservice_role(管理クライアント)経由でRLSをバイパスする
-- （顧客はログインしないためauthenticatedロールを持たない）

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_staff_id uuid not null references public.staff (id),
  notification_type text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_staff_id, is_read, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (recipient_staff_id = public.current_staff_id());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (recipient_staff_id = public.current_staff_id())
  with check (recipient_staff_id = public.current_staff_id());

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert to authenticated with check (public.is_active_staff());

-- 顧客向け公開フォームからの通知作成もservice_role(管理クライアント)経由で行う
