-- Wチェック待ち一覧(/wchecks)のSidebar新着バッジ専用。
-- スタッフごとに「最後に一覧を開いた時刻」を1行だけ保持する。
-- notificationsの既読管理とは役割を分けるため、既存テーブルへは一切触れない。

create table if not exists public.wcheck_list_views (
  staff_id uuid primary key references public.staff (id) on delete cascade,
  last_viewed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists wcheck_list_views_set_updated_at on public.wcheck_list_views;
create trigger wcheck_list_views_set_updated_at
  before update on public.wcheck_list_views
  for each row execute function public.set_updated_at();

alter table public.wcheck_list_views enable row level security;

-- 「他staffの閲覧状態は変更できない」: 自分自身の行のみSELECT/INSERT/UPDATE可能。
-- 行が存在しないstaffはアプリ側で「新着0件」として扱う（既存の待ち行列を初回に
-- 大量表示しないための安全側デフォルト。バックフィルや特別なNULL処理は行わない）。
drop policy if exists wcheck_list_views_select_own on public.wcheck_list_views;
create policy wcheck_list_views_select_own on public.wcheck_list_views
  for select
  to authenticated
  using (staff_id = public.current_staff_id());

drop policy if exists wcheck_list_views_insert_own on public.wcheck_list_views;
create policy wcheck_list_views_insert_own on public.wcheck_list_views
  for insert
  to authenticated
  with check (staff_id = public.current_staff_id());

drop policy if exists wcheck_list_views_update_own on public.wcheck_list_views;
create policy wcheck_list_views_update_own on public.wcheck_list_views
  for update
  to authenticated
  using (staff_id = public.current_staff_id())
  with check (staff_id = public.current_staff_id());
