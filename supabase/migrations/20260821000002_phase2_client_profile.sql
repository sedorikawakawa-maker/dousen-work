-- Phase 2: 顧客一覧 / 顧客登録 / 顧客詳細 / 顧客編集
-- docs/database.md, docs/ui-spec.md, docs/security.md 準拠

-- ---------------------------------------------------------------------------
-- client_code 自動採番（例: D00028）
-- ---------------------------------------------------------------------------

create sequence if not exists public.client_code_seq;

create or replace function public.set_client_code()
returns trigger
language plpgsql
as $$
begin
  if new.client_code is null or new.client_code = '' then
    new.client_code := 'D' || lpad(nextval('public.client_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists clients_set_client_code on public.clients;
create trigger clients_set_client_code
  before insert on public.clients
  for each row execute function public.set_client_code();

-- ---------------------------------------------------------------------------
-- client_operation_profiles（制作方針）
-- ---------------------------------------------------------------------------

create table if not exists public.client_operation_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients (id) on delete cascade,
  purpose text,
  target_audience text,
  content_direction text,
  tone text,
  cta_policy text,
  ng_notes text,
  reference_accounts text,
  hashtag_policy text,
  hearing_sheet_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists client_operation_profiles_set_updated_at on public.client_operation_profiles;
create trigger client_operation_profiles_set_updated_at
  before update on public.client_operation_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- client_links（SNS・Drive・Canva・公式LINE・素材フォーム等）
-- ---------------------------------------------------------------------------

create table if not exists public.client_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  link_type text not null check (link_type in (
    'instagram', 'tiktok', 'youtube', 'website',
    'drive_root', 'canva_feed', 'canva_story', 'canva_thumbnail',
    'official_line', 'material_form'
  )),
  label text,
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_links_client_idx on public.client_links (client_id);

drop trigger if exists client_links_set_updated_at on public.client_links;
create trigger client_links_set_updated_at
  before update on public.client_links
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- client_credentials（ログインID・パスワード保管先URLのみ。パスワード本体は保存しない）
-- ---------------------------------------------------------------------------

create table if not exists public.client_credentials (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  service_name text not null,
  login_id text,
  password_vault_url text,
  last_updated_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_credentials_client_idx on public.client_credentials (client_id);

drop trigger if exists client_credentials_set_updated_at on public.client_credentials;
create trigger client_credentials_set_updated_at
  before update on public.client_credentials
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- posting_schedule_rules（投稿ルールのデータ入力のみ。自動生成ロジックはPhase3）
-- ---------------------------------------------------------------------------

create table if not exists public.posting_schedule_rules (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  post_type text not null check (post_type in ('reel', 'feed', 'story')),
  monthly_target integer not null check (monthly_target >= 0),
  weekday_rule jsonb not null default '{}'::jsonb,
  production_lead_days integer,
  wcheck_lead_days integer,
  client_confirm_lead_days integer,
  valid_from date not null default current_date,
  valid_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists posting_schedule_rules_client_idx on public.posting_schedule_rules (client_id);

drop trigger if exists posting_schedule_rules_set_updated_at on public.posting_schedule_rules;
create trigger posting_schedule_rules_set_updated_at
  before update on public.posting_schedule_rules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- activity_logs（重要変更のみ記録）
-- ---------------------------------------------------------------------------

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_staff_id uuid references public.staff (id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_entity_idx on public.activity_logs (entity_type, entity_id, created_at desc);

-- clients: 契約状況 / 顧客ステータス / 料金・売上 の変更を記録
create or replace function public.log_clients_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.contract_status is distinct from new.contract_status then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      public.current_staff_id(), 'client', new.id, 'contract_status_changed',
      jsonb_build_object('contract_status', old.contract_status),
      jsonb_build_object('contract_status', new.contract_status)
    );
  end if;

  if old.current_status is distinct from new.current_status then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      public.current_staff_id(), 'client', new.id, 'current_status_changed',
      jsonb_build_object('current_status', old.current_status),
      jsonb_build_object('current_status', new.current_status)
    );
  end if;

  if old.revenue_amount is distinct from new.revenue_amount
     or old.fee_amount is distinct from new.fee_amount then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      public.current_staff_id(), 'client', new.id, 'finance_changed',
      jsonb_build_object('revenue_amount', old.revenue_amount, 'fee_amount', old.fee_amount),
      jsonb_build_object('revenue_amount', new.revenue_amount, 'fee_amount', new.fee_amount)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists clients_log_change on public.clients;
create trigger clients_log_change
  after update on public.clients
  for each row execute function public.log_clients_change();

-- client_assignments: 担当変更を記録
create or replace function public.log_client_assignments_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      public.current_staff_id(), 'client', new.client_id, 'assignment_created',
      null,
      jsonb_build_object('staff_id', new.staff_id, 'assignment_type', new.assignment_type, 'active_from', new.active_from)
    );
    return new;
  end if;

  if tg_op = 'UPDATE' and old.active_to is distinct from new.active_to and new.active_to is not null then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      public.current_staff_id(), 'client', new.client_id, 'assignment_closed',
      jsonb_build_object('staff_id', old.staff_id, 'assignment_type', old.assignment_type),
      jsonb_build_object('staff_id', new.staff_id, 'assignment_type', new.assignment_type, 'active_to', new.active_to)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists client_assignments_log_change on public.client_assignments;
create trigger client_assignments_log_change
  after insert or update on public.client_assignments
  for each row execute function public.log_client_assignments_change();

-- posting_schedule_rules: 投稿ルール変更を記録
create or replace function public.log_posting_schedule_rules_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
  values (
    public.current_staff_id(), 'client', new.client_id,
    case when tg_op = 'INSERT' then 'schedule_rule_created' else 'schedule_rule_changed' end,
    case when tg_op = 'UPDATE' then jsonb_build_object(
      'post_type', old.post_type, 'monthly_target', old.monthly_target, 'weekday_rule', old.weekday_rule,
      'valid_from', old.valid_from, 'valid_to', old.valid_to, 'is_active', old.is_active
    ) else null end,
    jsonb_build_object(
      'post_type', new.post_type, 'monthly_target', new.monthly_target, 'weekday_rule', new.weekday_rule,
      'valid_from', new.valid_from, 'valid_to', new.valid_to, 'is_active', new.is_active
    )
  );
  return new;
end;
$$;

drop trigger if exists posting_schedule_rules_log_change on public.posting_schedule_rules;
create trigger posting_schedule_rules_log_change
  after insert or update on public.posting_schedule_rules
  for each row execute function public.log_posting_schedule_rules_change();

-- client_credentials: ログインID / 保管先の変更を記録（パスワード本体は保存していないため対象外）
create or replace function public.log_client_credentials_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
  values (
    public.current_staff_id(), 'client', new.client_id,
    case when tg_op = 'INSERT' then 'credential_created' else 'credential_changed' end,
    case when tg_op = 'UPDATE' then jsonb_build_object(
      'service_name', old.service_name, 'login_id', old.login_id, 'password_vault_url', old.password_vault_url
    ) else null end,
    jsonb_build_object(
      'service_name', new.service_name, 'login_id', new.login_id, 'password_vault_url', new.password_vault_url
    )
  );
  return new;
end;
$$;

drop trigger if exists client_credentials_log_change on public.client_credentials;
create trigger client_credentials_log_change
  after insert or update on public.client_credentials
  for each row execute function public.log_client_credentials_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.client_operation_profiles enable row level security;
alter table public.client_links enable row level security;
alter table public.client_credentials enable row level security;
alter table public.posting_schedule_rules enable row level security;
alter table public.activity_logs enable row level security;

drop policy if exists client_operation_profiles_select on public.client_operation_profiles;
create policy client_operation_profiles_select on public.client_operation_profiles
  for select to authenticated using (public.is_active_staff());

drop policy if exists client_operation_profiles_insert on public.client_operation_profiles;
create policy client_operation_profiles_insert on public.client_operation_profiles
  for insert to authenticated with check (public.is_active_staff());

drop policy if exists client_operation_profiles_update on public.client_operation_profiles;
create policy client_operation_profiles_update on public.client_operation_profiles
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

drop policy if exists client_links_select on public.client_links;
create policy client_links_select on public.client_links
  for select to authenticated using (public.is_active_staff());

drop policy if exists client_links_insert on public.client_links;
create policy client_links_insert on public.client_links
  for insert to authenticated with check (public.is_active_staff());

drop policy if exists client_links_update on public.client_links;
create policy client_links_update on public.client_links
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

drop policy if exists client_links_delete on public.client_links;
create policy client_links_delete on public.client_links
  for delete to authenticated using (public.is_active_staff());

drop policy if exists client_credentials_select on public.client_credentials;
create policy client_credentials_select on public.client_credentials
  for select to authenticated using (public.is_active_staff());

drop policy if exists client_credentials_insert on public.client_credentials;
create policy client_credentials_insert on public.client_credentials
  for insert to authenticated with check (public.is_active_staff());

drop policy if exists client_credentials_update on public.client_credentials;
create policy client_credentials_update on public.client_credentials
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

drop policy if exists client_credentials_delete on public.client_credentials;
create policy client_credentials_delete on public.client_credentials
  for delete to authenticated using (public.is_active_staff());

drop policy if exists posting_schedule_rules_select on public.posting_schedule_rules;
create policy posting_schedule_rules_select on public.posting_schedule_rules
  for select to authenticated using (public.is_active_staff());

drop policy if exists posting_schedule_rules_insert on public.posting_schedule_rules;
create policy posting_schedule_rules_insert on public.posting_schedule_rules
  for insert to authenticated with check (public.is_active_staff());

drop policy if exists posting_schedule_rules_update on public.posting_schedule_rules;
create policy posting_schedule_rules_update on public.posting_schedule_rules
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

-- activity_logs: 閲覧のみ許可（書込はtrigger経由のみ）
drop policy if exists activity_logs_select on public.activity_logs;
create policy activity_logs_select on public.activity_logs
  for select to authenticated using (public.is_active_staff());
