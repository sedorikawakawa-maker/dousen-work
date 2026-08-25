-- create_client() は Supabaseのデフォルト権限により anon にもEXECUTEが
-- 個別付与されていた（revoke ... from public では anon 分は剥がれない）。
-- is_active_staff() チェックにより anon 実行時は例外になるため実害はないが、
-- 最小権限の原則に沿って anon のEXECUTE権限を明示的に剥奪する。

revoke execute on function public.create_client(
  text, text, text, text, text, text, text, text, text, date, text
) from anon;
