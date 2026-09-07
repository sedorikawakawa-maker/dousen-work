-- Phase 13: 請求管理・売上管理（Phase 1: DB / RLS / RPCの基礎のみ。UI・Server Actionは含まない）
-- 設計方針:
--   - 「請求設定」(billing_rules) と「請求実績」(invoices/invoice_items) を分離し、
--     設定変更が過去の請求履歴を書き換えないようにする（post_records/production_tasksと同じ思想）。
--   - 全4テーブルとも part_time には一切表示しない（can_view_finance()によるRLS行レベル遮断。
--     clients_viewの列マスキングとは異なり、このドメインは全列が財務情報のため行ごと隠す）。
--   - contract_cycle_months はあくまで契約更新サイクルの参考情報であり、請求生成周期には使用しない。
--     現時点の請求方式は recurring（毎月）/ one_time（指定月のみ）の2種類のみ。

-- ---------------------------------------------------------------------------
-- client_billing_profiles（顧客ごとの請求基本情報。1:1、client_operation_profilesと同型）
-- ---------------------------------------------------------------------------

create table if not exists public.client_billing_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients (id) on delete cascade,
  invoice_required boolean not null default true,
  billing_company_name text,
  billing_contact_name text,
  billing_email text,
  billing_cc_email text,
  billing_method text check (billing_method in ('email', 'postal', 'other')),
  billing_postal_address text,
  contract_cycle_months integer check (contract_cycle_months is null or contract_cycle_months > 0),
  renewal_month integer check (renewal_month is null or renewal_month between 1 and 12),
  billing_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists client_billing_profiles_set_updated_at on public.client_billing_profiles;
create trigger client_billing_profiles_set_updated_at
  before update on public.client_billing_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- billing_rules（請求設定。recurring/one_time共通。posting_schedule_rulesと同型）
-- ---------------------------------------------------------------------------

create table if not exists public.billing_rules (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  billing_type text not null check (billing_type in ('recurring', 'one_time')),
  subject text not null,
  description text,
  quantity numeric not null default 1 check (quantity > 0),
  unit_price_ex_tax numeric not null check (unit_price_ex_tax >= 0),
  notes text,

  -- recurring専用（毎月請求。有効期間はvalid_from〜valid_to、valid_to=nullは現在も有効）
  valid_from date,
  valid_to date,
  -- revenue_month = billing_month + offset（月単位）。0=当月分当月請求、-1=前月分を当月請求 等。
  revenue_month_offset_months integer not null default 0,

  -- one_time専用（指定月のみ、単発）
  one_time_billing_month date,
  one_time_revenue_month date,

  is_active boolean not null default true,
  created_by_staff_id uuid references public.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint billing_rules_recurring_fields check (
    billing_type <> 'recurring'
    or (valid_from is not null and one_time_billing_month is null and one_time_revenue_month is null)
  ),
  constraint billing_rules_one_time_fields check (
    billing_type <> 'one_time'
    or (
      one_time_billing_month is not null and one_time_revenue_month is not null
      and valid_from is null and valid_to is null
    )
  ),
  constraint billing_rules_valid_range check (valid_to is null or valid_from is null or valid_to >= valid_from),
  constraint billing_rules_one_time_billing_month_is_month_start check (
    one_time_billing_month is null or one_time_billing_month = date_trunc('month', one_time_billing_month)::date
  ),
  constraint billing_rules_one_time_revenue_month_is_month_start check (
    one_time_revenue_month is null or one_time_revenue_month = date_trunc('month', one_time_revenue_month)::date
  )
);

create index if not exists billing_rules_client_idx on public.billing_rules (client_id);
create index if not exists billing_rules_active_idx on public.billing_rules (client_id) where is_active = true;

drop trigger if exists billing_rules_set_updated_at on public.billing_rules;
create trigger billing_rules_set_updated_at
  before update on public.billing_rules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- invoices（月次請求書の封筒。顧客×請求月で1件。過去分は原則削除しない = on delete restrict）
-- ---------------------------------------------------------------------------

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  billing_month date not null,
  status text not null default 'planned' check (status in ('planned', 'prepared', 'sent')),

  -- client_billing_profilesを後から変更しても過去の送付予定・送付実績が変わらないためのスナップショット
  billing_company_name_snapshot text,
  billing_contact_name_snapshot text,
  billing_email_snapshot text,
  billing_cc_email_snapshot text,
  billing_method_snapshot text,
  billing_postal_address_snapshot text,

  sent_at timestamptz,
  sent_by_staff_id uuid references public.staff (id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invoices_billing_month_is_month_start check (billing_month = date_trunc('month', billing_month)::date),
  constraint invoices_sent_fields check (
    (status = 'sent' and sent_at is not null)
    or (status <> 'sent' and sent_at is null and sent_by_staff_id is null)
  )
);

create unique index if not exists invoices_client_billing_month_key on public.invoices (client_id, billing_month);
create index if not exists invoices_billing_month_status_idx on public.invoices (billing_month, status);

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

-- invoices: statusは前進のみ（planned -> prepared -> sent）。一度sentになったら一切変更不可
-- （post_recordsの「取消後は完全ロック」と同じ思想。宛先スナップショットも凍結される）。
create or replace function public.enforce_invoices_status_transition()
returns trigger
language plpgsql
as $$
declare
  v_rank_old int;
  v_rank_new int;
begin
  if old.status = 'sent' then
    raise exception '送付済みのinvoiceは変更できません';
  end if;

  if new.client_id is distinct from old.client_id or new.billing_month is distinct from old.billing_month then
    raise exception 'invoiceのclient_id/billing_monthは変更できません';
  end if;

  v_rank_old := case old.status when 'planned' then 0 when 'prepared' then 1 when 'sent' then 2 end;
  v_rank_new := case new.status when 'planned' then 0 when 'prepared' then 1 when 'sent' then 2 end;

  if v_rank_new < v_rank_old then
    raise exception 'invoiceのstatusを後戻りさせることはできません';
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_enforce_status_transition on public.invoices;
create trigger invoices_enforce_status_transition
  before update on public.invoices
  for each row execute function public.enforce_invoices_status_transition();

-- ---------------------------------------------------------------------------
-- invoice_items（請求書の明細行。生成時点の金額スナップショット。取消専用の訂正モデル）
-- ---------------------------------------------------------------------------

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  client_id uuid not null references public.clients (id) on delete restrict,
  -- CSV移行・手動追加明細・元ruleを持たない過去実績にも対応するためnull許容。
  -- 通常のbilling_rules自動生成では必ず値を持つ。
  billing_rule_id uuid references public.billing_rules (id) on delete set null,

  billing_month date not null,
  revenue_month date not null,
  subject text not null,
  description text,
  quantity numeric not null default 1,
  unit_price_ex_tax numeric not null,
  tax_excluded_amount numeric not null check (tax_excluded_amount >= 0),
  amount_override numeric,
  notes text,

  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by_staff_id uuid references public.staff (id),
  cancel_reason text,

  constraint invoice_items_cancel_reason_required check (cancelled_at is null or cancel_reason is not null),
  constraint invoice_items_billing_month_is_month_start check (billing_month = date_trunc('month', billing_month)::date),
  constraint invoice_items_revenue_month_is_month_start check (revenue_month = date_trunc('month', revenue_month)::date)
);

-- 通常生成の二重生成防止（billing_rule_idを持つ行のみ対象。手動/移行行はnullのため対象外）
create unique index if not exists invoice_items_rule_billing_month_key
  on public.invoice_items (billing_rule_id, billing_month)
  where billing_rule_id is not null and cancelled_at is null;

create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id);
create index if not exists invoice_items_client_idx on public.invoice_items (client_id);
-- 「今月売上」= revenue_monthベース集計 / 「今月請求予定」= billing_monthベース集計 を想定
create index if not exists invoice_items_revenue_month_idx
  on public.invoice_items (revenue_month) where cancelled_at is null;
create index if not exists invoice_items_billing_month_idx
  on public.invoice_items (billing_month) where cancelled_at is null;

-- invoice_items: 取消専用の訂正モデル（post_recordsのenforce_post_records_cancel_only_updateと同じ思想）。
-- notesのみ、取消前であれば運用メモとして更新可能とする（金額・内容には一切影響しないため）。
create or replace function public.enforce_invoice_items_cancel_only_update()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
     or new.invoice_id is distinct from old.invoice_id
     or new.client_id is distinct from old.client_id
     or new.billing_rule_id is distinct from old.billing_rule_id
     or new.billing_month is distinct from old.billing_month
     or new.revenue_month is distinct from old.revenue_month
     or new.subject is distinct from old.subject
     or new.description is distinct from old.description
     or new.quantity is distinct from old.quantity
     or new.unit_price_ex_tax is distinct from old.unit_price_ex_tax
     or new.tax_excluded_amount is distinct from old.tax_excluded_amount
     or new.amount_override is distinct from old.amount_override
     or new.created_at is distinct from old.created_at then
    raise exception 'invoice_itemsの請求内容は変更できません（取消関連項目のみ更新可能です）';
  end if;

  if old.cancelled_at is not null then
    raise exception '取消済みのinvoice_itemsは変更できません';
  end if;

  return new;
end;
$$;

drop trigger if exists invoice_items_enforce_cancel_only_update on public.invoice_items;
create trigger invoice_items_enforce_cancel_only_update
  before update on public.invoice_items
  for each row execute function public.enforce_invoice_items_cancel_only_update();

-- ---------------------------------------------------------------------------
-- RLS: 4テーブルとも SELECT/INSERT/UPDATE は can_view_finance() のみ。
-- DELETEポリシーは一切作成しない（原則禁止。無効化はis_active、取消はcancelled_atで表現する）。
-- part_timeは直接テーブルへアクセスしても0件・0行更新となる（列マスキングではなく行レベル遮断）。
-- ---------------------------------------------------------------------------

alter table public.client_billing_profiles enable row level security;
alter table public.billing_rules enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

drop policy if exists client_billing_profiles_select on public.client_billing_profiles;
create policy client_billing_profiles_select on public.client_billing_profiles
  for select to authenticated using (public.can_view_finance());
drop policy if exists client_billing_profiles_insert on public.client_billing_profiles;
create policy client_billing_profiles_insert on public.client_billing_profiles
  for insert to authenticated with check (public.can_view_finance());
drop policy if exists client_billing_profiles_update on public.client_billing_profiles;
create policy client_billing_profiles_update on public.client_billing_profiles
  for update to authenticated using (public.can_view_finance()) with check (public.can_view_finance());

drop policy if exists billing_rules_select on public.billing_rules;
create policy billing_rules_select on public.billing_rules
  for select to authenticated using (public.can_view_finance());
drop policy if exists billing_rules_insert on public.billing_rules;
create policy billing_rules_insert on public.billing_rules
  for insert to authenticated with check (public.can_view_finance());
drop policy if exists billing_rules_update on public.billing_rules;
create policy billing_rules_update on public.billing_rules
  for update to authenticated using (public.can_view_finance()) with check (public.can_view_finance());

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated using (public.can_view_finance());
drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices
  for insert to authenticated with check (public.can_view_finance());
drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices
  for update to authenticated using (public.can_view_finance()) with check (public.can_view_finance());

drop policy if exists invoice_items_select on public.invoice_items;
create policy invoice_items_select on public.invoice_items
  for select to authenticated using (public.can_view_finance());
drop policy if exists invoice_items_insert on public.invoice_items;
create policy invoice_items_insert on public.invoice_items
  for insert to authenticated with check (public.can_view_finance());
drop policy if exists invoice_items_update on public.invoice_items;
create policy invoice_items_update on public.invoice_items
  for update to authenticated using (public.can_view_finance()) with check (public.can_view_finance());

-- ---------------------------------------------------------------------------
-- activity_logs連携（既存の「重要変更のみ記録」方針に合わせる。新方式は持ち込まない）
-- ---------------------------------------------------------------------------

create or replace function public.log_client_billing_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (
    old.invoice_required is distinct from new.invoice_required
    or old.billing_email is distinct from new.billing_email
    or old.billing_company_name is distinct from new.billing_company_name
    or old.billing_method is distinct from new.billing_method
  ) then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      public.current_staff_id(), 'client_billing_profile', new.id, 'client_billing_profile_changed',
      jsonb_build_object(
        'invoice_required', old.invoice_required, 'billing_email', old.billing_email,
        'billing_company_name', old.billing_company_name, 'billing_method', old.billing_method
      ),
      jsonb_build_object(
        'invoice_required', new.invoice_required, 'billing_email', new.billing_email,
        'billing_company_name', new.billing_company_name, 'billing_method', new.billing_method
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists client_billing_profiles_log_change on public.client_billing_profiles;
create trigger client_billing_profiles_log_change
  after update on public.client_billing_profiles
  for each row execute function public.log_client_billing_profile_change();

create or replace function public.log_billing_rules_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      new.created_by_staff_id, 'billing_rule', new.id, 'billing_rule_created',
      null,
      jsonb_build_object(
        'client_id', new.client_id, 'billing_type', new.billing_type, 'subject', new.subject,
        'quantity', new.quantity, 'unit_price_ex_tax', new.unit_price_ex_tax,
        'valid_from', new.valid_from, 'valid_to', new.valid_to,
        'one_time_billing_month', new.one_time_billing_month
      )
    );
    return new;
  end if;

  if old.unit_price_ex_tax is distinct from new.unit_price_ex_tax
     or old.quantity is distinct from new.quantity
     or old.valid_to is distinct from new.valid_to
     or old.is_active is distinct from new.is_active then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      public.current_staff_id(), 'billing_rule', new.id, 'billing_rule_changed',
      jsonb_build_object(
        'unit_price_ex_tax', old.unit_price_ex_tax, 'quantity', old.quantity,
        'valid_to', old.valid_to, 'is_active', old.is_active
      ),
      jsonb_build_object(
        'unit_price_ex_tax', new.unit_price_ex_tax, 'quantity', new.quantity,
        'valid_to', new.valid_to, 'is_active', new.is_active
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists billing_rules_log_change on public.billing_rules;
create trigger billing_rules_log_change
  after insert or update on public.billing_rules
  for each row execute function public.log_billing_rules_change();

create or replace function public.log_invoices_sent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status and new.status = 'sent' then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      new.sent_by_staff_id, 'invoice', new.id, 'invoice_sent',
      jsonb_build_object('status', old.status),
      jsonb_build_object(
        'status', new.status, 'sent_at', new.sent_at,
        'billing_email_snapshot', new.billing_email_snapshot
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_log_sent on public.invoices;
create trigger invoices_log_sent
  after update on public.invoices
  for each row execute function public.log_invoices_sent();

create or replace function public.log_invoice_items_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.cancelled_at is null and new.cancelled_at is not null then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      new.cancelled_by_staff_id, 'invoice_item', new.id, 'invoice_item_cancelled',
      jsonb_build_object('cancelled_at', null),
      jsonb_build_object(
        'cancelled_at', new.cancelled_at, 'cancelled_by_staff_id', new.cancelled_by_staff_id,
        'cancel_reason', new.cancel_reason
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_items_log_cancellation on public.invoice_items;
create trigger invoice_items_log_cancellation
  after update on public.invoice_items
  for each row execute function public.log_invoice_items_cancellation();

-- ---------------------------------------------------------------------------
-- RPC（DB層のみで安全に完結する最小限のヘルパー。生成ロジック本体はPhase3でアプリ側に実装する
-- ------ posting_schedule_rules -> production_tasks の既存実装と同じ方針）
-- ---------------------------------------------------------------------------

-- invoiceを送付済みにする唯一の入口。前進のみ・sent到達後は一切変更不可（トリガーで保護済み）。
-- actor(sent_by_staff_id)はクライアント申告値を一切信用せず、current_staff_id()でサーバー側解決する
-- （なりすまし防止）。RLSに加え、RPC入口でも明示的にcan_view_finance()を確認する。
create or replace function public.mark_invoice_sent(
  p_invoice_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_staff_id uuid;
begin
  if not public.can_view_finance() then
    raise exception 'この操作を行う権限がありません（請求・売上）';
  end if;

  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'ログインが必要です';
  end if;

  update public.invoices
    set status = 'sent', sent_at = now(), sent_by_staff_id = v_staff_id
    where id = p_invoice_id and status <> 'sent';
end;
$$;

grant execute on function public.mark_invoice_sent(uuid) to authenticated;

-- invoice_itemの取消専用入口（post_recordsのcancel_post_recordと同型）。
-- actor(cancelled_by_staff_id)も同様にcurrent_staff_id()でサーバー側解決する。
create or replace function public.cancel_invoice_item(
  p_invoice_item_id uuid,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_staff_id uuid;
begin
  if not public.can_view_finance() then
    raise exception 'この操作を行う権限がありません（請求・売上）';
  end if;

  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'ログインが必要です';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception '取消理由を入力してください';
  end if;

  update public.invoice_items
    set cancelled_at = now(), cancelled_by_staff_id = v_staff_id, cancel_reason = p_reason
    where id = p_invoice_item_id and cancelled_at is null;
end;
$$;

grant execute on function public.cancel_invoice_item(uuid, text) to authenticated;
