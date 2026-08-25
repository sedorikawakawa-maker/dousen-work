-- updateClientStatusAction (src/app/status-action.ts) は authenticated クライアントで
-- clients に直接 SELECT（現在の current_status 取得）→ UPDATE を行っており、
-- clients ベーステーブルのSELECT/UPDATE時の列参照に必要な権限が無いため、
-- create_client() / update_client_*() と同じ原因（permission denied for table clients）
-- で失敗する（エラーが握りつぶされているため画面上は無反応に見える）。
--
-- 現在値の参照が必要なロジック（material_waiting への出入りで
-- material_wait_started_at を記録/クリアする）ごとSECURITY DEFINER関数へ移し、
-- authenticated 側は一切 clients を直接SELECT/UPDATEしないようにする。

create or replace function public.update_client_status(
  p_client_id uuid,
  p_new_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status text;
  v_material_wait_started_at timestamptz;
begin
  if not public.is_active_staff() then
    raise exception 'permission denied for table clients';
  end if;

  select current_status into v_current_status
  from public.clients
  where id = p_client_id;

  if p_new_status = 'material_waiting' and v_current_status is distinct from 'material_waiting' then
    v_material_wait_started_at := now();
  elsif p_new_status <> 'material_waiting' then
    v_material_wait_started_at := null;
  else
    select material_wait_started_at into v_material_wait_started_at
    from public.clients
    where id = p_client_id;
  end if;

  update public.clients set
    current_status = p_new_status,
    material_wait_started_at = v_material_wait_started_at
  where id = p_client_id;
end;
$$;

revoke all on function public.update_client_status(uuid, text) from public;
grant execute on function public.update_client_status(uuid, text) to authenticated;
revoke execute on function public.update_client_status(uuid, text) from anon;
