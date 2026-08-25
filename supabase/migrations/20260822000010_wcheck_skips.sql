-- Wチェックを省略して顧客確認待ちへ直接進める機能。
-- w_checks / client_confirmations と同じ「INSERT-onlyで履歴を積み上げ、削除・上書きしない」設計に揃える。
-- RLSは既存のWチェック系（w_checks_select等）と同じく is_active_staff() のみとし、
-- part_timeを含む全有効スタッフが利用できるようにする（運用判断: Wチェック自体が既に全スタッフ可能なため）。

create table if not exists public.wcheck_skips (
  id uuid primary key default gen_random_uuid(),
  production_task_id uuid not null references public.production_tasks (id) on delete cascade,
  staff_id uuid not null references public.staff (id),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists wcheck_skips_task_idx on public.wcheck_skips (production_task_id, created_at desc);

alter table public.wcheck_skips enable row level security;

drop policy if exists wcheck_skips_select on public.wcheck_skips;
create policy wcheck_skips_select on public.wcheck_skips
  for select to authenticated using (public.is_active_staff());

drop policy if exists wcheck_skips_insert on public.wcheck_skips;
create policy wcheck_skips_insert on public.wcheck_skips
  for insert to authenticated with check (public.is_active_staff());

-- 既存のlog_*系トリガーと同じ方針で、activity_logsにも横断的な監査履歴を残す。
create or replace function public.log_wcheck_skip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
  values (
    new.staff_id, 'production_task', new.production_task_id, 'wcheck_skipped',
    null,
    jsonb_build_object('reason', new.reason, 'wcheck_skip_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists wcheck_skips_log_activity on public.wcheck_skips;
create trigger wcheck_skips_log_activity
  after insert on public.wcheck_skips
  for each row execute function public.log_wcheck_skip();
