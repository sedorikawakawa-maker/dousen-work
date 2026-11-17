-- 制作タスク個別取消の対象を「全status・recurring/spot両方」へ拡大する。
-- 20261026000001_production_task_cancellation.sql（本番適用済み）の後続migration。
--
-- 方針（20261026000001から変更しない点）:
--   ・取消は cancelled_at + cancelled_by_staff_id + cancel_reason の追記方式のまま。
--     status='cancelled' は追加しない。物理DELETEはしない。
--   ・取消済み行のimmutableトリガー（production_tasks_enforce_cancelled_immutable）と
--     取消ログトリガー（production_tasks_log_cancellation）はそのまま使う。
--   ・w_checks / client_confirmations / post_records / outsourcing_requests 等の関連履歴は
--     一切変更・削除しない（取消済みタスクの履歴として残す）。
--   ・recurringの取消済み行は引き続き部分UNIQUE index(production_tasks_unique_recurring)と
--     generateTasksForRuleの存在チェックの両方で「既存タスク」として扱われ、再生成されない。
--
-- 変更点:
--   1. cancel_production_task: task_kind='recurring' / status='production_waiting' の制限を外す。
--      残る条件は「有効staff（current_staff_id()）」「理由必須」「対象が存在」「未取消」のみ。
--   2. cancel_post_record: 取消済みタスクに紐づく投稿実績を取り消す場合、production_tasksの
--      status巻き戻し（completed -> posting_waiting）を行わない。
--      完了済みタスクを取消せるようになったため、従来のままだと取消済みタスクのUPDATEが
--      immutableトリガーで例外になり、投稿実績の取消そのものが失敗してしまうため。
--      取消済みでないタスクに対する挙動は従来と完全に同じ。

-- ---------------------------------------------------------------------------
-- 1. cancel_production_task（全status・recurring/spot両方を取消可能にする）
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
  v_found boolean;
  v_cancelled_at timestamptz;
begin
  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'ログインが必要です';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception '取消理由を入力してください';
  end if;

  select true, cancelled_at
  into v_found, v_cancelled_at
  from public.production_tasks
  where id = p_task_id
  for update;

  if v_found is null then
    raise exception '対象の制作タスクが見つかりません';
  end if;
  if v_cancelled_at is not null then
    raise exception 'この制作タスクは既に取消済みです';
  end if;

  -- statusは変更しない（取消時点の状態を履歴として残す）。
  update public.production_tasks
    set cancelled_at = now(), cancelled_by_staff_id = v_staff_id, cancel_reason = p_reason
    where id = p_task_id and cancelled_at is null;
end;
$$;

-- create or replace は既存の権限を保持するが、意図を明示するため再度宣言する。
revoke all on function public.cancel_production_task(uuid, text) from public;
revoke execute on function public.cancel_production_task(uuid, text) from anon;
grant execute on function public.cancel_production_task(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. cancel_post_record（取消済みタスクのstatusは巻き戻さない）
-- ---------------------------------------------------------------------------

create or replace function public.cancel_post_record(
  p_post_record_id uuid,
  p_staff_id uuid,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_task_id uuid;
  v_other_valid_count int;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception '取消理由を入力してください';
  end if;

  update public.post_records
    set cancelled_at = now(), cancelled_by_staff_id = p_staff_id, cancel_reason = p_reason
    where id = p_post_record_id and cancelled_at is null
    returning production_task_id into v_task_id;

  if v_task_id is null then
    return;
  end if;

  select count(*) into v_other_valid_count
    from public.post_records
    where production_task_id = v_task_id and cancelled_at is null;

  if v_other_valid_count = 0 then
    -- 取消済みタスク(cancelled_at is not null)は変更不可のため対象外にする。
    -- 取消済みタスクは取消時点のstatus(completed)のまま履歴として残る。
    update public.production_tasks
      set status = 'posting_waiting', completed_at = null
      where id = v_task_id and status = 'completed' and cancelled_at is null;
  end if;
end;
$$;
