-- Phase 8: 投稿実績登録
-- docs/database.md, docs/workflows.md 準拠

-- source_material_id の参照整合性を明示する（Phase3時点では未設定だった）
alter table public.post_records
  add constraint post_records_source_material_id_fkey
  foreign key (source_material_id) references public.materials (id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- post_records作成 + production_tasks完了を1トランザクションで行う関数。
-- Google Drive格納（アプリ側でこの関数を呼ぶ前に実行）が失敗した場合は
-- この関数自体を呼ばないことで、post_records・completedのどちらも確定しない。
-- 関数内の2つの書き込みはPostgres関数として単一トランザクションで実行されるため、
-- 片方だけが反映される状態にはならない。
-- ---------------------------------------------------------------------------

create or replace function public.create_post_record_and_complete_task(
  p_production_task_id uuid,
  p_client_id uuid,
  p_post_type text,
  p_posted_at timestamptz,
  p_posted_by_staff_id uuid,
  p_title text,
  p_social_post_url text,
  p_canva_url text,
  p_final_drive_file_id text,
  p_final_drive_url text,
  p_source_material_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.post_records (
    production_task_id, client_id, post_type, posted_at, posted_by_staff_id,
    title, social_post_url, canva_url, final_drive_file_id, final_drive_url, source_material_id
  ) values (
    p_production_task_id, p_client_id, p_post_type, p_posted_at, p_posted_by_staff_id,
    p_title, p_social_post_url, p_canva_url, p_final_drive_file_id, p_final_drive_url, p_source_material_id
  ) returning id into v_id;

  update public.production_tasks
    set status = 'completed', completed_at = now()
    where id = p_production_task_id;

  return v_id;
end;
$$;

grant execute on function public.create_post_record_and_complete_task(
  uuid, uuid, text, timestamptz, uuid, text, text, text, text, text, uuid
) to authenticated;
