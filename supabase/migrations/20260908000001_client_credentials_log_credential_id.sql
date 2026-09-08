-- client_credentials: activity_logsからcredential自体のid(client_credentials.id)を
-- 追跡できるようにし、同時にlogin_id/password_vault_url/notesの複製をやめる。
-- entity_type='client' / entity_id=client_id は既存のclient_assignments・
-- posting_schedule_rulesと同じ「顧客の履歴タブに出す」設計を踏襲し変更しない
-- （clients/[id]の履歴タブは entity_type='client' AND entity_id=clientId で
--  問い合わせているため、entity_typeを変えるとそこから消えてしまう）。
-- 20260907000002は本番適用済みのため書き換えず、本ファイルで関数のみ差し替える。

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
      jsonb_build_object('credential_id', old.id, 'service_name', old.service_name),
      null
    );
    return old;
  end if;

  insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
  values (
    public.current_staff_id(), 'client', new.client_id,
    case when tg_op = 'INSERT' then 'credential_created' else 'credential_changed' end,
    case when tg_op = 'UPDATE' then jsonb_build_object('credential_id', old.id, 'service_name', old.service_name) else null end,
    jsonb_build_object('credential_id', new.id, 'service_name', new.service_name)
  );
  return new;
end;
$$;

-- トリガー自体(after insert or update or delete)は20260907000002のものをそのまま使うため
-- 再定義不要。CREATE OR REPLACE FUNCTIONにより既存トリガーは自動的に新しい関数本体で動作する。
