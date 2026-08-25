-- Google Drive連携設定（システム設定 → Google Drive連携画面）。
-- refresh tokenはアプリ層でAES-256-GCM暗号化した上でbyteaに保存し、DBの平文保存は行わない。
-- 生テーブルはauthenticated/anonから一切アクセスさせず、status_view（安全な列のみ）経由でのみ
-- 状態を閲覧できるようにする（clients / clients_view と同じ設計思想）。
-- 書き込みはすべてservice_role経由のserver actionから行うため、authenticated向けの
-- INSERT/UPDATE/DELETEポリシーは意図的に一切作成しない。

-- president / executive / employee のみ許可（part_timeは不可）。
-- can_view_finance() と条件は同じだが、目的が異なるため別名で公開する
-- （canAccessManagementFeaturesと同じ考え方）。
create or replace function public.can_manage_system_settings()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_staff_role(), '') in ('president', 'executive', 'employee');
$$;

create table if not exists public.drive_integration (
  id integer primary key default 1,
  status text not null default 'not_connected' check (status in ('not_connected', 'connected', 'error')),
  google_account_email text,
  refresh_token_encrypted bytea,
  root_folder_id text,
  root_folder_name text,
  last_verified_at timestamptz,
  last_verified_status text check (last_verified_status in ('ok', 'error')),
  last_error_message text,
  connected_by_staff_id uuid references public.staff (id),
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drive_integration_singleton check (id = 1)
);

drop trigger if exists drive_integration_set_updated_at on public.drive_integration;
create trigger drive_integration_set_updated_at
  before update on public.drive_integration
  for each row execute function public.set_updated_at();

-- 常に1行だけ存在する状態にしておき、画面側は「行が無い」状態を考慮しなくてよいようにする。
insert into public.drive_integration (id, status)
values (1, 'not_connected')
on conflict (id) do nothing;

alter table public.drive_integration enable row level security;

-- authenticated/anonへのポリシーは意図的に作成しない（service_role専用テーブル）。
-- Supabaseのデフォルト権限で新規テーブルにauthenticated/anonへ自動付与されるGRANTを明示的に剥奪する。
revoke all on public.drive_integration from authenticated, anon;

create view public.drive_integration_status_view as
select
  id,
  status,
  google_account_email,
  root_folder_id,
  root_folder_name,
  last_verified_at,
  last_verified_status,
  last_error_message,
  connected_at
from public.drive_integration
where public.can_manage_system_settings();

revoke all on public.drive_integration_status_view from authenticated, anon;
grant select on public.drive_integration_status_view to authenticated;
