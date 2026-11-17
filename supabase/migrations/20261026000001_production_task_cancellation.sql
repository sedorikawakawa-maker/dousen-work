-- 生成済み制作タスクの「個別取消」。
-- 物理DELETEではなく取消メタデータの追記方式にする理由:
--   generateTasksForRule()（src/lib/scheduling/generate.ts）は
--   「client_id + schedule_rule_id + scheduled_post_date + post_type」の行が存在しない場合のみ
--   INSERTする「不足分だけ生成」方式のため、物理DELETEすると次にクライアント詳細画面が
--   開かれた時点で同じタスクが自動再生成されてしまう。取消済みの行をテーブルへ残すことで、
--   アプリ側の存在チェックとDB側の部分UNIQUE index(production_tasks_unique_recurring)の
--   両方が「既に存在するタスク」として扱い、再生成が構造的に起きないようにする。
--
-- 既存のstatus遷移（material_waiting〜completed）には手を加えない。
-- status='cancelled'を追加するとstatusを参照する既存クエリ・ラベル・遷移判定すべてに
-- 影響するため、post_records / invoice_items / billing_rules と同じ
-- cancelled_at + cancelled_by_staff_id + cancel_reason の追記方式に揃える。
--
-- 既存データへの破壊的UPDATEは行わない。DELETE権限・DELETEポリシーは追加しない。

alter table public.production_tasks
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_staff_id uuid references public.staff (id),
  add column if not exists cancel_reason text;

-- 取消理由は必須（post_records_cancel_reason_requiredと同じ扱い）。
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'production_tasks_cancel_reason_required'
  ) then
    alter table public.production_tasks
      add constraint production_tasks_cancel_reason_required
      check (cancelled_at is null or cancel_reason is not null);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 取消済みタスクは以後一切変更できない（取消の巻き戻し・status遷移・担当変更も不可）。
-- 取消そのもののUPDATE（old.cancelled_at is null -> new.cancelled_at is not null）は
-- old.cancelled_atがnullのため通過する。
--
-- 注意: production_tasksには一括UPDATE経路（flagCarryoverForClientのis_carryover更新）が
-- あるため、アプリ側の一括UPDATEは必ず cancelled_at is null で絞る必要がある
-- （絞らないと取消済み行に当たった時点でこの例外によりUPDATE文全体が失敗する）。
-- ---------------------------------------------------------------------------

create or replace function public.enforce_production_tasks_cancelled_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.cancelled_at is not null then
    raise exception '取消済みの制作タスクは変更できません';
  end if;
  return new;
end;
$$;

drop trigger if exists production_tasks_enforce_cancelled_immutable on public.production_tasks;
create trigger production_tasks_enforce_cancelled_immutable
  before update on public.production_tasks
  for each row execute function public.enforce_production_tasks_cancelled_immutable();

-- ---------------------------------------------------------------------------
-- 取消をactivity_logsへ記録する（log_post_records_cancellationと同型）。
-- タスク本文(title/notes)等は記録せず、追跡に必要な最小限だけを残す。
-- ---------------------------------------------------------------------------

create or replace function public.log_production_tasks_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.cancelled_at is null and new.cancelled_at is not null then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      new.cancelled_by_staff_id, 'production_task', new.id, 'production_task_cancelled',
      jsonb_build_object('cancelled_at', null),
      jsonb_build_object(
        'cancelled_at', new.cancelled_at,
        'cancelled_by_staff_id', new.cancelled_by_staff_id,
        'cancel_reason', new.cancel_reason,
        'client_id', new.client_id
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists production_tasks_log_cancellation on public.production_tasks;
create trigger production_tasks_log_cancellation
  after update on public.production_tasks
  for each row execute function public.log_production_tasks_cancellation();

-- ---------------------------------------------------------------------------
-- RPC: cancel_production_task
-- 取消可否の判定・actor解決・更新を1トランザクションで行う唯一の入口。
-- 物理DELETEは行わない。
-- 権限はis_active_staff()（パート含む全有効スタッフ）。制作タスクの取消は制作業務側の操作であり、
-- 料金・売上に関わらないため、post_recordsの取消（パートも可）と同じ扱いにする。
-- production_tasksのUPDATEはPhase3で作成済みのproduction_tasks_updateポリシー
-- （for update to authenticated using is_active_staff()）がそのまま適用されるため、
-- 新しいRLSポリシーは追加しない。
-- ---------------------------------------------------------------------------

create or replace function public.cancel_production_task(
  p_task_id uuid,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_task_kind text;
  v_status text;
  v_cancelled_at timestamptz;
begin
  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'ログインが必要です';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception '取消理由を入力してください';
  end if;

  select task_kind, status, cancelled_at
  into v_task_kind, v_status, v_cancelled_at
  from public.production_tasks
  where id = p_task_id
  for update;

  if v_task_kind is null then
    raise exception '対象の制作タスクが見つかりません';
  end if;
  if v_cancelled_at is not null then
    raise exception 'この制作タスクは既に取消済みです';
  end if;
  -- スポットタスク(task_kind='spot')はスケジュールルールからの自動生成対象ではなく、
  -- 再生成の問題も起きないため、今回は取消対象に含めない（仕様を勝手に広げない）。
  if v_task_kind <> 'recurring' then
    raise exception '自動生成（定期）の制作タスクのみ取消できます';
  end if;
  if v_status <> 'production_waiting' then
    raise exception '制作待ちの制作タスクのみ取消できます（素材待ち・制作中・Wチェック以降・完了済みは取消できません）';
  end if;

  update public.production_tasks
    set cancelled_at = now(), cancelled_by_staff_id = v_staff_id, cancel_reason = p_reason
    where id = p_task_id and cancelled_at is null;
end;
$$;

revoke all on function public.cancel_production_task(uuid, text) from public;
revoke execute on function public.cancel_production_task(uuid, text) from anon;
grant execute on function public.cancel_production_task(uuid, text) to authenticated;
