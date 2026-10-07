-- Phase 2D hardening: 本番リリース前にDBレベルの穴を2つ塞ぐ。
--   1. mark_invoice_sent: 「PDF未発行でもsentにできる」既存ギャップをRPC本体で防御する。
--      Server Action側のガード(markInvoiceSentGuarded)は引き続き維持し、DB/アプリの二重防御にする。
--   2. invoice_itemsのtax_rate確定を「取消RPC + 直接INSERT」の2リクエストから、
--      1つのRPC呼び出し(1トランザクション)へ統合し、途中失敗時に旧明細も新明細も残らない
--      ようにする。税率は常に人間が選択した値のみを受け取り、システムは判定しない。
--      一度generated(正式発行済み)になった請求書の明細は変更できないようにする。
-- 既存データへの破壊的UPDATEは行わない。DELETE権限は追加しない。

-- ---------------------------------------------------------------------------
-- 1. mark_invoice_sent: generatedな有効invoice_documentの存在を必須化する。
-- 既存の権限チェック(can_view_finance/current_staff_id)・最終UPDATE文（invoices_log_sent
-- トリガーが見るのと同じUPDATE）はそのまま維持し、ログ仕様・他のstatus遷移には影響しない。
-- ---------------------------------------------------------------------------

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
  v_status text;
  v_has_generated_document boolean;
begin
  if not public.can_view_finance() then
    raise exception 'この操作を行う権限がありません（請求・売上）';
  end if;

  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'ログインが必要です';
  end if;

  select status into v_status
  from public.invoices
  where id = p_invoice_id
  for update;

  if v_status is null then
    raise exception '対象の請求書が見つかりません';
  end if;
  if v_status <> 'prepared' then
    raise exception '請求書作成済み（prepared）の状態でなければ送付済みにできません';
  end if;

  select exists (
    select 1 from public.invoice_documents
    where invoice_id = p_invoice_id and voided_at is null and status = 'generated'
  ) into v_has_generated_document;

  if not v_has_generated_document then
    raise exception '正式な請求書PDFが発行済み（generated）の状態でなければ送付済みにできません';
  end if;

  update public.invoices
    set status = 'sent', sent_at = now(), sent_by_staff_id = v_staff_id
    where id = p_invoice_id and status <> 'sent';
end;
$$;

-- grantは既存のまま変更不要（CREATE OR REPLACE FUNCTIONは既存のGRANT/ACLを維持するため）。

-- ---------------------------------------------------------------------------
-- 2. RPC: set_invoice_item_tax_rate
-- invoice_itemsは作成後immutable（Phase2Aのenforce_invoice_items_cancel_only_updateが
-- tax_rate/tax_categoryを含む全内容カラムの直接UPDATEを禁止している。このトリガー自体は
-- 今回変更しない）。そのため「取消して同一内容＋税率だけ設定した新明細を作る」処理を
-- 1トランザクションで原子的に実行する専用RPCを新設する。
-- ---------------------------------------------------------------------------

create or replace function public.set_invoice_item_tax_rate(
  p_invoice_item_id uuid,
  p_tax_rate numeric,
  p_tax_category text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_old_cancelled_at timestamptz;
  v_old_tax_rate numeric;
  v_invoice_id uuid;
  v_client_id uuid;
  v_billing_rule_id uuid;
  v_billing_month date;
  v_revenue_month date;
  v_subject text;
  v_description text;
  v_quantity numeric;
  v_unit_price_ex_tax numeric;
  v_tax_excluded_amount numeric;
  v_amount_override numeric;
  v_notes text;
  v_invoice_status text;
  v_has_generated_document boolean;
  v_new_item_id uuid;
begin
  if not public.can_view_finance() then
    raise exception 'この操作を行う権限がありません（請求・売上）';
  end if;
  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'ログインが必要です';
  end if;

  -- 税率は常に人間が選択した値のみを受け取る（10%/8%/0%のみ許可。システムが自動判定しない）。
  if p_tax_rate is null or p_tax_rate not in (0, 0.08, 0.1) then
    raise exception '税率の指定が不正です';
  end if;

  select cancelled_at, tax_rate, invoice_id, client_id, billing_rule_id, billing_month, revenue_month,
         subject, description, quantity, unit_price_ex_tax, tax_excluded_amount, amount_override, notes
  into v_old_cancelled_at, v_old_tax_rate, v_invoice_id, v_client_id, v_billing_rule_id, v_billing_month,
       v_revenue_month, v_subject, v_description, v_quantity, v_unit_price_ex_tax, v_tax_excluded_amount,
       v_amount_override, v_notes
  from public.invoice_items
  where id = p_invoice_item_id
  for update;

  if v_invoice_id is null then
    raise exception '対象の明細が見つかりません';
  end if;
  if v_old_cancelled_at is not null then
    raise exception 'この明細は既に取消済みです';
  end if;
  if v_old_tax_rate is not null then
    raise exception 'この明細は既に税率が設定済みです';
  end if;

  select status into v_invoice_status
  from public.invoices
  where id = v_invoice_id
  for update;

  if v_invoice_status is null then
    raise exception '対象の請求書が見つかりません';
  end if;
  if v_invoice_status <> 'planned' then
    raise exception 'この請求書は税率を設定できる状態ではありません（作成済み/送付済みのため）';
  end if;

  -- 一度generated(正式発行済み)になった請求書の明細は変更できない
  -- （発行前・取消後の再発行待ち・issuing中(未generated)はまだ変更可）。
  select exists (
    select 1 from public.invoice_documents
    where invoice_id = v_invoice_id and voided_at is null and status = 'generated'
  ) into v_has_generated_document;
  if v_has_generated_document then
    raise exception '正式発行済み（generated）の請求書の明細は変更できません';
  end if;

  update public.invoice_items
    set cancelled_at = now(), cancelled_by_staff_id = v_staff_id, cancel_reason = '税率確定のため明細を再作成'
    where id = p_invoice_item_id;

  insert into public.invoice_items (
    invoice_id, client_id, billing_rule_id, billing_month, revenue_month,
    subject, description, quantity, unit_price_ex_tax, tax_excluded_amount, amount_override,
    tax_rate, tax_category, notes
  ) values (
    v_invoice_id, v_client_id, v_billing_rule_id, v_billing_month, v_revenue_month,
    v_subject, v_description, v_quantity, v_unit_price_ex_tax, v_tax_excluded_amount, v_amount_override,
    p_tax_rate, p_tax_category, v_notes
  )
  returning id into v_new_item_id;

  -- activity_logs: 既存のinvoice_items_log_cancellationトリガー(after update)が、上の取消
  -- 更新で自動的にinvoice_item_cancelledログを1件記録する（cancel_reasonに理由が残るため、
  -- 新規の専用ログは追加しない。新明細のINSERT自体は既存の請求登録フローと同様ログ対象外のまま
  -- ＝二重ログを増やさない）。

  return v_new_item_id;
end;
$$;

revoke all on function public.set_invoice_item_tax_rate(uuid, numeric, text) from public;
revoke execute on function public.set_invoice_item_tax_rate(uuid, numeric, text) from anon;
grant execute on function public.set_invoice_item_tax_rate(uuid, numeric, text) to authenticated;
