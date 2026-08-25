-- 素材の「1回の提出」を明示的に表すmaterial_submissionsを新設し、
-- materialsをその子（ファイル単位）として扱う親子構造へ移行する。
-- 既存のmaterials列（title/post_usage等）は後方互換のためこのmigrationでは残す
-- （安定稼働確認後、別migrationで整理する）。

create table if not exists public.material_submissions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  title text not null,
  post_usage text,
  requested_post_timing text,
  editing_instructions text,
  caption_instructions text,
  contact_notes text,
  shot_date date,
  received_at timestamptz not null default now(),
  submitted_by_type text not null default 'client' check (submitted_by_type in ('client', 'staff')),
  created_at timestamptz not null default now()
);

create index if not exists material_submissions_client_idx
  on public.material_submissions (client_id, received_at desc);

alter table public.material_submissions enable row level security;

drop policy if exists material_submissions_select on public.material_submissions;
create policy material_submissions_select on public.material_submissions
  for select to authenticated using (public.is_active_staff());

drop policy if exists material_submissions_insert on public.material_submissions;
create policy material_submissions_insert on public.material_submissions
  for insert to authenticated with check (public.is_active_staff());

-- ---------------------------------------------------------------------------
-- materials: 親への参照とファイル名を追加
-- ---------------------------------------------------------------------------

alter table public.materials
  add column if not exists material_submission_id uuid references public.material_submissions (id) on delete cascade;
alter table public.materials
  add column if not exists file_name text;

create index if not exists materials_submission_idx on public.materials (material_submission_id);

-- ---------------------------------------------------------------------------
-- 既存データのバックフィル。
-- client_id + received_at + 全メタ情報列が完全一致（NULL同士も一致とみなす）する
-- 行だけを「同一の1回の提出」とみなす。titleだけでの統合は行わない。
-- 今回追加した複数ファイル同時アップロードは、同一トランザクション内のinsertのため
-- received_at（now()）が完全一致し、正しく1つのsubmissionへまとまる。
-- それ以外の既存の単発登録は、通常この組み合わせが他行と一致しないため
-- 実質的に1materials = 1submissionとして移行される。
-- ---------------------------------------------------------------------------

create temporary table tmp_material_groups on commit drop as
select
  client_id,
  received_at,
  title,
  post_usage,
  requested_post_timing,
  editing_instructions,
  caption_instructions,
  contact_notes,
  shot_date,
  submitted_by_type,
  gen_random_uuid() as submission_id
from public.materials
where material_submission_id is null
group by
  client_id, received_at, title, post_usage, requested_post_timing,
  editing_instructions, caption_instructions, contact_notes, shot_date, submitted_by_type;

insert into public.material_submissions (
  id, client_id, title, post_usage, requested_post_timing,
  editing_instructions, caption_instructions, contact_notes, shot_date,
  received_at, submitted_by_type
)
select
  submission_id, client_id, title, post_usage, requested_post_timing,
  editing_instructions, caption_instructions, contact_notes, shot_date,
  received_at, submitted_by_type
from tmp_material_groups;

update public.materials m
set material_submission_id = g.submission_id
from tmp_material_groups g
where m.material_submission_id is null
  and m.client_id = g.client_id
  and m.received_at = g.received_at
  and m.title = g.title
  and m.post_usage is not distinct from g.post_usage
  and m.requested_post_timing is not distinct from g.requested_post_timing
  and m.editing_instructions is not distinct from g.editing_instructions
  and m.caption_instructions is not distinct from g.caption_instructions
  and m.contact_notes is not distinct from g.contact_notes
  and m.shot_date is not distinct from g.shot_date
  and m.submitted_by_type = g.submitted_by_type;

-- バックフィルは既存の全行を網羅する（whereで対象化した行は必ずいずれかのグループに
-- 属する）ため、この時点でNULLは残らないはずである。安全のため確認してから
-- NOT NULL化する。
do $$
declare
  remaining integer;
begin
  select count(*) into remaining from public.materials where material_submission_id is null;
  if remaining = 0 then
    alter table public.materials alter column material_submission_id set not null;
  else
    raise notice 'material_submission_id が未設定のmaterials行が%件残っているため、NOT NULL化はスキップしました。', remaining;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 新規登録用の内部コア関数（権限チェックは呼び出し元の公開関数で行う）。
-- submission作成とファイル分のmaterials作成を1トランザクションで行う。
-- p_files は [{"file_name": ..., "drive_file_id": ..., "drive_url": ...}, ...] の配列。
-- 空配列の場合はファイル無しの受付として1行だけmaterialsを作成する。
-- ---------------------------------------------------------------------------

create or replace function public._create_material_submission_core(
  p_client_id uuid,
  p_title text,
  p_post_usage text,
  p_requested_post_timing text,
  p_editing_instructions text,
  p_caption_instructions text,
  p_contact_notes text,
  p_shot_date date,
  p_submitted_by_type text,
  p_files jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission_id uuid;
  v_file jsonb;
begin
  insert into public.material_submissions (
    client_id, title, post_usage, requested_post_timing,
    editing_instructions, caption_instructions, contact_notes, shot_date, submitted_by_type
  ) values (
    p_client_id, p_title, p_post_usage, p_requested_post_timing,
    p_editing_instructions, p_caption_instructions, p_contact_notes, p_shot_date, p_submitted_by_type
  )
  returning id into v_submission_id;

  if p_files is null or jsonb_array_length(p_files) = 0 then
    insert into public.materials (
      client_id, material_submission_id, file_name, drive_file_id, drive_url,
      title, post_usage, requested_post_timing, editing_instructions,
      caption_instructions, contact_notes, shot_date, submitted_by_type
    ) values (
      p_client_id, v_submission_id, null, null, null,
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
        p_client_id, v_submission_id,
        v_file->>'file_name', v_file->>'drive_file_id', v_file->>'drive_url',
        p_title, p_post_usage, p_requested_post_timing, p_editing_instructions,
        p_caption_instructions, p_contact_notes, p_shot_date, p_submitted_by_type
      );
    end loop;
  end if;

  return v_submission_id;
end;
$$;

-- 内部専用。直接の実行権限は誰にも付与しない（公開ラッパー経由のみで呼ばれる。
-- SECURITY DEFINER関数からの呼び出しはowner権限で行われるため問題なく動作する）。
revoke all on function public._create_material_submission_core(
  uuid, text, text, text, text, text, text, date, text, jsonb
) from public;

-- スタッフによる手動登録用（認証済みスタッフのみ）。
create or replace function public.create_material_submission(
  p_client_id uuid,
  p_title text,
  p_post_usage text,
  p_requested_post_timing text,
  p_editing_instructions text,
  p_caption_instructions text,
  p_contact_notes text,
  p_shot_date date,
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
    p_client_id, p_title, p_post_usage, p_requested_post_timing,
    p_editing_instructions, p_caption_instructions, p_contact_notes, p_shot_date,
    'staff', p_files
  );
end;
$$;

revoke all on function public.create_material_submission(
  uuid, text, text, text, text, text, text, date, jsonb
) from public;
grant execute on function public.create_material_submission(
  uuid, text, text, text, text, text, text, date, jsonb
) to authenticated;
revoke execute on function public.create_material_submission(
  uuid, text, text, text, text, text, text, date, jsonb
) from anon;

-- 顧客向け公開フォーム用（service_role専用。呼び出し元でtoken検証済みであることが前提）。
create or replace function public.create_client_material_submission(
  p_client_id uuid,
  p_title text,
  p_post_usage text,
  p_requested_post_timing text,
  p_editing_instructions text,
  p_caption_instructions text,
  p_contact_notes text,
  p_shot_date date,
  p_files jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._create_material_submission_core(
    p_client_id, p_title, p_post_usage, p_requested_post_timing,
    p_editing_instructions, p_caption_instructions, p_contact_notes, p_shot_date,
    'client', p_files
  );
end;
$$;

revoke all on function public.create_client_material_submission(
  uuid, text, text, text, text, text, text, date, jsonb
) from public;
grant execute on function public.create_client_material_submission(
  uuid, text, text, text, text, text, text, date, jsonb
) to service_role;
