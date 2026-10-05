-- Phase 2A: 正式請求書PDF発行のためのDB基盤のみ。
-- PDF生成・Google Drive保存・/accounting/invoices UIはこのmigrationには含まない（後続Phaseで実装）。
--
-- 設計方針:
--   - company_profile（自社情報）は drive_integration と同じ singleton pattern
--     （id integer primary key default 1 / check (id = 1)）。INSERT用RLSポリシーは作らず、
--     このmigration自身が唯一の行(id=1)を1回だけ投入する。以後、アプリ層はUPDATEのみ行う。
--   - invoice_documents は「発行済み請求書そのもの」。invoices/invoice_itemsを書き換えず、
--     発行時点の内容を snapshot jsonb へ丸ごと固定する（既存invoices.*_snapshotと同じ思想）。
--   - invoice_number は年月(issue_date基準)+連番のcounter tableで原子的に採番し、
--     一度発行した番号は（voidしても）再利用しない。
--   - invoice_items.tax_rate / tax_category は nullable追加のみ。既存データへのUPDATEは行わない。
--   - このmigrationでは invoices.status を prepared へは進めない（PDF生成・Drive保存が
--     まだ無いため。invoice_documents.status='issuing'止まり。Phase 2Cでgenerated+preparedへ進める）。

-- ---------------------------------------------------------------------------
-- company_profile（自社情報。singleton。drive_integrationと同型）
-- ---------------------------------------------------------------------------

create table if not exists public.company_profile (
  id integer primary key default 1,
  company_name text,
  postal_code text,
  address text,
  phone text,
  email text,
  invoice_registration_number text,
  bank_name text,
  branch_name text,
  account_type text,
  account_number text,
  account_holder_name text,
  default_payment_due_days integer check (default_payment_due_days is null or default_payment_due_days > 0),
  note text,
  logo_drive_file_id text,
  logo_drive_url text,
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid references public.staff (id),
  constraint company_profile_singleton check (id = 1)
);

drop trigger if exists company_profile_set_updated_at on public.company_profile;
create trigger company_profile_set_updated_at
  before update on public.company_profile
  for each row execute function public.set_updated_at();

-- singletonの唯一の行をここで1回だけ投入する。アプリ層はINSERTを一切行わない
-- （RLSにもINSERTポリシーを作らないため、以後INSERTは構造的に不可能）。
insert into public.company_profile (id) values (1) on conflict (id) do nothing;

alter table public.company_profile enable row level security;

drop policy if exists company_profile_select on public.company_profile;
create policy company_profile_select on public.company_profile
  for select to authenticated using (public.can_view_finance());
drop policy if exists company_profile_update on public.company_profile;
create policy company_profile_update on public.company_profile
  for update to authenticated using (public.can_view_finance()) with check (public.can_view_finance());
-- INSERT/DELETEポリシーは意図的に作成しない（singletonの保護）。

-- ---------------------------------------------------------------------------
-- client_billing_profiles 追加項目
-- ---------------------------------------------------------------------------

alter table public.client_billing_profiles
  add column billing_department text,
  add column billing_postal_code text,
  add column payment_due_days integer check (payment_due_days is null or payment_due_days > 0);

-- ---------------------------------------------------------------------------
-- invoice_items.tax_rate / tax_category（nullable追加のみ。既存データへのUPDATEは行わない）
-- ---------------------------------------------------------------------------

alter table public.invoice_items
  add column tax_rate numeric check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 1)),
  add column tax_category text;

-- enforce_invoice_items_cancel_only_update（既存の「取消関連以外は変更不可」トリガー）の
-- 対象カラムに tax_rate / tax_category を追加する（既存の全カラム列挙方式と同じ扱いにするため。
-- トリガー本体の再作成は不要、CREATE OR REPLACE FUNCTIONで既存トリガーがそのまま新しい本体を使う）。
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
     or new.tax_rate is distinct from old.tax_rate
     or new.tax_category is distinct from old.tax_category
     or new.created_at is distinct from old.created_at then
    raise exception 'invoice_itemsの請求内容は変更できません（取消関連項目のみ更新可能です）';
  end if;

  if old.cancelled_at is not null then
    raise exception '取消済みのinvoice_itemsは変更できません';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- invoice_number_counters（年月ごとの採番カウンタ。アプリ層からは直接操作せず、
-- begin_invoice_document_issue RPCの内部処理としてのみ使う）
-- ---------------------------------------------------------------------------

create table if not exists public.invoice_number_counters (
  period_key text primary key,
  last_number integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.invoice_number_counters enable row level security;

drop policy if exists invoice_number_counters_select on public.invoice_number_counters;
create policy invoice_number_counters_select on public.invoice_number_counters
  for select to authenticated using (public.can_view_finance());
drop policy if exists invoice_number_counters_insert on public.invoice_number_counters;
create policy invoice_number_counters_insert on public.invoice_number_counters
  for insert to authenticated with check (public.can_view_finance());
drop policy if exists invoice_number_counters_update on public.invoice_number_counters;
create policy invoice_number_counters_update on public.invoice_number_counters
  for update to authenticated using (public.can_view_finance()) with check (public.can_view_finance());
-- DELETEポリシーは作成しない。

-- ---------------------------------------------------------------------------
-- invoice_documents（正式請求書の発行データ。1 invoice に対し有効な行は常に最大1件）
-- ---------------------------------------------------------------------------

create table if not exists public.invoice_documents (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  invoice_number text not null unique,
  status text not null default 'issuing' check (status in ('issuing', 'generated', 'voided')),
  generation_error text,
  snapshot jsonb not null,
  issue_date date not null,
  due_date date not null,
  drive_file_id text,
  drive_url text,
  issued_by_staff_id uuid not null references public.staff (id),
  issued_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by_staff_id uuid references public.staff (id),
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invoice_documents_void_reason_required check (voided_at is null or void_reason is not null),
  constraint invoice_documents_voided_fields check (
    (voided_at is null and voided_by_staff_id is null)
    or (voided_at is not null and voided_by_staff_id is not null)
  ),
  constraint invoice_documents_voided_status check (voided_at is null or status = 'voided'),
  constraint invoice_documents_due_date_order check (due_date >= issue_date)
);

-- 1 invoiceにつき、voidされていない(=有効な)invoice_documentは常に最大1件まで
-- （二重クリック・同時発行でも、2件目のINSERTはこの制約違反で確実に失敗する）。
create unique index if not exists invoice_documents_invoice_active_key
  on public.invoice_documents (invoice_id) where voided_at is null;

create index if not exists invoice_documents_invoice_idx on public.invoice_documents (invoice_id);
create index if not exists invoice_documents_status_idx on public.invoice_documents (status);

drop trigger if exists invoice_documents_set_updated_at on public.invoice_documents;
create trigger invoice_documents_set_updated_at
  before update on public.invoice_documents
  for each row execute function public.set_updated_at();

-- immutable設計: voided済みは一切変更不可。発行内容（invoice_id/invoice_number/snapshot/
-- issue_date/due_date/issued_by_staff_id/issued_at/created_at）はvoid前でも変更不可。
-- 許可される更新は generation_error / drive_file_id / drive_url / status(issuing→generated) /
-- voided関連（void RPC経由）のみ（既存のenforce_*_cancel_only_update思想を踏襲）。
create or replace function public.enforce_invoice_documents_immutable_update()
returns trigger
language plpgsql
as $$
begin
  if old.voided_at is not null then
    raise exception 'void済みのinvoice_documentsは変更できません';
  end if;

  if new.invoice_id is distinct from old.invoice_id
     or new.invoice_number is distinct from old.invoice_number
     or new.snapshot is distinct from old.snapshot
     or new.issue_date is distinct from old.issue_date
     or new.due_date is distinct from old.due_date
     or new.issued_by_staff_id is distinct from old.issued_by_staff_id
     or new.issued_at is distinct from old.issued_at
     or new.created_at is distinct from old.created_at then
    raise exception 'invoice_documentsの発行内容は変更できません';
  end if;

  if old.status = 'generated' and new.status = 'issuing' then
    raise exception 'generated状態からissuingへ戻すことはできません';
  end if;

  if new.status = 'generated' and (new.drive_file_id is null or new.drive_url is null) then
    raise exception 'generated状態にするにはdrive_file_id/drive_urlが必要です';
  end if;

  return new;
end;
$$;

drop trigger if exists invoice_documents_enforce_immutable_update on public.invoice_documents;
create trigger invoice_documents_enforce_immutable_update
  before update on public.invoice_documents
  for each row execute function public.enforce_invoice_documents_immutable_update();

alter table public.invoice_documents enable row level security;

drop policy if exists invoice_documents_select on public.invoice_documents;
create policy invoice_documents_select on public.invoice_documents
  for select to authenticated using (public.can_view_finance());
drop policy if exists invoice_documents_insert on public.invoice_documents;
create policy invoice_documents_insert on public.invoice_documents
  for insert to authenticated with check (public.can_view_finance());
drop policy if exists invoice_documents_update on public.invoice_documents;
create policy invoice_documents_update on public.invoice_documents
  for update to authenticated using (public.can_view_finance()) with check (public.can_view_finance());
-- DELETEポリシーは作成しない。

-- ---------------------------------------------------------------------------
-- activity_logs連携（issuing行の作成とvoidのみ。Phase2Aの対象外
-- [generation_failed/generated/reissued]は後続Phaseで追加する。
-- snapshot全文は機密情報を含むため記録しない。invoice_id/invoice_number/statusのみ）
-- ---------------------------------------------------------------------------

create or replace function public.log_invoice_documents_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      new.issued_by_staff_id, 'invoice_document', new.id, 'invoice_document_issued',
      null,
      jsonb_build_object(
        'invoice_id', new.invoice_id, 'invoice_number', new.invoice_number,
        'status', new.status, 'issue_date', new.issue_date, 'due_date', new.due_date
      )
    );
    return new;
  end if;

  if old.voided_at is null and new.voided_at is not null then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      new.voided_by_staff_id, 'invoice_document', new.id, 'invoice_document_voided',
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status, 'void_reason', new.void_reason)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_documents_log_change on public.invoice_documents;
create trigger invoice_documents_log_change
  after insert or update on public.invoice_documents
  for each row execute function public.log_invoice_documents_change();

-- ---------------------------------------------------------------------------
-- RPC: begin_invoice_document_issue
-- 「正式請求書発行の準備データを固定する」ところまで（PDF生成・Drive保存は行わない）。
-- 1トランザクション内で: 権限確認 → invoices行ロック → status確認 → 有効文書重複確認 →
-- company_profile確認 → client_billing_profiles確認 → invoice_items確認(tax_rate含む) →
-- 採番 → due_date計算 → snapshot生成 → invoice_documents作成（status='issuing'）。
-- security invoker + 明示的な can_view_finance()/current_staff_id() チェック
-- （既存のmark_invoice_sent等と同じ方針。security definerは使わない）。
-- ---------------------------------------------------------------------------

create or replace function public.begin_invoice_document_issue(
  p_invoice_id uuid,
  p_issue_date date
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_invoice_status text;
  v_invoice_client_id uuid;
  v_invoice_billing_month date;
  v_invoice_title text;

  v_company_name text;
  v_company_postal_code text;
  v_company_address text;
  v_company_phone text;
  v_company_email text;
  v_company_invoice_registration_number text;
  v_company_bank_name text;
  v_company_branch_name text;
  v_company_account_type text;
  v_company_account_number text;
  v_company_account_holder_name text;
  v_company_default_payment_due_days integer;

  v_client_company_name text;
  v_billing_company_name text;
  v_billing_department text;
  v_billing_contact_name text;
  v_billing_postal_code text;
  v_billing_postal_address text;
  v_payment_due_days integer;
  v_recipient_company_name text;

  v_item_count integer;
  v_missing_tax_rate_count integer;
  v_items jsonb;

  v_due_days integer;
  v_due_date date;
  v_period_key text;
  v_seq integer;
  v_invoice_number text;
  v_snapshot jsonb;
  v_document_id uuid;
begin
  if not public.can_view_finance() then
    raise exception 'この操作を行う権限がありません（請求・売上）';
  end if;

  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'ログインが必要です';
  end if;

  if p_issue_date is null then
    raise exception '発行日を指定してください';
  end if;

  -- 1-4: invoices行をロックし、発行可能状態か確認する。
  select status, client_id, billing_month, invoice_title
  into v_invoice_status, v_invoice_client_id, v_invoice_billing_month, v_invoice_title
  from public.invoices
  where id = p_invoice_id
  for update;

  if v_invoice_status is null then
    raise exception '対象の請求書が見つかりません';
  end if;
  if v_invoice_status <> 'planned' then
    raise exception 'この請求書は既に作成済み/送付済みのため、新しく発行を開始できません';
  end if;

  -- 5: 有効なinvoice_documentが既に無いことを確認する（部分UNIQUE indexによる最終防衛線と二重）。
  if exists (
    select 1 from public.invoice_documents
    where invoice_id = p_invoice_id and voided_at is null
  ) then
    raise exception 'この請求書には既に有効な発行データ（発行準備中または発行済み）があります';
  end if;

  -- 6: company_profile（自社情報）が発行に必要な項目をすべて満たしていることを確認する。
  select company_name, postal_code, address, phone, email, invoice_registration_number,
         bank_name, branch_name, account_type, account_number, account_holder_name,
         default_payment_due_days
  into v_company_name, v_company_postal_code, v_company_address, v_company_phone, v_company_email,
       v_company_invoice_registration_number, v_company_bank_name, v_company_branch_name,
       v_company_account_type, v_company_account_number, v_company_account_holder_name,
       v_company_default_payment_due_days
  from public.company_profile
  where id = 1;

  if v_company_name is null or btrim(v_company_name) = ''
     or v_company_postal_code is null or btrim(v_company_postal_code) = ''
     or v_company_address is null or btrim(v_company_address) = ''
     or v_company_phone is null or btrim(v_company_phone) = ''
     or v_company_email is null or btrim(v_company_email) = ''
     or v_company_invoice_registration_number is null or btrim(v_company_invoice_registration_number) = ''
     or v_company_bank_name is null or btrim(v_company_bank_name) = ''
     or v_company_branch_name is null or btrim(v_company_branch_name) = ''
     or v_company_account_type is null or btrim(v_company_account_type) = ''
     or v_company_account_number is null or btrim(v_company_account_number) = ''
     or v_company_account_holder_name is null or btrim(v_company_account_holder_name) = '' then
    raise exception '自社情報（company_profile）が未設定のため、正式請求書を発行できません';
  end if;

  -- 7: client_billing_profiles（請求先情報）が発行に必要な項目を満たしていることを確認する。
  -- billing_company_nameが未設定の場合はclients.company_nameへフォールバックする
  -- （既存invoices作成時のスナップショットと同じ扱い）。
  select c.company_name, cbp.billing_company_name, cbp.billing_department, cbp.billing_contact_name,
         cbp.billing_postal_code, cbp.billing_postal_address, cbp.payment_due_days
  into v_client_company_name, v_billing_company_name, v_billing_department, v_billing_contact_name,
       v_billing_postal_code, v_billing_postal_address, v_payment_due_days
  from public.clients c
  left join public.client_billing_profiles cbp on cbp.client_id = c.id
  where c.id = v_invoice_client_id;

  v_recipient_company_name := coalesce(v_billing_company_name, v_client_company_name);

  if v_recipient_company_name is null or btrim(v_recipient_company_name) = ''
     or v_billing_postal_code is null or btrim(v_billing_postal_code) = ''
     or v_billing_postal_address is null or btrim(v_billing_postal_address) = '' then
    raise exception '請求先情報（client_billing_profiles）が未設定のため、正式請求書を発行できません';
  end if;

  -- 8-9: invoice_itemsが1件以上あり、全件tax_rateが設定済みであることを確認する。
  select count(*), count(*) filter (where tax_rate is null)
  into v_item_count, v_missing_tax_rate_count
  from public.invoice_items
  where invoice_id = p_invoice_id and cancelled_at is null;

  if v_item_count = 0 then
    raise exception 'この請求書には有効な明細がありません';
  end if;
  if v_missing_tax_rate_count > 0 then
    raise exception '税率が未設定の明細が%件あります。発行前に設定してください', v_missing_tax_rate_count;
  end if;

  -- 11: 支払期日 = 発行日 + 支払サイト（client側の個別設定を優先、無ければ自社デフォルト）。
  v_due_days := coalesce(v_payment_due_days, v_company_default_payment_due_days);
  if v_due_days is null then
    raise exception '支払期日の算定に必要な設定（支払サイト）がありません。client_billing_profiles.payment_due_daysまたはcompany_profile.default_payment_due_daysを設定してください';
  end if;
  v_due_date := p_issue_date + v_due_days;

  -- 10: invoice_number採番。period_key(issue_dateのYYYYMM)ごとのcounterをINSERT ... ON CONFLICT
  -- DO UPDATE ... RETURNINGで原子的に+1する。この1文自体が行ロックとして機能するため、
  -- 同時発行・二重クリックでも同じperiod_keyに対して重複した連番が発行されることはない。
  v_period_key := to_char(p_issue_date, 'YYYYMM');
  insert into public.invoice_number_counters (period_key, last_number)
  values (v_period_key, 1)
  on conflict (period_key) do update set last_number = public.invoice_number_counters.last_number + 1, updated_at = now()
  returning last_number into v_seq;
  v_invoice_number := v_period_key || '-' || lpad(v_seq::text, 4, '0');

  -- 12: snapshot生成。tax_amount/total_amountは端数処理ルールが未確定（税理士確認が必要）のため
  -- Phase2Aでは含めない（仮の税務ロジックを実装しない）。revenue_monthは明細ごとに異なり得るため
  -- invoice単位ではなくitem単位で保持する。
  select jsonb_agg(jsonb_build_object(
    'subject', subject,
    'description', description,
    'quantity', quantity,
    'unit_price_ex_tax', unit_price_ex_tax,
    'tax_excluded_amount', tax_excluded_amount,
    'tax_rate', tax_rate,
    'tax_category', tax_category,
    'revenue_month', revenue_month
  ) order by created_at)
  into v_items
  from public.invoice_items
  where invoice_id = p_invoice_id and cancelled_at is null;

  v_snapshot := jsonb_build_object(
    'issuer', jsonb_build_object(
      'company_name', v_company_name,
      'postal_code', v_company_postal_code,
      'address', v_company_address,
      'phone', v_company_phone,
      'email', v_company_email,
      'invoice_registration_number', v_company_invoice_registration_number,
      'bank_name', v_company_bank_name,
      'branch_name', v_company_branch_name,
      'account_type', v_company_account_type,
      'account_number', v_company_account_number,
      'account_holder_name', v_company_account_holder_name
    ),
    'recipient', jsonb_build_object(
      'company_name', v_recipient_company_name,
      'department', v_billing_department,
      'contact_name', v_billing_contact_name,
      'postal_code', v_billing_postal_code,
      'address', v_billing_postal_address
    ),
    'invoice', jsonb_build_object(
      'invoice_number', v_invoice_number,
      'invoice_title', v_invoice_title,
      'issue_date', p_issue_date,
      'due_date', v_due_date,
      'billing_month', v_invoice_billing_month
    ),
    'items', v_items
  );

  -- 13: invoice_documentsをstatus='issuing'で作成する。invoices.statusはここでは一切変更しない
  -- （Phase2Cでinvoice_documents.status='generated'到達後にprepared化する）。
  insert into public.invoice_documents (
    invoice_id, invoice_number, status, snapshot, issue_date, due_date, issued_by_staff_id
  ) values (
    p_invoice_id, v_invoice_number, 'issuing', v_snapshot, p_issue_date, v_due_date, v_staff_id
  )
  returning id into v_document_id;
  -- 14: activity_logsはinvoice_documents_log_changeトリガー(AFTER INSERT)が自動記録する。

  return jsonb_build_object(
    'invoice_document_id', v_document_id,
    'invoice_number', v_invoice_number,
    'issue_date', p_issue_date,
    'due_date', v_due_date
  );
end;
$$;

revoke all on function public.begin_invoice_document_issue(uuid, date) from public;
revoke execute on function public.begin_invoice_document_issue(uuid, date) from anon;
grant execute on function public.begin_invoice_document_issue(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: void_invoice_document
-- 発行準備済み/発行済みのinvoice_documentsを取消専用で無効化する（物理DELETEはしない）。
-- void後、invoice_numberは再利用しない（採番カウンタは一方向カウントアップのみのため、
-- void操作自体が番号を戻す処理を一切持たない。再発行は常に新しい連番で行われる）。
-- ---------------------------------------------------------------------------

create or replace function public.void_invoice_document(
  p_invoice_document_id uuid,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_voided_at timestamptz;
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

  select voided_at into v_voided_at
  from public.invoice_documents
  where id = p_invoice_document_id
  for update;

  if not found then
    raise exception '対象の請求書（発行データ）が見つかりません';
  end if;
  if v_voided_at is not null then
    raise exception '既に取消済みです';
  end if;

  update public.invoice_documents
    set voided_at = now(), voided_by_staff_id = v_staff_id, void_reason = p_reason, status = 'voided'
    where id = p_invoice_document_id and voided_at is null;
end;
$$;

revoke all on function public.void_invoice_document(uuid, text) from public;
revoke execute on function public.void_invoice_document(uuid, text) from anon;
grant execute on function public.void_invoice_document(uuid, text) to authenticated;
