-- Phase 8 追加: 投稿実績の取消（履歴を壊さない訂正方式）
-- 元のpost_recordsは削除・上書きせず、取消メタデータのみ追記する。
-- 実績内容そのもの(投稿日・URL等)は一切変更できないようDBトリガーで保護する。

alter table public.post_records
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_staff_id uuid references public.staff (id),
  add column if not exists cancel_reason text;

alter table public.post_records
  add constraint post_records_cancel_reason_required
  check (cancelled_at is null or cancel_reason is not null);

create or replace function public.enforce_post_records_cancel_only_update()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
     or new.production_task_id is distinct from old.production_task_id
     or new.client_id is distinct from old.client_id
     or new.post_type is distinct from old.post_type
     or new.posted_at is distinct from old.posted_at
     or new.posted_by_staff_id is distinct from old.posted_by_staff_id
     or new.title is distinct from old.title
     or new.social_post_url is distinct from old.social_post_url
     or new.canva_url is distinct from old.canva_url
     or new.final_drive_file_id is distinct from old.final_drive_file_id
     or new.final_drive_url is distinct from old.final_drive_url
     or new.source_material_id is distinct from old.source_material_id
     or new.created_at is distinct from old.created_at then
    raise exception 'post_recordsの実績内容は変更できません（取消関連項目のみ更新可能です）';
  end if;

  if old.cancelled_at is not null then
    raise exception '取消済みのpost_recordsは変更できません';
  end if;

  return new;
end;
$$;

drop trigger if exists post_records_enforce_cancel_only_update on public.post_records;
create trigger post_records_enforce_cancel_only_update
  before update on public.post_records
  for each row execute function public.enforce_post_records_cancel_only_update();

-- 取消はactivity_logsにも記録する
create or replace function public.log_post_records_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.cancelled_at is null and new.cancelled_at is not null then
    insert into public.activity_logs (actor_staff_id, entity_type, entity_id, action, before_data, after_data)
    values (
      new.cancelled_by_staff_id, 'post_record', new.id, 'post_record_cancelled',
      jsonb_build_object('cancelled_at', null),
      jsonb_build_object(
        'cancelled_at', new.cancelled_at,
        'cancelled_by_staff_id', new.cancelled_by_staff_id,
        'cancel_reason', new.cancel_reason
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists post_records_log_cancellation on public.post_records;
create trigger post_records_log_cancellation
  after update on public.post_records
  for each row execute function public.log_post_records_cancellation();

-- パートも含め、全スタッフが取消操作を行えるようにする（update不可の既存方針から、
-- 取消専用に限定して更新を許可する。実績内容の変更はトリガーで防止済み）
drop policy if exists post_records_update_cancel_only on public.post_records;
create policy post_records_update_cancel_only on public.post_records
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

-- ---------------------------------------------------------------------------
-- post_records作成(既存) + 取消 をそれぞれ単一トランザクションで行う関数
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
    update public.production_tasks
      set status = 'posting_waiting', completed_at = null
      where id = v_task_id and status = 'completed';
  end if;
end;
$$;

grant execute on function public.cancel_post_record(uuid, uuid, text) to authenticated;
