-- Phase 2A バグ修正: begin_invoice_document_issue は security invoker であるにもかかわらず
-- public.clients を直接SELECTしていたため、authenticated（finance権限ユーザーであっても）には
-- clientsテーブルへのSELECT権限そのものが無く、"permission denied for table clients" で
-- 必ず失敗していた（本番ROLLBACKテストで発見）。
--
-- clients_view には必要な company_name / id が含まれ、authenticated は既にSELECT権限を
-- 持っている（他の既存コードと同じ参照先）ため、該当1箇所のみを public.clients_view へ
-- 差し替える。関数本体以外（table/RLS/grants/triggers/columns、他RPC）は一切変更しない。
-- CREATE OR REPLACE FUNCTIONは既存のGRANT（authenticatedのみEXECUTE可）を変更しないため、
-- grant/revoke文はこのmigrationに含めない。

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
  -- ※修正: public.clients への直接SELECTはauthenticatedに権限が無く失敗するため、
  --   既存コードの他の箇所と同じくpublic.clients_viewを参照する（security invokerのまま）。
  select c.company_name, cbp.billing_company_name, cbp.billing_department, cbp.billing_contact_name,
         cbp.billing_postal_code, cbp.billing_postal_address, cbp.payment_due_days
  into v_client_company_name, v_billing_company_name, v_billing_department, v_billing_contact_name,
       v_billing_postal_code, v_billing_postal_address, v_payment_due_days
  from public.clients_view c
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
