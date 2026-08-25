-- clients ベーステーブルへの直接SELECT権限は authenticated へ付与しない方針を維持したまま、
-- UPDATE ... WHERE id = ... が要求するSELECT権限の不足（permission denied for table clients）
-- を解消する。create_client() と同じ設計方針:
--   - SECURITY DEFINERの専用RPCとし、関数内で is_active_staff() を明示チェック
--   - RLSのUPDATEポリシー clients_update_staff と同じ認可条件を再現するのみで、強めても弱めてもいない
--   - 戻り値は void とし、データは一切返さない
--   - EXECUTE権限は authenticated のみに限定し、Supabaseのデフォルト権限で
--     自動付与される anon 分は明示的にrevokeする（create_client()適用時に判明した挙動）
--
-- 対象は同一原因を持つ3箇所: updateBasicInfoAction / updateContractAction /
-- updateReminderSettingAction。

-- ---------------------------------------------------------------------------
-- 基本情報の更新
-- ---------------------------------------------------------------------------

create or replace function public.update_client_basic_info(
  p_client_id uuid,
  p_company_name text,
  p_shop_name text,
  p_phone text,
  p_email text,
  p_contact_name text,
  p_industry text,
  p_inflow_channel text,
  p_contact_method text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() then
    raise exception 'permission denied for table clients';
  end if;

  update public.clients set
    company_name = p_company_name,
    shop_name = p_shop_name,
    phone = p_phone,
    email = p_email,
    contact_name = p_contact_name,
    industry = p_industry,
    inflow_channel = p_inflow_channel,
    contact_method = p_contact_method,
    notes = p_notes
  where id = p_client_id;
end;
$$;

revoke all on function public.update_client_basic_info(
  uuid, text, text, text, text, text, text, text, text, text
) from public;
grant execute on function public.update_client_basic_info(
  uuid, text, text, text, text, text, text, text, text, text
) to authenticated;
revoke execute on function public.update_client_basic_info(
  uuid, text, text, text, text, text, text, text, text, text
) from anon;

-- ---------------------------------------------------------------------------
-- 契約情報の更新（料金・売上は canViewFinance 相当のスタッフのみ）
-- ---------------------------------------------------------------------------
-- 料金・売上を書き換えられない権限のスタッフからの不正な変更は、
-- 既存トリガー enforce_clients_finance_columns（auth.uid()由来の can_view_finance() を
-- 参照）が引き続き最終防衛として機能するため、p_update_finance はUXの都合であり
-- セキュリティ上の唯一の防衛線ではない。

create or replace function public.update_client_contract(
  p_client_id uuid,
  p_contract_status text,
  p_contract_start_date date,
  p_contract_end_date date,
  p_update_finance boolean default false,
  p_revenue_amount numeric default null,
  p_fee_amount numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() then
    raise exception 'permission denied for table clients';
  end if;

  if p_update_finance then
    update public.clients set
      contract_status = p_contract_status,
      contract_start_date = p_contract_start_date,
      contract_end_date = p_contract_end_date,
      revenue_amount = p_revenue_amount,
      fee_amount = p_fee_amount
    where id = p_client_id;
  else
    update public.clients set
      contract_status = p_contract_status,
      contract_start_date = p_contract_start_date,
      contract_end_date = p_contract_end_date
    where id = p_client_id;
  end if;
end;
$$;

revoke all on function public.update_client_contract(
  uuid, text, date, date, boolean, numeric, numeric
) from public;
grant execute on function public.update_client_contract(
  uuid, text, date, date, boolean, numeric, numeric
) to authenticated;
revoke execute on function public.update_client_contract(
  uuid, text, date, date, boolean, numeric, numeric
) from anon;

-- ---------------------------------------------------------------------------
-- 通知・催促設定の更新
-- ---------------------------------------------------------------------------

create or replace function public.update_client_reminder_setting(
  p_client_id uuid,
  p_material_reminder_enabled boolean,
  p_client_confirmation_reminder_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() then
    raise exception 'permission denied for table clients';
  end if;

  update public.clients set
    material_reminder_enabled = p_material_reminder_enabled,
    client_confirmation_reminder_enabled = p_client_confirmation_reminder_enabled
  where id = p_client_id;
end;
$$;

revoke all on function public.update_client_reminder_setting(
  uuid, boolean, boolean
) from public;
grant execute on function public.update_client_reminder_setting(
  uuid, boolean, boolean
) to authenticated;
revoke execute on function public.update_client_reminder_setting(
  uuid, boolean, boolean
) from anon;
