-- Permission-only migration: 請求・売上系RPCのうち、2026-09-07のPhase13請求基盤migration
-- （「anon/PUBLICから明示的にEXECUTEを剥奪する」方針が確立する前の世代）で作成された
-- 3つのRPCが、grant execute ... to authenticated; のみを行い、
-- revoke all ... from public / revoke execute ... from anon を一度も実行していなかったため、
-- anon（未認証ロール）がEXECUTE権限を保持したままになっていた。
--
-- これらのRPCはいずれもsecurity invokerであり、内部でcan_view_finance()/current_staff_id()を
-- 明示チェックしているため、anonが実際に呼び出してもデータは変更されない
-- （実害は無い）。ただし「anonから実行不可」という権限面の原則を他の新しいRPCと揃えるため、
-- 権限（GRANT/REVOKE）だけを修正する。関数本体・table・RLS・triggerには一切触れない
-- （CREATE OR REPLACE FUNCTIONは使用しない）。
--
-- 対象外（今回は変更しない）:
--   - enforce_*/log_* 系のトリガー関数: RETURNS trigger のため、トリガー経由以外では
--     Postgresの仕様上直接呼び出せず（PostgREST/RPC経由の実行自体が構造的に成立しない）、
--     実質的なリスクが無いと判断。意図せず挙動を変える可能性があるため今回は触れない。
--   - begin_invoice_document_issue / begin_invoice_document_generation_attempt /
--     complete_invoice_document_generation / mark_invoice_document_generation_failed /
--     void_invoice_document / set_invoice_item_tax_rate / confirm_accounting_document_expenses /
--     log_credential_password_access: 監査済みで既にanon EXECUTE不可を確認済みのため対象外。

revoke all on function public.mark_invoice_sent(uuid) from public;
revoke execute on function public.mark_invoice_sent(uuid) from anon;
grant execute on function public.mark_invoice_sent(uuid) to authenticated;

revoke all on function public.cancel_invoice_item(uuid, text) from public;
revoke execute on function public.cancel_invoice_item(uuid, text) from anon;
grant execute on function public.cancel_invoice_item(uuid, text) to authenticated;

revoke all on function public.cancel_one_time_billing_rule(uuid, text) from public;
revoke execute on function public.cancel_one_time_billing_rule(uuid, text) from anon;
grant execute on function public.cancel_one_time_billing_rule(uuid, text) to authenticated;
