-- Phase 1: staff / role / clients（最小構成）/ RLS / 個別ログイン基盤
-- docs/database.md, docs/requirements.md, docs/security.md 準拠

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- staff
-- ---------------------------------------------------------------------------

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  last_name text not null,
  first_name text not null,
  role text not null check (role in ('president', 'executive', 'employee', 'part_time')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_last_first_name_idx on public.staff (last_name, first_name);

-- ---------------------------------------------------------------------------
-- clients（Phase1では最小カラムのみ。他カラムは後続Phaseのmigrationで追加）
-- ---------------------------------------------------------------------------

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  client_code text not null unique,
  company_name text not null,
  shop_name text,
  phone text,
  email text,
  contact_name text,
  industry text,
  inflow_channel text,
  contact_method text,
  contract_status text not null default 'proposal'
    check (contract_status in ('contracted', 'proposal', 'paused', 'ended')),
  current_status text not null default 'on_track'
    check (current_status in (
      'on_track', 'material_waiting', 'in_production', 'wcheck_waiting',
      'client_confirmation_waiting', 'posting_waiting', 'paused', 'other'
    )),
  contract_start_date date,
  contract_end_date date,
  notes text,
  revenue_amount numeric,
  fee_amount numeric,
  material_wait_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clients_company_name_idx on public.clients (company_name);

-- ---------------------------------------------------------------------------
-- client_assignments
-- ---------------------------------------------------------------------------

create table if not exists public.client_assignments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  staff_id uuid not null references public.staff (id) on delete restrict,
  assignment_type text not null check (assignment_type in ('primary', 'secondary')),
  active_from date not null default current_date,
  active_to date,
  created_at timestamptz not null default now()
);

create index if not exists client_assignments_client_idx on public.client_assignments (client_id);
create index if not exists client_assignments_staff_idx on public.client_assignments (staff_id);

-- 同一顧客に対し、同時に有効な primary は1件のみ（副担当は複数不可・1名まで）
create unique index if not exists client_assignments_one_active_per_type
  on public.client_assignments (client_id, assignment_type)
  where active_to is null;

-- ---------------------------------------------------------------------------
-- updated_at 自動更新
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists staff_set_updated_at on public.staff;
create trigger staff_set_updated_at
  before update on public.staff
  for each row execute function public.set_updated_at();

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 権限ヘルパー関数（RLSポリシーから利用）
-- ---------------------------------------------------------------------------

create or replace function public.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.staff where auth_user_id = auth.uid() and is_active = true limit 1;
$$;

create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.staff where auth_user_id = auth.uid() and is_active = true limit 1;
$$;

create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff where auth_user_id = auth.uid() and is_active = true
  );
$$;

-- パート以外（社長・役員・社員）のみ料金・売上を閲覧可能
create or replace function public.can_view_finance()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_staff_role(), '') in ('president', 'executive', 'employee');
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.staff enable row level security;
alter table public.clients enable row level security;
alter table public.client_assignments enable row level security;

-- staff: ログイン済みスタッフなら全員がスタッフ一覧を閲覧可能（担当者選択・Wチェック担当選択等で必要）
drop policy if exists staff_select_authenticated on public.staff;
create policy staff_select_authenticated on public.staff
  for select
  to authenticated
  using (public.is_active_staff());

-- staff: 作成・更新・無効化は社長・役員のみ
drop policy if exists staff_write_admin on public.staff;
create policy staff_write_admin on public.staff
  for all
  to authenticated
  using (public.current_staff_role() in ('president', 'executive'))
  with check (public.current_staff_role() in ('president', 'executive'));

-- clients: 直接テーブルへのSELECTは禁止し、clients_view 経由のみ許可する
drop policy if exists clients_select_none on public.clients;

-- clients: 更新・登録はログイン済みスタッフなら可能（Phase2で細分化）
drop policy if exists clients_write_staff on public.clients;
create policy clients_write_staff on public.clients
  for insert
  to authenticated
  with check (public.is_active_staff());

drop policy if exists clients_update_staff on public.clients;
create policy clients_update_staff on public.clients
  for update
  to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());

-- clients: パートによる料金・売上の書き換えを禁止（閲覧だけでなく書込からも保護）
create or replace function public.enforce_clients_finance_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.can_view_finance() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.revenue_amount is not null or new.fee_amount is not null then
      raise exception 'この操作を行う権限がありません（料金・売上）';
    end if;
    return new;
  end if;

  if new.revenue_amount is distinct from old.revenue_amount
     or new.fee_amount is distinct from old.fee_amount then
    raise exception 'この操作を行う権限がありません（料金・売上）';
  end if;

  return new;
end;
$$;

drop trigger if exists clients_enforce_finance_columns on public.clients;
create trigger clients_enforce_finance_columns
  before insert or update on public.clients
  for each row execute function public.enforce_clients_finance_columns();

-- clients_view: パートには revenue_amount / fee_amount を NULL 化して返す
create or replace view public.clients_view as
select
  c.id,
  c.client_code,
  c.company_name,
  c.shop_name,
  c.phone,
  c.email,
  c.contact_name,
  c.industry,
  c.inflow_channel,
  c.contact_method,
  c.contract_status,
  c.current_status,
  c.contract_start_date,
  c.contract_end_date,
  c.notes,
  case when public.can_view_finance() then c.revenue_amount else null end as revenue_amount,
  case when public.can_view_finance() then c.fee_amount else null end as fee_amount,
  c.material_wait_started_at,
  c.created_at,
  c.updated_at
from public.clients c
where public.is_active_staff();

revoke select on public.clients from authenticated, anon;
grant select on public.clients_view to authenticated;

-- client_assignments: ログイン済みスタッフなら閲覧・登録・更新可能
drop policy if exists client_assignments_select_staff on public.client_assignments;
create policy client_assignments_select_staff on public.client_assignments
  for select
  to authenticated
  using (public.is_active_staff());

drop policy if exists client_assignments_write_staff on public.client_assignments;
create policy client_assignments_write_staff on public.client_assignments
  for insert
  to authenticated
  with check (public.is_active_staff());

drop policy if exists client_assignments_update_staff on public.client_assignments;
create policy client_assignments_update_staff on public.client_assignments
  for update
  to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());
