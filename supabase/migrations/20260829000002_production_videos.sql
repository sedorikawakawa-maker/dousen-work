-- 制作動画ライブラリ: 顧客ごとの「完成した納品用・投稿用動画」保管庫。
-- 制作途中動画・post_records/final保存とは連動しない、完全に独立した単独アップロード機能。
-- （registerPostRecordAction・post_records・final_drive_* 列は今回一切変更しない）

create table if not exists public.production_videos (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  post_type text check (post_type in ('reel', 'feed', 'story')),
  file_name text,
  drive_file_id text not null,
  drive_url text not null,
  memo text,
  uploaded_by_staff_id uuid not null references public.staff (id),
  created_at timestamptz not null default now()
);

create index if not exists production_videos_client_idx
  on public.production_videos (client_id, created_at desc);

alter table public.production_videos enable row level security;

-- 財務情報とは無関係。part_time含む全有効スタッフが閲覧・登録可能。
-- 今回は編集機能を作らないため、UPDATE/DELETEのポリシーは作らない（=誰も更新・削除不可）。
drop policy if exists production_videos_select on public.production_videos;
create policy production_videos_select on public.production_videos
  for select
  to authenticated
  using (public.is_active_staff());

drop policy if exists production_videos_insert on public.production_videos;
create policy production_videos_insert on public.production_videos
  for insert
  to authenticated
  with check (public.is_active_staff());
