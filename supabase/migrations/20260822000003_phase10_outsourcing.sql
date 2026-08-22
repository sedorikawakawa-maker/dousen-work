-- Phase 10: 外注管理
-- docs/database.md 準拠。外注先はDOUSEN WORKへログインしない。

create table if not exists public.outsourcing_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete set null,
  production_task_id uuid references public.production_tasks (id) on delete set null,
  title text not null,
  contractor_name text not null,
  instruction text,
  -- database.mdには無いカラムだが、公開アップロード画面で「素材リンク」を
  -- instructionと分けて表示するために追加（要ユーザー確認）
  material_link text,
  requested_at timestamptz not null default now(),
  due_date date,
  upload_token_hash text not null unique,
  token_expires_at timestamptz,
  status text not null default 'requested'
    check (status in ('draft', 'requested', 'in_progress', 'delivered', 'completed', 'cancelled')),
  created_by_staff_id uuid not null references public.staff (id),
  created_at timestamptz not null default now()
);

create index if not exists outsourcing_requests_client_idx on public.outsourcing_requests (client_id);
create index if not exists outsourcing_requests_task_idx on public.outsourcing_requests (production_task_id);
create index if not exists outsourcing_requests_status_idx on public.outsourcing_requests (status, due_date);

alter table public.outsourcing_requests enable row level security;

drop policy if exists outsourcing_requests_select on public.outsourcing_requests;
create policy outsourcing_requests_select on public.outsourcing_requests
  for select to authenticated using (public.is_active_staff());

drop policy if exists outsourcing_requests_insert on public.outsourcing_requests;
create policy outsourcing_requests_insert on public.outsourcing_requests
  for insert to authenticated with check (public.is_active_staff());

drop policy if exists outsourcing_requests_update on public.outsourcing_requests;
create policy outsourcing_requests_update on public.outsourcing_requests
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

-- ---------------------------------------------------------------------------
-- outsourcing_deliveries
-- ---------------------------------------------------------------------------

create table if not exists public.outsourcing_deliveries (
  id uuid primary key default gen_random_uuid(),
  outsourcing_request_id uuid not null references public.outsourcing_requests (id) on delete cascade,
  drive_file_id text,
  drive_url text,
  contractor_note text,
  delivered_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists outsourcing_deliveries_request_idx
  on public.outsourcing_deliveries (outsourcing_request_id, delivered_at desc);

alter table public.outsourcing_deliveries enable row level security;

drop policy if exists outsourcing_deliveries_select on public.outsourcing_deliveries;
create policy outsourcing_deliveries_select on public.outsourcing_deliveries
  for select to authenticated using (public.is_active_staff());

-- 外注先はログインしないため、公開アップロードフォームからの登録は
-- service_role(管理クライアント)経由でRLSをバイパスして行う

-- ---------------------------------------------------------------------------
-- 納品登録 + ステータス更新を1トランザクションで行う関数。
-- Google Drive格納が失敗した場合はこの関数を呼ばないことで、
-- 納品完了状態を確定させない（post_recordsと同じ考え方）。
-- ---------------------------------------------------------------------------

create or replace function public.create_outsourcing_delivery(
  p_outsourcing_request_id uuid,
  p_drive_file_id text,
  p_drive_url text,
  p_contractor_note text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.outsourcing_deliveries (
    outsourcing_request_id, drive_file_id, drive_url, contractor_note
  ) values (
    p_outsourcing_request_id, p_drive_file_id, p_drive_url, p_contractor_note
  ) returning id into v_id;

  update public.outsourcing_requests
    set status = 'delivered'
    where id = p_outsourcing_request_id
      and status not in ('completed', 'cancelled');

  return v_id;
end;
$$;

grant execute on function public.create_outsourcing_delivery(uuid, text, text, text) to service_role;
