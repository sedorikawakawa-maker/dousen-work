-- client_credentials: part_timeを「担当顧客のみ閲覧可」へ変更し、
-- insert/update/deleteはpresident/executive/employee（can_view_finance）限定にする。
-- 未ログイン・inactive staffはcan_view_finance()/current_staff_id()が共にfalse/nullを返すため
-- どちらの分岐にも該当せず、従来どおりアクセス不可のまま。
-- ---------------------------------------------------------------------------

drop policy if exists client_credentials_select on public.client_credentials;
create policy client_credentials_select on public.client_credentials
  for select to authenticated
  using (
    public.can_view_finance()
    or exists (
      select 1
      from public.client_assignments ca
      where ca.client_id = client_credentials.client_id
        and ca.staff_id = public.current_staff_id()
        and ca.active_to is null
    )
  );

drop policy if exists client_credentials_insert on public.client_credentials;
create policy client_credentials_insert on public.client_credentials
  for insert to authenticated with check (public.can_view_finance());

drop policy if exists client_credentials_update on public.client_credentials;
create policy client_credentials_update on public.client_credentials
  for update to authenticated using (public.can_view_finance()) with check (public.can_view_finance());

drop policy if exists client_credentials_delete on public.client_credentials;
create policy client_credentials_delete on public.client_credentials
  for delete to authenticated using (public.can_view_finance());

-- ---------------------------------------------------------------------------
-- client_credentials: 削除もactivity_logsへ記録する（従来はinsert/updateのみ対象で、
-- 「誰がいつログイン情報を削除したか」が監査ログに残らなかった）。
-- ---------------------------------------------------------------------------

create or replace function public.log_client_credentials_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      public.current_staff_id(), 'client', old.client_id, 'credential_deleted',
      jsonb_build_object(
        'service_name', old.service_name, 'login_id', old.login_id, 'password_vault_url', old.password_vault_url
      ),
      null
    );
    return old;
  end if;

  insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
  values (
    public.current_staff_id(), 'client', new.client_id,
    case when tg_op = 'INSERT' then 'credential_created' else 'credential_changed' end,
    case when tg_op = 'UPDATE' then jsonb_build_object(
      'service_name', old.service_name, 'login_id', old.login_id, 'password_vault_url', old.password_vault_url
    ) else null end,
    jsonb_build_object(
      'service_name', new.service_name, 'login_id', new.login_id, 'password_vault_url', new.password_vault_url
    )
  );
  return new;
end;
$$;

drop trigger if exists client_credentials_log_change on public.client_credentials;
create trigger client_credentials_log_change
  after insert or update or delete on public.client_credentials
  for each row execute function public.log_client_credentials_change();
