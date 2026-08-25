-- 顧客情報の実運用向け拡張:
-- 1. 提供サービス（複数選択、text[]。単一の新規列で足りるため中間テーブルは作らない）
-- 2. 会社ロゴ/店舗サムネイル（Supabase Storageの公開URLをclients.thumbnail_urlへ保存）
-- 連絡手段/流入経路/業種は既存どおりtext自由入力のまま変更しない
-- （UI側でプルダウン化し、選択肢外の既存値もフォールバック表示する）。

alter table public.clients add column if not exists services text[] not null default '{}';
alter table public.clients add column if not exists thumbnail_url text;

-- ---------------------------------------------------------------------------
-- clients_view: 既存の全列 + 新規2列。既存のcase文（料金・売上のパート非表示）はそのまま維持。
-- ---------------------------------------------------------------------------
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
  c.material_reminder_enabled,
  c.client_confirmation_reminder_enabled,
  c.created_at,
  c.updated_at,
  c.services,
  c.thumbnail_url
from public.clients c
where public.is_active_staff();

grant select on public.clients_view to authenticated;

-- ---------------------------------------------------------------------------
-- create_client: p_services を追加（引数の型リストが変わるため旧シグネチャをDROPしてから再作成）。
-- ---------------------------------------------------------------------------
drop function if exists public.create_client(
  text, text, text, text, text, text, text, text, text, date, text
);

create or replace function public.create_client(
  p_company_name text,
  p_shop_name text default null,
  p_phone text default null,
  p_email text default null,
  p_contact_name text default null,
  p_industry text default null,
  p_inflow_channel text default null,
  p_contact_method text default null,
  p_contract_status text default 'proposal',
  p_contract_start_date date default null,
  p_notes text default null,
  p_services text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_active_staff() then
    raise exception 'permission denied for table clients';
  end if;

  insert into public.clients (
    client_code, company_name, shop_name, phone, email, contact_name,
    industry, inflow_channel, contact_method, contract_status, current_status,
    contract_start_date, contract_end_date, notes, revenue_amount, fee_amount,
    material_wait_started_at, services
  ) values (
    '', p_company_name, p_shop_name, p_phone, p_email, p_contact_name,
    p_industry, p_inflow_channel, p_contact_method, p_contract_status, 'on_track',
    p_contract_start_date, null, p_notes, null, null, null, p_services
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_client(
  text, text, text, text, text, text, text, text, text, date, text, text[]
) from public;
grant execute on function public.create_client(
  text, text, text, text, text, text, text, text, text, date, text, text[]
) to authenticated;
revoke execute on function public.create_client(
  text, text, text, text, text, text, text, text, text, date, text, text[]
) from anon;

-- ---------------------------------------------------------------------------
-- update_client_basic_info: p_services を追加（同様にDROPしてから再作成）。
-- ---------------------------------------------------------------------------
drop function if exists public.update_client_basic_info(
  uuid, text, text, text, text, text, text, text, text, text
);

create or replace function public.update_client_basic_info(
  p_client_id uuid,
  p_company_name text,
  p_shop_name text,
  p_phone text,
  p_email text,
  p_contact_name text,
  p_industry text,
  p_inflow_channel text,
  p_contact_method text,
  p_notes text,
  p_services text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() then
    raise exception 'permission denied for table clients';
  end if;

  update public.clients set
    company_name = p_company_name,
    shop_name = p_shop_name,
    phone = p_phone,
    email = p_email,
    contact_name = p_contact_name,
    industry = p_industry,
    inflow_channel = p_inflow_channel,
    contact_method = p_contact_method,
    notes = p_notes,
    services = p_services
  where id = p_client_id;
end;
$$;

revoke all on function public.update_client_basic_info(
  uuid, text, text, text, text, text, text, text, text, text, text[]
) from public;
grant execute on function public.update_client_basic_info(
  uuid, text, text, text, text, text, text, text, text, text, text[]
) to authenticated;
revoke execute on function public.update_client_basic_info(
  uuid, text, text, text, text, text, text, text, text, text, text[]
) from anon;

-- ---------------------------------------------------------------------------
-- update_client_thumbnail: サムネイルURLの設定・削除専用（削除時はNULLを渡す）。
-- ---------------------------------------------------------------------------
create or replace function public.update_client_thumbnail(
  p_client_id uuid,
  p_thumbnail_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() then
    raise exception 'permission denied for table clients';
  end if;

  update public.clients set thumbnail_url = p_thumbnail_url where id = p_client_id;
end;
$$;

revoke all on function public.update_client_thumbnail(uuid, text) from public;
grant execute on function public.update_client_thumbnail(uuid, text) to authenticated;
revoke execute on function public.update_client_thumbnail(uuid, text) from anon;

-- ---------------------------------------------------------------------------
-- Storage: 顧客サムネイル専用バケット（Google Driveの素材フォルダとは完全に別）。
-- ロゴ画像は機密情報ではない前提のためpublicバケットとし、<img>から直接
-- 公開URLで表示できるようにする（署名URLの再生成が不要でシンプル）。
-- 書込（insert/update/delete）はis_active_staff()で保護し、
-- サイズ/形式はバケット設定（file_size_limit/allowed_mime_types）でも強制する。
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-thumbnails', 'client-thumbnails', true, 5242880,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists client_thumbnails_select on storage.objects;
create policy client_thumbnails_select on storage.objects
  for select
  using (bucket_id = 'client-thumbnails');

drop policy if exists client_thumbnails_insert on storage.objects;
create policy client_thumbnails_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'client-thumbnails' and public.is_active_staff());

drop policy if exists client_thumbnails_update on storage.objects;
create policy client_thumbnails_update on storage.objects
  for update to authenticated
  using (bucket_id = 'client-thumbnails' and public.is_active_staff())
  with check (bucket_id = 'client-thumbnails' and public.is_active_staff());

drop policy if exists client_thumbnails_delete on storage.objects;
create policy client_thumbnails_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'client-thumbnails' and public.is_active_staff());
