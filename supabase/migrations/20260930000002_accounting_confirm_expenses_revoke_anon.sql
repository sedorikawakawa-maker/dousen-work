-- confirm_accounting_document_expenses は security invoker RPCであり、内部で
-- can_view_finance()/current_staff_id() を明示チェックしているため anon が呼んでも
-- データ作成はできないが、SupabaseのデフォルトDB権限設定により、REVOKE ALL ... FROM PUBLIC
-- だけでは剥奪できない anon への直接EXECUTE権限が残っていた。
-- このRPCについてのみ、anonからのEXECUTE権限を明示的に剥奪する。
-- 既存の他のfinance系RPC（cancel_one_time_billing_rule等）には今回一切手を加えない。

revoke execute on function public.confirm_accounting_document_expenses(uuid, date, text, text, jsonb) from anon;
