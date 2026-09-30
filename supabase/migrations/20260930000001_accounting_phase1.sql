-- 経理機能 Phase 1: 書類BOX(accounting_documents) + 経費(expenses)。
-- 会計・税務判断を確定するシステムにはしない。AI/OCRはまだ実装しない
-- （ocr_status/ocr_raw_result/各*_candidate列は将来のAI自動入力のための受け皿として先に用意する）。
-- 既存のbilling_rules/invoice_items等と同じ「取消して履歴を残す」方針（物理DELETEしない）を踏襲する。

-- ---------------------------------------------------------------------------
-- accounting_documents: 原本ファイル + 未確定の抽出/入力候補（書類BOX）
-- ---------------------------------------------------------------------------

create table if not exists public.accounting_documents (
  id uuid primary key default gen_random_uuid(),

  document_type text not null check (document_type in ('receipt', 'invoice_received', 'other')),

  -- 原本はDriveに保存し、DBへはファイル本体を持たない（materials/production_videosと同じ方針）。
  drive_file_id text not null,
  drive_url text not null,
  file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes >= 0),
  file_hash text not null,

  uploaded_at timestamptz not null default now(),
  uploaded_by_staff_id uuid not null references public.staff (id),

  -- Phase1はOCRを実行しないため既定値'skipped'（「OCR未実施」を正直に表す）。
  -- Phase3でOCRを追加する際は、新規アップロード時の既定値を'pending'に変更するだけでよい設計。
  ocr_status text not null default 'skipped'
    check (ocr_status in ('pending', 'processing', 'completed', 'failed', 'skipped')),
  ocr_raw_result jsonb,

  -- 以下はAI/OCRまたは人間入力どちらから来ても同じ列に入る「候補値」。
  -- 会計上の確定値ではない（確定するのはexpensesの対応する*_confirmed列）。
  transaction_date_candidate date,
  vendor_name_candidate text,
  amount_candidate numeric,
  tax_amount_candidate numeric,
  tax_rate_candidate numeric,
  invoice_number_candidate text,
  description_candidate text,
  due_date_candidate date,
  payment_method_candidate text,
  account_category_candidate text,
  tax_category_candidate text,

  -- file_hash完全一致による重複検出結果。自動排除はせず警告表示のみに使う。
  duplicate_warning boolean not null default false,

  status text not null default 'uploaded' check (status in ('uploaded', 'confirmed', 'rejected', 'voided')),

  voided_at timestamptz,
  voided_by_staff_id uuid references public.staff (id),
  void_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint accounting_documents_void_reason_required check (voided_at is null or void_reason is not null)
);

create index if not exists accounting_documents_status_idx on public.accounting_documents (status);
create index if not exists accounting_documents_file_hash_idx on public.accounting_documents (file_hash);
create index if not exists accounting_documents_uploaded_at_idx on public.accounting_documents (uploaded_at desc);

drop trigger if exists accounting_documents_set_updated_at on public.accounting_documents;
create trigger accounting_documents_set_updated_at
  before update on public.accounting_documents
  for each row execute function public.set_updated_at();

-- confirmed/voidedになった書類は凍結する（invoice_items/billing_rulesの取消専用モデルと同じ思想）。
-- confirmed -> voided の遷移だけは許可し、それ以外の同時変更は禁止する。
create or replace function public.enforce_accounting_documents_lock()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'voided' then
    raise exception '取消済みの書類は変更できません';
  end if;

  if old.status = 'confirmed' then
    if new.status is distinct from 'voided' then
      raise exception '確定済みの書類は取消以外の変更ができません';
    end if;
    if new.document_type is distinct from old.document_type
       or new.drive_file_id is distinct from old.drive_file_id
       or new.drive_url is distinct from old.drive_url
       or new.file_name is distinct from old.file_name
       or new.mime_type is distinct from old.mime_type
       or new.file_size_bytes is distinct from old.file_size_bytes
       or new.file_hash is distinct from old.file_hash
       or new.uploaded_by_staff_id is distinct from old.uploaded_by_staff_id
       or new.uploaded_at is distinct from old.uploaded_at
       or new.transaction_date_candidate is distinct from old.transaction_date_candidate
       or new.vendor_name_candidate is distinct from old.vendor_name_candidate
       or new.amount_candidate is distinct from old.amount_candidate
       or new.tax_amount_candidate is distinct from old.tax_amount_candidate
       or new.tax_rate_candidate is distinct from old.tax_rate_candidate
       or new.invoice_number_candidate is distinct from old.invoice_number_candidate
       or new.description_candidate is distinct from old.description_candidate
       or new.due_date_candidate is distinct from old.due_date_candidate
       or new.payment_method_candidate is distinct from old.payment_method_candidate
       or new.account_category_candidate is distinct from old.account_category_candidate
       or new.tax_category_candidate is distinct from old.tax_category_candidate
       or new.created_at is distinct from old.created_at then
      raise exception '取消操作以外の変更を同時に行うことはできません';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists accounting_documents_enforce_lock on public.accounting_documents;
create trigger accounting_documents_enforce_lock
  before update on public.accounting_documents
  for each row execute function public.enforce_accounting_documents_lock();

-- activity_logs: upload / 内容編集 / 確定 / 取消 を記録する。
-- 機密情報の過剰保存を避けるため、原本ファイル内容やocr_raw_resultそのものは記録しない。
create or replace function public.log_accounting_documents_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      new.uploaded_by_staff_id, 'accounting_document', new.id, 'document_uploaded',
      null,
      jsonb_build_object('document_type', new.document_type, 'file_name', new.file_name, 'mime_type', new.mime_type)
    );
    return new;
  end if;

  if old.status = 'uploaded' and new.status = 'confirmed' then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      public.current_staff_id(), 'accounting_document', new.id, 'document_confirmed',
      null,
      jsonb_build_object('document_type', new.document_type, 'file_name', new.file_name)
    );
    return new;
  end if;

  if old.status is distinct from 'voided' and new.status = 'voided' then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      new.voided_by_staff_id, 'accounting_document', new.id, 'document_voided',
      jsonb_build_object('status', old.status),
      jsonb_build_object('void_reason', new.void_reason)
    );
    return new;
  end if;

  if old.transaction_date_candidate is distinct from new.transaction_date_candidate
     or old.vendor_name_candidate is distinct from new.vendor_name_candidate
     or old.amount_candidate is distinct from new.amount_candidate
     or old.document_type is distinct from new.document_type then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      public.current_staff_id(), 'accounting_document', new.id, 'document_updated',
      jsonb_build_object(
        'document_type', old.document_type, 'transaction_date_candidate', old.transaction_date_candidate,
        'vendor_name_candidate', old.vendor_name_candidate, 'amount_candidate', old.amount_candidate
      ),
      jsonb_build_object(
        'document_type', new.document_type, 'transaction_date_candidate', new.transaction_date_candidate,
        'vendor_name_candidate', new.vendor_name_candidate, 'amount_candidate', new.amount_candidate
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists accounting_documents_log_change on public.accounting_documents;
create trigger accounting_documents_log_change
  after insert or update on public.accounting_documents
  for each row execute function public.log_accounting_documents_change();

-- RLS: 4テーブル共通方針と同じくSELECT/INSERT/UPDATEのみcan_view_finance()。
-- DELETEポリシーは作らない（原則禁止。無効化はstatus='voided'で表現する）。
alter table public.accounting_documents enable row level security;

drop policy if exists accounting_documents_select on public.accounting_documents;
create policy accounting_documents_select on public.accounting_documents
  for select to authenticated using (public.can_view_finance());
drop policy if exists accounting_documents_insert on public.accounting_documents;
create policy accounting_documents_insert on public.accounting_documents
  for insert to authenticated with check (public.can_view_finance());
drop policy if exists accounting_documents_update on public.accounting_documents;
create policy accounting_documents_update on public.accounting_documents
  for update to authenticated using (public.can_view_finance()) with check (public.can_view_finance());

-- ---------------------------------------------------------------------------
-- expenses: 人間が確認・確定した経費のみ（AI候補はaccounting_documents側に留まる）
-- ---------------------------------------------------------------------------

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),

  -- nullable: 銀行手数料等、証憑が無い手入力経費にも将来対応するため。
  -- 1 document : N expenses を正常ケースとして許可する（1枚の証憑に複数の勘定科目・
  -- 複数の経費区分が含まれるケースに対応するため、UNIQUE制約は付けない）。
  -- 二重確定防止はaccounting_documents.statusのuploaded->confirmed遷移の原子性で担保する
  -- （confirmExpenseBatch: 先にstatusを'confirmed'へ更新できた場合のみexpensesを一括作成する）。
  document_id uuid references public.accounting_documents (id) on delete restrict,

  transaction_date date not null,
  vendor_name text not null,
  amount numeric not null check (amount >= 0),
  tax_amount numeric check (tax_amount is null or tax_amount >= 0),

  account_category_candidate text,
  account_category_confirmed text not null,
  tax_category_candidate text,
  tax_category_confirmed text,

  payment_method text,
  description text,

  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),

  confirmed_by_staff_id uuid not null references public.staff (id),
  confirmed_at timestamptz not null default now(),

  cancelled_at timestamptz,
  cancelled_by_staff_id uuid references public.staff (id),
  cancel_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint expenses_cancel_reason_required check (cancelled_at is null or cancel_reason is not null)
);

create index if not exists expenses_transaction_date_idx on public.expenses (transaction_date desc);
create index if not exists expenses_status_idx on public.expenses (status);
create index if not exists expenses_vendor_name_idx on public.expenses (vendor_name);
create index if not exists expenses_document_id_idx on public.expenses (document_id);

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

-- 取消専用の訂正モデル（invoice_itemsのenforce_invoice_items_cancel_only_updateと同じ思想）。
-- 確定後の内容（金額・取引先等）は一切書き換えない。取消関連カラムのみ更新可能。
create or replace function public.enforce_expenses_cancel_only_update()
returns trigger
language plpgsql
as $$
begin
  if new.document_id is distinct from old.document_id
     or new.transaction_date is distinct from old.transaction_date
     or new.vendor_name is distinct from old.vendor_name
     or new.amount is distinct from old.amount
     or new.tax_amount is distinct from old.tax_amount
     or new.account_category_candidate is distinct from old.account_category_candidate
     or new.account_category_confirmed is distinct from old.account_category_confirmed
     or new.tax_category_candidate is distinct from old.tax_category_candidate
     or new.tax_category_confirmed is distinct from old.tax_category_confirmed
     or new.payment_method is distinct from old.payment_method
     or new.description is distinct from old.description
     or new.confirmed_by_staff_id is distinct from old.confirmed_by_staff_id
     or new.confirmed_at is distinct from old.confirmed_at
     or new.created_at is distinct from old.created_at then
    raise exception '経費の内容は変更できません（取消関連項目のみ更新可能です）';
  end if;

  if old.cancelled_at is not null then
    raise exception '取消済みの経費は変更できません';
  end if;

  return new;
end;
$$;

drop trigger if exists expenses_enforce_cancel_only_update on public.expenses;
create trigger expenses_enforce_cancel_only_update
  before update on public.expenses
  for each row execute function public.enforce_expenses_cancel_only_update();

-- activity_logs: 確定 / 取消を記録する。
create or replace function public.log_expenses_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      new.confirmed_by_staff_id, 'expense', new.id, 'expense_confirmed',
      null,
      jsonb_build_object(
        'document_id', new.document_id, 'transaction_date', new.transaction_date,
        'vendor_name', new.vendor_name, 'amount', new.amount,
        'account_category_confirmed', new.account_category_confirmed
      )
    );
    return new;
  end if;

  if old.cancelled_at is null and new.cancelled_at is not null then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      new.cancelled_by_staff_id, 'expense', new.id, 'expense_cancelled',
      jsonb_build_object('cancelled_at', null),
      jsonb_build_object('cancelled_at', new.cancelled_at, 'cancel_reason', new.cancel_reason)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_log_change on public.expenses;
create trigger expenses_log_change
  after insert or update on public.expenses
  for each row execute function public.log_expenses_change();

alter table public.expenses enable row level security;

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated using (public.can_view_finance());
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert to authenticated with check (public.can_view_finance());
drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses
  for update to authenticated using (public.can_view_finance()) with check (public.can_view_finance());

-- ---------------------------------------------------------------------------
-- confirm_accounting_document_expenses: 経費確定を1トランザクションで完結させるRPC。
--
-- 個別のUPDATE/INSERTをアプリ側から複数回のリクエストで行うと、「documentはconfirmed化
-- できたがexpenses INSERTが通信エラー等で失敗する」といった中途半端な状態が起こり得るため、
-- 既存のmark_invoice_sent/cancel_invoice_item/cancel_one_time_billing_ruleと同じ
-- security invokerパターンのRPCとして1本化する。関数呼び出し自体がPostgresの
-- 1トランザクションであるため、途中で例外が発生すれば全ての変更（document更新・
-- expenses挿入すべて）が自動的にロールバックされる（document='uploaded'のまま、
-- expensesは1件も残らない）。
--
-- 同時実行対策: 対象documentをSELECT ... FOR UPDATEで排他ロックしてからstatusを確認する。
-- 同じdocumentに対する2つの確定処理が同時に実行された場合、後続のFOR UPDATEは先行
-- トランザクションのコミット（またはロールバック）まで待たされ、コミット後に
-- 再評価されたstatusが既に'uploaded'でなくなっているため安全に拒否される
-- （status='uploaded'条件も維持）。
-- ---------------------------------------------------------------------------
create or replace function public.confirm_accounting_document_expenses(
  p_document_id uuid,
  p_transaction_date date,
  p_vendor_name text,
  p_payment_method text,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_document_status text;
  v_document_amount_candidate numeric;
  v_item jsonb;
  v_new_expense_id uuid;
  v_expense_ids uuid[] := array[]::uuid[];
  v_items_total numeric := 0;
  v_amount numeric;
  v_tax_amount numeric;
  v_account_category_confirmed text;
  v_warning text := null;
begin
  if not public.can_view_finance() then
    raise exception 'この操作を行う権限がありません（経理）';
  end if;

  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'ログインが必要です';
  end if;

  if p_transaction_date is null then
    raise exception '取引日を入力してください';
  end if;
  if p_vendor_name is null or btrim(p_vendor_name) = '' then
    raise exception '取引先を入力してください';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '経費明細を1件以上入力してください';
  end if;

  -- 対象書類を排他ロックしてから状態確認する（証憑なしの手入力経費はp_document_id=nullで対象外）。
  if p_document_id is not null then
    select status, amount_candidate into v_document_status, v_document_amount_candidate
    from public.accounting_documents
    where id = p_document_id
    for update;

    if v_document_status is null then
      raise exception '対象の書類が見つかりません';
    end if;
    if v_document_status <> 'uploaded' then
      raise exception 'この書類は既に経費として確定済み、または取消済みです';
    end if;
  end if;

  -- 明細のvalidation（書き込み前に全件チェックし、どの明細が不正かを分かるメッセージにする）。
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_amount := nullif(v_item->>'amount', '')::numeric;
    if v_amount is null or v_amount < 0 then
      raise exception '明細の金額を正しく入力してください';
    end if;
    v_tax_amount := nullif(v_item->>'tax_amount', '')::numeric;
    if v_tax_amount is not null and v_tax_amount < 0 then
      raise exception '明細の税額を正しく入力してください';
    end if;
    v_account_category_confirmed := nullif(btrim(v_item->>'account_category_confirmed'), '');
    if v_account_category_confirmed is null then
      raise exception '明細の勘定科目を選択してください';
    end if;
    v_items_total := v_items_total + v_amount;
  end loop;

  -- 検証を通った明細をまとめて挿入する（1つの関数呼び出し=1トランザクションのため、
  -- ループで複数回INSERTしても、途中で失敗すればここまでの分も含め全てロールバックされる）。
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.expenses (
      document_id, transaction_date, vendor_name, amount, tax_amount,
      account_category_candidate, account_category_confirmed,
      tax_category_candidate, tax_category_confirmed,
      payment_method, description, confirmed_by_staff_id
    ) values (
      p_document_id,
      p_transaction_date,
      btrim(p_vendor_name),
      (v_item->>'amount')::numeric,
      nullif(v_item->>'tax_amount', '')::numeric,
      nullif(v_item->>'account_category_candidate', ''),
      btrim(v_item->>'account_category_confirmed'),
      nullif(v_item->>'tax_category_candidate', ''),
      nullif(v_item->>'tax_category_confirmed', ''),
      nullif(btrim(coalesce(p_payment_method, '')), ''),
      nullif(v_item->>'description', ''),
      v_staff_id
    )
    returning id into v_new_expense_id;

    v_expense_ids := array_append(v_expense_ids, v_new_expense_id);
  end loop;

  if p_document_id is not null then
    update public.accounting_documents set status = 'confirmed' where id = p_document_id;

    if v_document_amount_candidate is not null and abs(v_items_total - v_document_amount_candidate) > 0.01 then
      v_warning := format(
        '書類の合計金額（%s円）と経費明細の合計（%s円）が一致していません。',
        trim(to_char(v_document_amount_candidate, 'FM999,999,999,999')),
        trim(to_char(v_items_total, 'FM999,999,999,999'))
      );
    end if;
  end if;

  return jsonb_build_object('expense_ids', to_jsonb(v_expense_ids), 'warning', v_warning);
end;
$$;

-- PUBLICへのデフォルト実行権限を明示的に剥奪し、authenticatedのみに限定する
-- （既存RPCでは省略していたが、今回は明示的に行う）。
revoke all on function public.confirm_accounting_document_expenses(uuid, date, text, text, jsonb) from public;
grant execute on function public.confirm_accounting_document_expenses(uuid, date, text, text, jsonb) to authenticated;
