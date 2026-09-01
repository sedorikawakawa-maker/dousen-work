-- 顧客の「ログイン者」機能: この顧客のSNS等アカウントへログインできるstaffの恒常的な関連。
-- client_assignments（主担当・副担当。タスク引き継ぎ等の副作用あり・1顧客1名まで）とは
-- 完全に別概念で、多対多・件数制限なし・副作用なしの単純な関連のため中間テーブルとする。
-- Realtime Presence（稼働状況）とも無関係。
--
-- セキュリティ: client_id ↔ staff_id の関連のみを持つ。SNSパスワード・synthetic email・
-- auth_user_id・OAuth token・password_vault等のsecretは一切持たせない
-- （それらは既存のclient_credentials／staff.auth_user_id等が個別に担当する）。

create table if not exists public.client_login_staff (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  staff_id uuid not null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by_staff_id uuid references public.staff (id)
);

create unique index if not exists client_login_staff_unique
  on public.client_login_staff (client_id, staff_id);
create index if not exists client_login_staff_client_idx
  on public.client_login_staff (client_id);
create index if not exists client_login_staff_staff_idx
  on public.client_login_staff (staff_id);

alter table public.client_login_staff enable row level security;

-- 全active staffが閲覧・追加・削除可能（part_time含む。既存のclient_assignmentsと同じ方針）。
-- 行の中身を書き換える運用は想定しないため、UPDATEポリシーは設けない。
drop policy if exists client_login_staff_select on public.client_login_staff;
create policy client_login_staff_select on public.client_login_staff
  for select
  to authenticated
  using (public.is_active_staff());

drop policy if exists client_login_staff_insert on public.client_login_staff;
create policy client_login_staff_insert on public.client_login_staff
  for insert
  to authenticated
  with check (public.is_active_staff());

drop policy if exists client_login_staff_delete on public.client_login_staff;
create policy client_login_staff_delete on public.client_login_staff
  for delete
  to authenticated
  using (public.is_active_staff());
