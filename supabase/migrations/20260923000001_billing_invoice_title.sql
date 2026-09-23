-- 請求の「件名」（invoice_title）を追加する。
-- 既存のsubject（billing_rules/invoice_items）は今後も「摘要」（明細ごと）として扱い、変更しない。
-- 「件名」は請求書(invoice)単位で1つの新しい概念であり、既存subjectへは流用しない。
--
-- 保存先:
--   - invoices.invoice_title      … その請求書（顧客×請求月）に表示する件名そのもの。
--   - billing_rules.invoice_title … 将来ローリング窓で生成される請求書へ引き継ぐ「件名」。
--     rule.subjectがinvoice_items.subjectへ生成時にコピーされるのと同じ仕組みを、
--     invoice_titleについても generateInvoiceItemForOneTimeRule /
--     generateInvoiceItemsForRecurringRule 側で流用する（アプリ側のロジックで引き継ぐ。
--     DB側の自動コピーは行わない）。
--
-- 既存行には件名が存在しないため、推測値を入れずNULL許容のまま追加する（後方互換性維持）。
alter table public.invoices
  add column invoice_title text;

alter table public.billing_rules
  add column invoice_title text;

-- enforce_billing_rules_cancellation（取消操作の同時変更禁止チェック）の対象カラムに
-- invoice_titleも追加する（既存の全カラム列挙方式と同じ扱いにするため。トリガー本体の
-- 再作成は不要、CREATE OR REPLACE FUNCTIONで既存トリガーがそのまま新しい本体を使う）。
create or replace function public.enforce_billing_rules_cancellation()
returns trigger
language plpgsql
as $$
begin
  if old.cancelled_at is not null then
    raise exception '取消済みの請求設定は変更できません';
  end if;

  if new.cancelled_at is not null then
    if new.client_id is distinct from old.client_id
       or new.billing_type is distinct from old.billing_type
       or new.subject is distinct from old.subject
       or new.description is distinct from old.description
       or new.quantity is distinct from old.quantity
       or new.unit_price_ex_tax is distinct from old.unit_price_ex_tax
       or new.notes is distinct from old.notes
       or new.valid_from is distinct from old.valid_from
       or new.valid_to is distinct from old.valid_to
       or new.revenue_month_offset_months is distinct from old.revenue_month_offset_months
       or new.one_time_billing_month is distinct from old.one_time_billing_month
       or new.one_time_revenue_month is distinct from old.one_time_revenue_month
       or new.is_active is distinct from old.is_active
       or new.invoice_title is distinct from old.invoice_title
       or new.created_by_staff_id is distinct from old.created_by_staff_id
       or new.created_at is distinct from old.created_at then
      raise exception '取消操作以外の変更を同時に行うことはできません';
    end if;
  end if;

  return new;
end;
$$;

-- activity_logs: billing_rule作成時のログにinvoice_titleを含める（機密情報ではないため）。
-- 既存の作成・変更ログの挙動（対象カラム・トリガー本体）はこれ以外変更しない。
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
        'invoice_title', new.invoice_title,
        'quantity', new.quantity, 'unit_price_ex_tax', new.unit_price_ex_tax,
        'valid_from', new.valid_from, 'valid_to', new.valid_to,
        'one_time_billing_month', new.one_time_billing_month
      )
    );
    return new;
  end if;

  if old.cancelled_at is null and new.cancelled_at is not null then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      new.cancelled_by_staff_id, 'billing_rule', new.id, 'billing_rule_cancelled',
      jsonb_build_object('cancelled_at', null),
      jsonb_build_object(
        'cancelled_at', new.cancelled_at, 'cancelled_by_staff_id', new.cancelled_by_staff_id,
        'cancel_reason', new.cancel_reason, 'subject', new.subject
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
