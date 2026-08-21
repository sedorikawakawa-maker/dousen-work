-- Phase 2 追加: 顧客編集画面の「通知・催促設定」用フラグ
-- docs/ui-spec.md の顧客編集「編集対象」に含まれるが、database.md に対応カラムが
-- 明記されていないため、最小限のON/OFF設定として追加する（要ユーザー確認）。
-- true の場合のみ、素材待ち・顧客確認待ちの自動催促対象になる（催促ロジック自体はPhase7/9で実装）。

alter table public.clients
  add column if not exists reminder_enabled boolean not null default true;

create or replace view public.clients_view as
select
  c.id,
  c.client_code,
  c.company_name,
  c.shop_name,
  c.phone,
  c.email,
  c.contact_name,
  c.industry,
  c.inflow_channel,
  c.contact_method,
  c.contract_status,
  c.current_status,
  c.contract_start_date,
  c.contract_end_date,
  c.notes,
  case when public.can_view_finance() then c.revenue_amount else null end as revenue_amount,
  case when public.can_view_finance() then c.fee_amount else null end as fee_amount,
  c.material_wait_started_at,
  c.reminder_enabled,
  c.created_at,
  c.updated_at
from public.clients c
where public.is_active_staff();
