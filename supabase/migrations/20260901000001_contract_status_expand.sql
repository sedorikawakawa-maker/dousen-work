-- contract_status に「契約書作成待ち(contract_preparation)」「失注(lost)」を追加する。
-- 既存4値(contracted/proposal/paused/ended)・既存データは一切変更しない。
-- CHECK制約を拡張するのみで、update_client_contract / create_client 等の既存RPCは
-- contract_status値をそのままclientsテーブルへ渡すだけの実装のため、コード変更は不要。

alter table public.clients drop constraint if exists clients_contract_status_check;

alter table public.clients add constraint clients_contract_status_check
  check (contract_status in (
    'contracted', 'proposal', 'contract_preparation', 'lost', 'paused', 'ended'
  ));
