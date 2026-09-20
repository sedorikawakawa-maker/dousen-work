-- billing_rules: スポット請求（one_time）を誤登録した場合に、未送信（対応するinvoiceが
-- status='planned'）であれば安全に取消できるようにする。DELETEは使わず、invoice_items/invoices
-- と同じ「取消して履歴を残す」設計（cancelled_at/cancelled_by_staff_id/cancel_reason）を踏襲する。
-- 既存行はすべてcancelled_at等がNULLのまま追加されるため、既存データ・既存機能への影響はない。

alter table public.billing_rules
  add column cancelled_at timestamptz,
  add column cancelled_by_staff_id uuid references public.staff (id),
  add column cancel_reason text;

alter table public.billing_rules
  add constraint billing_rules_cancel_reason_required
  check (cancelled_at is null or cancel_reason is not null);

-- 取消はスポット請求（one_time）のみを対象とする。定期請求(recurring)は既存の
-- 「停止する」「この月から内容を変更」で運用する（今回の対象外・変更しない）。
alter table public.billing_rules
  add constraint billing_rules_cancel_only_one_time
  check (cancelled_at is null or billing_type = 'one_time');

-- 取消済み行は完全凍結（取消の取り消し・再取消ともに不可）。
-- 取消操作（cancelled_atをnullから設定する更新）自体も、取消関連カラム以外の同時変更を禁止する
-- （invoice_itemsのenforce_invoice_items_cancel_only_updateと同じ思想。既存の
--  changeRecurringBillingRuleFromMonthAction/deactivateRecurringBillingRuleはcancelled_atに
--  一切触れないため、このトリガーの影響を受けない）。
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
       or new.created_by_staff_id is distinct from old.created_by_staff_id
       or new.created_at is distinct from old.created_at then
      raise exception '取消操作以外の変更を同時に行うことはできません';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists billing_rules_enforce_cancellation on public.billing_rules;
create trigger billing_rules_enforce_cancellation
  before update on public.billing_rules
  for each row execute function public.enforce_billing_rules_cancellation();

-- activity_logs: 取消操作もbilling_ruleログの一種として記録する。既存のトリガー本体
-- (billing_rules_log_change、20260907000001で作成済み)はそのままに、関数だけ差し替える
-- （CREATE OR REPLACEにより既存トリガーは自動的に新しい本体で動作するため再作成不要）。
-- 作成時・通常変更時のログ挙動は一切変更しない。
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

-- スポット請求（one_time）取消の唯一の入口。
-- 対応するinvoice_item（未取消のもの）が存在する場合、そのinvoiceがplanned以外なら取消できない
-- （prepared/sentの請求書は既存の凍結方針どおり一切変更しない）。
-- invoice_item側の取消は既存のcancel_invoice_item RPC（Phase 1実装）をそのまま呼び出して行う。
-- actor(cancelled_by_staff_id)は他のRPCと同様、current_staff_id()でサーバー側解決する。
create or replace function public.cancel_one_time_billing_rule(
  p_billing_rule_id uuid,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_billing_type text;
  v_cancelled_at timestamptz;
  v_invoice_item_id uuid;
  v_invoice_status text;
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

  select billing_type, cancelled_at into v_billing_type, v_cancelled_at
  from public.billing_rules
  where id = p_billing_rule_id;

  if v_billing_type is null then
    raise exception '対象のスポット請求が見つかりません';
  end if;
  if v_billing_type <> 'one_time' then
    raise exception 'スポット請求（one_time）以外は取消できません';
  end if;
  if v_cancelled_at is not null then
    raise exception '既に取消済みです';
  end if;

  select ii.id, i.status into v_invoice_item_id, v_invoice_status
  from public.invoice_items ii
  join public.invoices i on i.id = ii.invoice_id
  where ii.billing_rule_id = p_billing_rule_id and ii.cancelled_at is null
  limit 1;

  if v_invoice_item_id is not null then
    if v_invoice_status = 'sent' then
      raise exception '送付済みのため取消できません';
    elsif v_invoice_status = 'prepared' then
      raise exception '送付準備中のため取消できません';
    end if;
  end if;

  update public.billing_rules
    set cancelled_at = now(), cancelled_by_staff_id = v_staff_id, cancel_reason = p_reason
    where id = p_billing_rule_id and cancelled_at is null;

  if v_invoice_item_id is not null then
    perform public.cancel_invoice_item(v_invoice_item_id, p_reason);
  end if;
end;
$$;

grant execute on function public.cancel_one_time_billing_rule(uuid, text) to authenticated;
