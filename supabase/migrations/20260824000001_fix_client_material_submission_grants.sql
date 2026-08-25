-- create_client_material_submission は顧客向け公開フォームから service_role 経由でのみ
-- 呼び出す設計だが、Supabaseが新規関数作成時にanon/authenticatedへデフォルト権限を
-- 自動付与するため、意図せずEXECUTE権限が残っていた。明示的に取り消す。

revoke execute on function public.create_client_material_submission(
  uuid, text, text, text, text, text, text, date, jsonb
) from anon;

revoke execute on function public.create_client_material_submission(
  uuid, text, text, text, text, text, text, date, jsonb
) from authenticated;
