-- clients ベーステーブルへの直接SELECT権限は authenticated へ付与しない方針
-- （料金・売上情報を含むため clients_view 経由のみ許可、原則8）を維持したまま、
-- 顧客登録直後に INSERT ... RETURNING id が要求するSELECT権限の不足
-- （permission denied for table clients）を解消するための最小権限RPC。
--
-- RLSのINSERTポリシー clients_write_staff と同じ条件（is_active_staff()）を
-- 関数内で明示チェックすることで、SECURITY DEFINERによるRLSバイパスを
-- 実質的にRLSと同一の認可条件で再現する。戻り値は新規clientのidのみ。

create or replace function public.create_client(
  p_company_name text,
  p_shop_name text default null,
  p_phone text default null,
  p_email text default null,
  p_contact_name text default null,
  p_industry text default null,
  p_inflow_channel text default null,
  p_contact_method text default null,
  p_contract_status text default 'proposal',
  p_contract_start_date date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_active_staff() then
    raise exception 'permission denied for table clients';
  end if;

  insert into public.clients (
    client_code, company_name, shop_name, phone, email, contact_name,
    industry, inflow_channel, contact_method, contract_status, current_status,
    contract_start_date, contract_end_date, notes, revenue_amount, fee_amount,
    material_wait_started_at
  ) values (
    '', p_company_name, p_shop_name, p_phone, p_email, p_contact_name,
    p_industry, p_inflow_channel, p_contact_method, p_contract_status, 'on_track',
    p_contract_start_date, null, p_notes, null, null, null
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_client(
  text, text, text, text, text, text, text, text, text, date, text
) from public;

grant execute on function public.create_client(
  text, text, text, text, text, text, text, text, text, date, text
) to authenticated;
