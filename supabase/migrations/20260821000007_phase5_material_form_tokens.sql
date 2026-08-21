-- Phase 5 追加: 顧客向け素材フォームのトークン化
-- client_id を公開URLに直接含めず、外注フォームと同様にトークン(hash保存)方式にする

create table if not exists public.material_form_tokens (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  token_hash text not null unique,
  is_active boolean not null default true,
  created_by_staff_id uuid references public.staff (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  -- 基本は有効期限なしでよいが、将来必要になった場合に備えて用意
  expires_at timestamptz
);

create index if not exists material_form_tokens_client_idx on public.material_form_tokens (client_id);

-- 顧客ごとに有効なトークンは常に1件のみ（再発行時は旧トークンを無効化してから新規発行する）
create unique index if not exists material_form_tokens_one_active_per_client
  on public.material_form_tokens (client_id)
  where is_active;

alter table public.material_form_tokens enable row level security;

drop policy if exists material_form_tokens_select on public.material_form_tokens;
create policy material_form_tokens_select on public.material_form_tokens
  for select to authenticated using (public.is_active_staff());

drop policy if exists material_form_tokens_insert on public.material_form_tokens;
create policy material_form_tokens_insert on public.material_form_tokens
  for insert to authenticated with check (public.is_active_staff());

drop policy if exists material_form_tokens_update on public.material_form_tokens;
create policy material_form_tokens_update on public.material_form_tokens
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

-- トークン検証(公開フォーム表示・投稿)はservice_role(管理クライアント)経由で行うため、
-- 匿名ロールへの参照権限は付与しない
