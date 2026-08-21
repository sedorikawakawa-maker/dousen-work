-- Phase 3: 投稿ルール & 制作タスク自動生成
-- docs/database.md, docs/workflows.md, docs/automation-rules.md 準拠

-- ---------------------------------------------------------------------------
-- clients: reminder_enabled を素材待ち / 顧客確認待ちで分離
-- ---------------------------------------------------------------------------

alter table public.clients
  add column if not exists material_reminder_enabled boolean not null default true;
alter table public.clients
  add column if not exists client_confirmation_reminder_enabled boolean not null default true;
alter table public.clients
  drop column if exists reminder_enabled;

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
  c.material_reminder_enabled,
  c.client_confirmation_reminder_enabled,
  c.created_at,
  c.updated_at
from public.clients c
where public.is_active_staff();

-- clients: 催促設定の変更を記録
create or replace function public.log_clients_reminder_setting_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.material_reminder_enabled is distinct from new.material_reminder_enabled
     or old.client_confirmation_reminder_enabled is distinct from new.client_confirmation_reminder_enabled then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      public.current_staff_id(), 'client', new.id, 'reminder_setting_changed',
      jsonb_build_object(
        'material_reminder_enabled', old.material_reminder_enabled,
        'client_confirmation_reminder_enabled', old.client_confirmation_reminder_enabled
      ),
      jsonb_build_object(
        'material_reminder_enabled', new.material_reminder_enabled,
        'client_confirmation_reminder_enabled', new.client_confirmation_reminder_enabled
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists clients_log_reminder_setting_change on public.clients;
create trigger clients_log_reminder_setting_change
  after update on public.clients
  for each row execute function public.log_clients_reminder_setting_change();

-- ---------------------------------------------------------------------------
-- posting_schedule_rules: 投稿種別ごとに有効なルールは1件のみ
-- ---------------------------------------------------------------------------

create unique index if not exists posting_schedule_rules_one_active_per_type
  on public.posting_schedule_rules (client_id, post_type)
  where is_active;

-- ---------------------------------------------------------------------------
-- production_tasks
-- ---------------------------------------------------------------------------

create table if not exists public.production_tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  schedule_rule_id uuid references public.posting_schedule_rules (id) on delete set null,
  post_type text not null check (post_type in ('reel', 'feed', 'story')),
  task_kind text not null check (task_kind in ('recurring', 'spot')),
  source_month date not null,
  scheduled_post_date date,
  original_scheduled_post_date date,
  status text not null default 'material_waiting' check (status in (
    'material_waiting', 'production_waiting', 'in_production',
    'wcheck_waiting', 'client_confirmation_waiting', 'posting_waiting', 'completed'
  )),
  -- 顧客登録直後などルール作成時点で主担当が未設定の場合があるためnull許容とする（database.md記載からの変更点）
  assignee_staff_id uuid references public.staff (id),
  secondary_staff_id uuid references public.staff (id),
  title text not null,
  production_start_date date,
  wcheck_due_date date,
  client_confirm_due_date date,
  is_carryover boolean not null default false,
  carried_from_task_id uuid references public.production_tasks (id),
  started_at timestamptz,
  completed_at timestamptz,
  work_minutes integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists production_tasks_client_idx on public.production_tasks (client_id);
create index if not exists production_tasks_rule_idx on public.production_tasks (schedule_rule_id);
create index if not exists production_tasks_source_month_idx on public.production_tasks (source_month);
create index if not exists production_tasks_scheduled_date_idx on public.production_tasks (scheduled_post_date);

-- 重複生成防止（同一ルール・同一投稿日・同一投稿種別は1件のみ。spotタスクはNULL可なので対象外）
create unique index if not exists production_tasks_unique_recurring
  on public.production_tasks (client_id, schedule_rule_id, scheduled_post_date, post_type)
  where task_kind = 'recurring' and schedule_rule_id is not null and scheduled_post_date is not null;

drop trigger if exists production_tasks_set_updated_at on public.production_tasks;
create trigger production_tasks_set_updated_at
  before update on public.production_tasks
  for each row execute function public.set_updated_at();

alter table public.production_tasks enable row level security;

drop policy if exists production_tasks_select on public.production_tasks;
create policy production_tasks_select on public.production_tasks
  for select to authenticated using (public.is_active_staff());

drop policy if exists production_tasks_insert on public.production_tasks;
create policy production_tasks_insert on public.production_tasks
  for insert to authenticated with check (public.is_active_staff());

drop policy if exists production_tasks_update on public.production_tasks;
create policy production_tasks_update on public.production_tasks
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());
