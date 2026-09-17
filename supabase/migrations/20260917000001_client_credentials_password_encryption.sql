-- client_credentials: パスワードを暗号化して保存できるようにする。
-- 生パスワードは一切保存しない（保存するのはAES-256-GCMの暗号文のみ）。
-- 適用前に実DBで client_credentials=0件 をREAD ONLYで再確認済み（既存データへの影響なし）。

alter table public.client_credentials
  add column encrypted_password bytea,
  add column password_encryption_version smallint;

-- サービス側管理のパスワード(encrypted_password)か、1Password等の外部保管先(password_vault_url)の
-- 少なくとも一方は必須とする（両方存在してもよい）。
alter table public.client_credentials
  add constraint client_credentials_secret_present
  check (encrypted_password is not null or password_vault_url is not null);

-- ---------------------------------------------------------------------------
-- パスワードの閲覧・コピーはclient_credentials行そのものを変更しないため、
-- 既存のAFTER INSERT/UPDATE/DELETEトリガー方式ではactivity_logsへ記録できない。
-- 専用のSECURITY DEFINER RPCで「権限の再検証」と「ログ記録」を1つにまとめ、
-- 呼び出し側（Server Action）がactor_staff_id/client_idを渡す必要がない設計にする
-- （既存のmark_invoice_sent/cancel_invoice_item等と同じく、actorは必ずDB側で
--  current_staff_id()から解決し、クライアントからの申告を信用しない）。
-- ---------------------------------------------------------------------------
create or replace function public.log_credential_password_access(
  p_credential_id uuid,
  p_access_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_service_name text;
  v_allowed boolean;
begin
  if p_access_type not in ('view', 'copy') then
    raise exception 'invalid access_type';
  end if;

  select client_id, service_name into v_client_id, v_service_name
  from public.client_credentials
  where id = p_credential_id;

  if v_client_id is null then
    raise exception 'credential not found';
  end if;

  v_allowed := public.can_view_finance() or exists (
    select 1
    from public.client_assignments ca
    where ca.client_id = v_client_id
      and ca.staff_id = public.current_staff_id()
      and ca.active_to is null
  );

  if not v_allowed then
    raise exception 'permission denied';
  end if;

  insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
  values (
    public.current_staff_id(), 'client', v_client_id,
    case when p_access_type = 'view' then 'credential_password_viewed' else 'credential_password_copied' end,
    null,
    jsonb_build_object('credential_id', p_credential_id, 'service_name', v_service_name)
  );
end;
$$;

revoke all on function public.log_credential_password_access(uuid, text) from public;
grant execute on function public.log_credential_password_access(uuid, text) to authenticated;
revoke execute on function public.log_credential_password_access(uuid, text) from anon;
