-- material_submission単位でGoogle Driveのフォルダを分けられるようにする。
-- submission IDはアプリ側(crypto.randomUUID())で事前確定し、Driveフォルダ名の一意化と
-- material_submissions.idの両方に同じ値を使う（title文字列だけに依存した検索・統合は行わない）。

alter table public.material_submissions
  add column if not exists drive_folder_id text;
alter table public.material_submissions
  add column if not exists drive_folder_url text;

-- ---------------------------------------------------------------------------
-- RPCのシグネチャ変更（p_id / p_drive_folder_id / p_drive_folder_url を追加）。
-- PostgreSQLは引数の型リストが変わると別関数扱いになるため、旧シグネチャを
-- 明示的にDROPしてから新シグネチャで作り直す。
-- ---------------------------------------------------------------------------

drop function if exists public._create_material_submission_core(
  uuid, text, text, text, text, text, text, date, text, jsonb
);
drop function if exists public.create_material_submission(
  uuid, text, text, text, text, text, text, date, jsonb
);
drop function if exists public.create_client_material_submission(
  uuid, text, text, text, text, text, text, date, jsonb
);

create or replace function public._create_material_submission_core(
  p_id uuid,
  p_client_id uuid,
  p_title text,
  p_post_usage text,
  p_requested_post_timing text,
  p_editing_instructions text,
  p_caption_instructions text,
  p_contact_notes text,
  p_shot_date date,
  p_submitted_by_type text,
  p_drive_folder_id text,
  p_drive_folder_url text,
  p_files jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file jsonb;
begin
  insert into public.material_submissions (
    id, client_id, title, post_usage, requested_post_timing,
    editing_instructions, caption_instructions, contact_notes, shot_date, submitted_by_type,
    drive_folder_id, drive_folder_url
  ) values (
    p_id, p_client_id, p_title, p_post_usage, p_requested_post_timing,
    p_editing_instructions, p_caption_instructions, p_contact_notes, p_shot_date, p_submitted_by_type,
    p_drive_folder_id, p_drive_folder_url
  );

  if p_files is null or jsonb_array_length(p_files) = 0 then
    insert into public.materials (
      client_id, material_submission_id, file_name, drive_file_id, drive_url,
      title, post_usage, requested_post_timing, editing_instructions,
      caption_instructions, contact_notes, shot_date, submitted_by_type
    ) values (
      p_client_id, p_id, null, null, null,
      p_title, p_post_usage, p_requested_post_timing, p_editing_instructions,
      p_caption_instructions, p_contact_notes, p_shot_date, p_submitted_by_type
    );
  else
    for v_file in select * from jsonb_array_elements(p_files)
    loop
      insert into public.materials (
        client_id, material_submission_id, file_name, drive_file_id, drive_url,
        title, post_usage, requested_post_timing, editing_instructions,
        caption_instructions, contact_notes, shot_date, submitted_by_type
      ) values (
        p_client_id, p_id,
        v_file->>'file_name', v_file->>'drive_file_id', v_file->>'drive_url',
        p_title, p_post_usage, p_requested_post_timing, p_editing_instructions,
        p_caption_instructions, p_contact_notes, p_shot_date, p_submitted_by_type
      );
    end loop;
  end if;

  return p_id;
end;
$$;

-- 内部専用。直接の実行権限は誰にも付与しない。
revoke all on function public._create_material_submission_core(
  uuid, uuid, text, text, text, text, text, text, date, text, text, text, jsonb
) from public;

-- スタッフによる手動登録用（認証済みスタッフのみ）。
create or replace function public.create_material_submission(
  p_id uuid,
  p_client_id uuid,
  p_title text,
  p_post_usage text,
  p_requested_post_timing text,
  p_editing_instructions text,
  p_caption_instructions text,
  p_contact_notes text,
  p_shot_date date,
  p_drive_folder_id text,
  p_drive_folder_url text,
  p_files jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() then
    raise exception 'permission denied for table materials';
  end if;

  return public._create_material_submission_core(
    p_id, p_client_id, p_title, p_post_usage, p_requested_post_timing,
    p_editing_instructions, p_caption_instructions, p_contact_notes, p_shot_date,
    'staff', p_drive_folder_id, p_drive_folder_url, p_files
  );
end;
$$;

revoke all on function public.create_material_submission(
  uuid, uuid, text, text, text, text, text, text, date, text, text, jsonb
) from public;
grant execute on function public.create_material_submission(
  uuid, uuid, text, text, text, text, text, text, date, text, text, jsonb
) to authenticated;
revoke execute on function public.create_material_submission(
  uuid, uuid, text, text, text, text, text, text, date, text, text, jsonb
) from anon;

-- 顧客向け公開フォーム用（service_role専用。呼び出し元でtoken検証済みであることが前提）。
create or replace function public.create_client_material_submission(
  p_id uuid,
  p_client_id uuid,
  p_title text,
  p_post_usage text,
  p_requested_post_timing text,
  p_editing_instructions text,
  p_caption_instructions text,
  p_contact_notes text,
  p_shot_date date,
  p_drive_folder_id text,
  p_drive_folder_url text,
  p_files jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._create_material_submission_core(
    p_id, p_client_id, p_title, p_post_usage, p_requested_post_timing,
    p_editing_instructions, p_caption_instructions, p_contact_notes, p_shot_date,
    'client', p_drive_folder_id, p_drive_folder_url, p_files
  );
end;
$$;

-- Supabaseは新規関数作成時にanon/authenticatedへデフォルト権限を自動付与するため、
-- service_role専用の意図を守るため明示的に取り消す（前回のgrant修正と同じ対応）。
revoke all on function public.create_client_material_submission(
  uuid, uuid, text, text, text, text, text, text, date, text, text, jsonb
) from public;
revoke execute on function public.create_client_material_submission(
  uuid, uuid, text, text, text, text, text, text, date, text, text, jsonb
) from anon;
revoke execute on function public.create_client_material_submission(
  uuid, uuid, text, text, text, text, text, text, date, text, text, jsonb
) from authenticated;
grant execute on function public.create_client_material_submission(
  uuid, uuid, text, text, text, text, text, text, date, text, text, jsonb
) to service_role;
