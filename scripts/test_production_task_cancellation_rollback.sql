-- =============================================================================
-- test_production_task_cancellation_rollback.sql
--
-- 用途: production_tasks 個別取消機能の機能テスト（BEGIN 〜 ROLLBACK のみ）。
--       以下 2 本の migration 適用後に実行する。
--         ・20261026000001_production_task_cancellation.sql
--         ・20261118000001_production_task_cancellation_all_statuses.sql
--       （全status・recurring/spot 両方を取消可能にした仕様が対象）
--
-- 安全性:
--   ・全処理を 1 トランザクション内で行い、最後に必ず ROLLBACK する（COMMIT は書かない）。
--   ・テスト用の auth.users / staff / clients / posting_schedule_rules / production_tasks /
--     w_checks / client_confirmations / post_records をトランザクション内で作成し、
--     ROLLBACK で全て消える。既存行は一切 UPDATE / DELETE しない。
--   ・clients.client_code は明示指定し、client_code_seq（ROLLBACK で戻らない sequence）を消費しない。
--   ・途中で想定外のエラーが起きた場合もトランザクションは abort 状態になり何も確定しない。
--     その場合は ROLLBACK; を単独で実行してから原因を確認すること。
--
-- 結果の確認:
--   最後の 2 つの SELECT（明細 / サマリ）で確認する。ok=false の行が 1 つでもあれば不合格。
--   ※ Supabase SQL Editor は最後の文の結果しか表示しないことがあるため、
--     明細・サマリが表示されない場合は psql（-v ON_ERROR_STOP=1 -f）で実行する。
--
-- ロール切替:
--   PostgREST と同じく set_config('role', ...) と request.jwt.claims を
--   トランザクションローカルで設定し、authenticated / anon として RPC・UPDATE を実行する。
--   例外時はサブトランザクションのロールバックでロール設定も元に戻る。
-- =============================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 作業用 temp テーブル / ヘルパー関数（ON COMMIT DROP。ROLLBACK でも消える）
-- -----------------------------------------------------------------------------

create temp table _t_ctx (k text primary key, id uuid not null) on commit drop;

create temp table _t_results (
  seq serial primary key,
  section text not null,
  check_name text not null,
  expected text,
  actual text,
  ok boolean
) on commit drop;

-- 全status（20261118000001 で取消可能になった対象）
create temp table _t_statuses (status text primary key, ord int not null) on commit drop;
insert into _t_statuses (status, ord) values
  ('material_waiting', 1),
  ('production_waiting', 2),
  ('in_production', 3),
  ('wcheck_waiting', 4),
  ('client_confirmation_waiting', 5),
  ('posting_waiting', 6),
  ('completed', 7);

create function pg_temp.t_id(p_key text) returns uuid
language sql stable as $$ select id from _t_ctx where k = p_key $$;

create function pg_temp.t_record(p_section text, p_name text, p_expected text, p_actual text, p_ok boolean)
returns void language sql as $$
  insert into _t_results (section, check_name, expected, actual, ok)
  values (p_section, p_name, p_expected, p_actual, coalesce(p_ok, false));
$$;

-- p_role: 'postgres'（切替なし） / 'authenticated' / 'anon'
create function pg_temp.t_login(p_role text, p_auth_uid uuid) returns void
language plpgsql as $$
begin
  if p_role = 'postgres' then
    return;
  end if;
  perform set_config('request.jwt.claim.sub', coalesce(p_auth_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    case when p_auth_uid is null then json_build_object('role', p_role)::text
         else json_build_object('sub', p_auth_uid, 'role', p_role)::text end,
    true);
  perform set_config('role', p_role, true);
end;
$$;

-- cancel_production_task を指定ロールで呼ぶ。成功時 'OK'、失敗時 'SQLSTATE: message'
create function pg_temp.t_try_cancel(p_role text, p_auth_uid uuid, p_task uuid, p_reason text) returns text
language plpgsql as $$
begin
  begin
    perform pg_temp.t_login(p_role, p_auth_uid);
    perform public.cancel_production_task(p_task, p_reason);
    -- ロールを元に戻す（authenticated のまま pg_temp 関数を呼ばないようインラインで実行）
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    return 'OK';
  exception when others then
    return sqlstate || ': ' || sqlerrm;
  end;
end;
$$;

-- 任意SQL(DML)を指定ロールで実行する。成功時 'OK (rows=n)'、失敗時 'SQLSTATE: message'
create function pg_temp.t_try_sql(p_role text, p_auth_uid uuid, p_sql text) returns text
language plpgsql as $$
declare
  v_rows bigint;
begin
  begin
    perform pg_temp.t_login(p_role, p_auth_uid);
    execute p_sql;
    get diagnostics v_rows = row_count;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    return 'OK (rows=' || v_rows::text || ')';
  exception when others then
    return sqlstate || ': ' || sqlerrm;
  end;
end;
$$;

-- 件数を返すSELECTを指定ロールで実行する。成功時 件数文字列、失敗時 'SQLSTATE: message'
create function pg_temp.t_try_count(p_role text, p_auth_uid uuid, p_sql text) returns text
language plpgsql as $$
declare
  v_count bigint;
begin
  begin
    perform pg_temp.t_login(p_role, p_auth_uid);
    execute p_sql into v_count;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    return v_count::text;
  exception when others then
    return sqlstate || ': ' || sqlerrm;
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- 前提: migration 適用済みか（未適用ならここで止める）
-- -----------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.cancel_production_task(uuid, text)') is null then
    raise exception '前提エラー: cancel_production_task がありません（migration 未適用）';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'production_tasks' and column_name = 'cancelled_at'
  ) then
    raise exception '前提エラー: production_tasks.cancelled_at がありません（migration 未適用）';
  end if;
  -- 20261118000001 適用済みか（旧RPCは recurring / production_waiting の制限を持つ）
  if exists (
    select 1 from pg_proc
    where oid = to_regprocedure('public.cancel_production_task(uuid, text)')
      and (prosrc ilike '%''production_waiting''%' or prosrc ilike '%''recurring''%')
  ) then
    raise exception '前提エラー: cancel_production_task が旧仕様のままです（20261118000001 未適用）';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Fixture 作成（postgres として。全て ROLLBACK で消える）
-- -----------------------------------------------------------------------------

do $$
declare
  v_marker text := 'ZZTEST-PTC-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_auth_active uuid := gen_random_uuid();
  v_auth_part uuid := gen_random_uuid();
  v_auth_inactive uuid := gen_random_uuid();
  v_auth_nostaff uuid := gen_random_uuid();
  v_staff_active uuid;
  v_staff_part uuid;
  v_staff_inactive uuid;
  v_client uuid;
  v_rule uuid;
  v_task uuid;
  v_id uuid;
  r record;
begin
  -- auth.users（staff.auth_user_id の FK 先）
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (v_auth_active,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', lower(v_marker) || '-active@example.invalid',   now(), now()),
    (v_auth_part,     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', lower(v_marker) || '-part@example.invalid',     now(), now()),
    (v_auth_inactive, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', lower(v_marker) || '-inactive@example.invalid', now(), now()),
    (v_auth_nostaff,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', lower(v_marker) || '-nostaff@example.invalid',  now(), now());

  insert into public.staff (auth_user_id, last_name, first_name, role, is_active)
  values (v_auth_active, v_marker, 'active', 'employee', true) returning id into v_staff_active;
  insert into public.staff (auth_user_id, last_name, first_name, role, is_active)
  values (v_auth_part, v_marker, 'part', 'part_time', true) returning id into v_staff_part;
  insert into public.staff (auth_user_id, last_name, first_name, role, is_active)
  values (v_auth_inactive, v_marker, 'inactive', 'employee', false) returning id into v_staff_inactive;

  insert into public.clients (client_code, company_name)
  values (v_marker, v_marker || ' cancellation test client')
  returning id into v_client;

  insert into public.posting_schedule_rules (client_id, post_type, monthly_target, valid_from, is_active)
  values (v_client, 'reel', 20, date '2099-01-01', true)
  returning id into v_rule;

  insert into _t_ctx (k, id) values
    ('auth_active', v_auth_active), ('auth_part', v_auth_part),
    ('auth_inactive', v_auth_inactive), ('auth_nostaff', v_auth_nostaff),
    ('staff_active', v_staff_active), ('staff_part', v_staff_part), ('staff_inactive', v_staff_inactive),
    ('client', v_client), ('rule', v_rule);

  -- 制作タスク
  --   t_*         : 個別シナリオ用（recurring / production_waiting 等）
  --   r_<status>  : 全status取消テスト用 recurring
  --   s_<status>  : 全status取消テスト用 spot（ルールなし）
  for r in
    select k, task_kind, status, day_offset from (values
      ('t_ok_active',   'recurring', 'production_waiting', 1),
      ('t_ok_part',     'recurring', 'production_waiting', 2),
      ('t_inactive',    'recurring', 'production_waiting', 3),
      ('t_nostaff',     'recurring', 'production_waiting', 4),
      ('t_anon',        'recurring', 'production_waiting', 5),
      ('t_reason',      'recurring', 'production_waiting', 6),
      ('t_normal',      'recurring', 'production_waiting', 7),
      ('t_normal2',     'recurring', 'material_waiting',   8),
      ('t_done_normal', 'recurring', 'completed',          9)
    ) as v(k, task_kind, status, day_offset)
    union all
    select 'r_' || status, 'recurring', status, 20 + ord from _t_statuses
    union all
    select 's_' || status, 'spot', status, 40 + ord from _t_statuses
  loop
    insert into public.production_tasks (
      client_id, schedule_rule_id, post_type, task_kind, source_month,
      scheduled_post_date, original_scheduled_post_date, status,
      assignee_staff_id, title, notes, completed_at
    ) values (
      v_client,
      case when r.task_kind = 'recurring' then v_rule else null end,
      'reel', r.task_kind, date '2099-01-01',
      date '2099-01-01' + r.day_offset, date '2099-01-01' + r.day_offset, r.status,
      v_staff_active,
      'ZZTEST-PTC-TITLE ' || v_marker || ' ' || r.k,
      'ZZTEST-PTC-NOTES ' || v_marker || ' ' || r.k,
      case when r.status = 'completed' then now() else null end
    ) returning id into v_task;
    insert into _t_ctx (k, id) values (r.k, v_task);
  end loop;

  -- 関連履歴（取消後も削除・変更されないことを確認する対象）
  insert into public.w_checks (production_task_id, requested_by_staff_id, asset_type, asset_url, status)
  values (pg_temp.t_id('r_wcheck_waiting'), v_staff_active, 'canva', 'https://example.invalid/zztest-wcheck-waiting', 'waiting')
  returning id into v_id;
  insert into _t_ctx (k, id) values ('h_wcheck_waiting', v_id);

  insert into public.w_checks (production_task_id, requested_by_staff_id, asset_type, asset_url, status, reviewed_at)
  values (pg_temp.t_id('r_completed'), v_staff_active, 'canva', 'https://example.invalid/zztest-wcheck-approved', 'approved', now())
  returning id into v_id;
  insert into _t_ctx (k, id) values ('h_wcheck_approved', v_id);

  insert into public.client_confirmations (production_task_id, requested_by_staff_id, status)
  values (pg_temp.t_id('r_client_confirmation_waiting'), v_staff_active, 'waiting')
  returning id into v_id;
  insert into _t_ctx (k, id) values ('h_confirmation_waiting', v_id);

  insert into public.client_confirmations (production_task_id, requested_by_staff_id, status, responded_at)
  values (pg_temp.t_id('r_completed'), v_staff_active, 'approved', now())
  returning id into v_id;
  insert into _t_ctx (k, id) values ('h_confirmation_approved', v_id);

  insert into public.post_records (production_task_id, client_id, post_type, posted_by_staff_id, title)
  values (pg_temp.t_id('r_completed'), v_client, 'reel', v_staff_active, 'ZZTEST-PTC-POST r_completed')
  returning id into v_id;
  insert into _t_ctx (k, id) values ('h_post_r_completed', v_id);

  insert into public.post_records (production_task_id, client_id, post_type, posted_by_staff_id, title)
  values (pg_temp.t_id('s_completed'), v_client, 'reel', v_staff_active, 'ZZTEST-PTC-POST s_completed')
  returning id into v_id;
  insert into _t_ctx (k, id) values ('h_post_s_completed', v_id);

  insert into public.post_records (production_task_id, client_id, post_type, posted_by_staff_id, title)
  values (pg_temp.t_id('t_done_normal'), v_client, 'reel', v_staff_active, 'ZZTEST-PTC-POST t_done_normal')
  returning id into v_id;
  insert into _t_ctx (k, id) values ('h_post_done_normal', v_id);
end;
$$;

-- =============================================================================
-- A 正常取消（詳細確認: recurring / production_waiting）
-- =============================================================================

do $$
declare
  v_res text;
  t record;
begin
  v_res := pg_temp.t_try_cancel('authenticated', pg_temp.t_id('auth_active'), pg_temp.t_id('t_ok_active'), 'テスト取消理由A');
  perform pg_temp.t_record('A', 'active staff が recurring/production_waiting を取消', 'OK', v_res, v_res = 'OK');

  select * into t from public.production_tasks where id = pg_temp.t_id('t_ok_active');
  perform pg_temp.t_record('A', 'cancelled_at が設定される', 'not null', coalesce(t.cancelled_at::text, 'NULL'), t.cancelled_at is not null);
  perform pg_temp.t_record('A', 'cancelled_by_staff_id = 実行staff', pg_temp.t_id('staff_active')::text,
    coalesce(t.cancelled_by_staff_id::text, 'NULL'), t.cancelled_by_staff_id = pg_temp.t_id('staff_active'));
  perform pg_temp.t_record('A', 'cancel_reason が保存される', 'テスト取消理由A', coalesce(t.cancel_reason, 'NULL'), t.cancel_reason = 'テスト取消理由A');
  perform pg_temp.t_record('A', 'status は production_waiting のまま', 'production_waiting', t.status, t.status = 'production_waiting');
  perform pg_temp.t_record('A', 'task_kind / 担当は変わらない', 'recurring / staff_active',
    t.task_kind || ' / ' || coalesce(t.assignee_staff_id::text, 'NULL'),
    t.task_kind = 'recurring' and t.assignee_staff_id = pg_temp.t_id('staff_active'));
  perform pg_temp.t_record('A', '行は物理削除されず残る', '1',
    (select count(*)::text from public.production_tasks where id = pg_temp.t_id('t_ok_active')),
    (select count(*) from public.production_tasks where id = pg_temp.t_id('t_ok_active')) = 1);
end;
$$;

-- =============================================================================
-- S 全status × recurring / spot の取消（全て成功し、status は取消時点のまま）
-- =============================================================================

do $$
declare
  v_auth uuid := pg_temp.t_id('auth_active');
  v_res text;
  v_key text;
  v_kind text;
  s record;
  t record;
begin
  for s in select status from _t_statuses order by ord loop
    foreach v_key in array array['r_' || s.status, 's_' || s.status] loop
      v_kind := case when v_key like 'r\_%' then 'recurring' else 'spot' end;

      v_res := pg_temp.t_try_cancel('authenticated', v_auth, pg_temp.t_id(v_key), '全status取消テスト ' || v_key);
      perform pg_temp.t_record('S', v_key || ' を取消できる', 'OK', v_res, v_res = 'OK');

      select * into t from public.production_tasks where id = pg_temp.t_id(v_key);
      perform pg_temp.t_record('S', v_key || ': 取消済み・status/task_kind 不変・理由/実行者保存',
        s.status || ' / ' || v_kind || ' / cancelled',
        t.status || ' / ' || t.task_kind || ' / ' || coalesce(t.cancelled_at::text, 'NULL'),
        t.cancelled_at is not null
          and t.status = s.status
          and t.task_kind = v_kind
          and t.cancelled_by_staff_id = pg_temp.t_id('staff_active')
          and t.cancel_reason = '全status取消テスト ' || v_key);
    end loop;
  end loop;

  perform pg_temp.t_record('S', '全status × recurring/spot の 14 件が取消済み', '14',
    (select count(*)::text from public.production_tasks pt join _t_ctx c on c.id = pt.id
      where (c.k like 'r\_%' or c.k like 's\_%') and pt.cancelled_at is not null),
    (select count(*) from public.production_tasks pt join _t_ctx c on c.id = pt.id
      where (c.k like 'r\_%' or c.k like 's\_%') and pt.cancelled_at is not null) = 14);
end;
$$;

-- =============================================================================
-- B ガード（二重取消・理由必須・存在しない・CHECK制約）
-- =============================================================================

do $$
declare
  v_auth uuid := pg_temp.t_id('auth_active');
  v_res text;
  v_key text;
begin
  -- 二重取消（recurring / spot・各status）
  foreach v_key in array array['t_ok_active', 'r_material_waiting', 'r_completed', 's_production_waiting', 's_completed'] loop
    v_res := pg_temp.t_try_cancel('authenticated', v_auth, pg_temp.t_id(v_key), '二重取消');
    perform pg_temp.t_record('B', v_key || ': 二重取消を拒否', 'error: 既に取消済み', v_res,
      v_res <> 'OK' and v_res like '%既に取消済み%');
  end loop;

  perform pg_temp.t_record('B', '二重取消で取消理由は上書きされない', 'テスト取消理由A',
    (select cancel_reason from public.production_tasks where id = pg_temp.t_id('t_ok_active')),
    (select cancel_reason from public.production_tasks where id = pg_temp.t_id('t_ok_active')) = 'テスト取消理由A');

  -- 空理由
  v_res := pg_temp.t_try_cancel('authenticated', v_auth, pg_temp.t_id('t_reason'), '');
  perform pg_temp.t_record('B', '空文字の理由を拒否', 'error: 取消理由を入力', v_res, v_res <> 'OK' and v_res like '%取消理由を入力%');
  v_res := pg_temp.t_try_cancel('authenticated', v_auth, pg_temp.t_id('t_reason'), '   ');
  perform pg_temp.t_record('B', '空白のみの理由を拒否', 'error: 取消理由を入力', v_res, v_res <> 'OK' and v_res like '%取消理由を入力%');
  v_res := pg_temp.t_try_cancel('authenticated', v_auth, pg_temp.t_id('t_reason'), null);
  perform pg_temp.t_record('B', 'NULL の理由を拒否', 'error: 取消理由を入力', v_res, v_res <> 'OK' and v_res like '%取消理由を入力%');

  -- 存在しないタスク
  v_res := pg_temp.t_try_cancel('authenticated', v_auth, gen_random_uuid(), '存在しない');
  perform pg_temp.t_record('B', '存在しないタスクを拒否', 'error: 見つかりません', v_res, v_res <> 'OK' and v_res like '%見つかりません%');

  -- CHECK 制約（理由なしの直接UPDATE。postgres として RPC を経由しない経路）
  v_res := pg_temp.t_try_sql('postgres', null, format(
    'update public.production_tasks set cancelled_at = now(), cancelled_by_staff_id = %L, cancel_reason = null where id = %L',
    pg_temp.t_id('staff_active'), pg_temp.t_id('t_reason')));
  perform pg_temp.t_record('B', 'CHECK: 理由なし取消を DB が拒否', 'error 23514', v_res, v_res like '23514:%');

  perform pg_temp.t_record('B', '理由エラーのタスクは未取消のまま', 'NULL',
    coalesce((select cancelled_at::text from public.production_tasks where id = pg_temp.t_id('t_reason')), 'NULL'),
    (select cancelled_at from public.production_tasks where id = pg_temp.t_id('t_reason')) is null);
end;
$$;

-- =============================================================================
-- C immutable（取消済み行は status に関係なく一切変更できない）
-- =============================================================================

do $$
declare
  v_auth uuid := pg_temp.t_id('auth_active');
  v_task uuid := pg_temp.t_id('t_ok_active');
  v_res text;
  t record;
begin
  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'update public.production_tasks set status = ''in_production'' where id = %L', v_task));
  perform pg_temp.t_record('C', '取消済み: status 変更を拒否', 'error: 取消済みの制作タスクは変更できません', v_res,
    v_res like '%取消済みの制作タスクは変更できません%');

  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'update public.production_tasks set assignee_staff_id = %L where id = %L', pg_temp.t_id('staff_part'), v_task));
  perform pg_temp.t_record('C', '取消済み: 担当変更を拒否', 'error: 取消済みの制作タスクは変更できません', v_res,
    v_res like '%取消済みの制作タスクは変更できません%');

  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'update public.production_tasks set cancelled_at = null, cancelled_by_staff_id = null, cancel_reason = null where id = %L', v_task));
  perform pg_temp.t_record('C', '取消済み: cancelled_at 巻き戻しを拒否', 'error: 取消済みの制作タスクは変更できません', v_res,
    v_res like '%取消済みの制作タスクは変更できません%');

  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'update public.production_tasks set cancel_reason = ''書き換え'' where id = %L', v_task));
  perform pg_temp.t_record('C', '取消済み: cancel_reason 変更を拒否', 'error: 取消済みの制作タスクは変更できません', v_res,
    v_res like '%取消済みの制作タスクは変更できません%');

  -- 取消済みの完了タスク（recurring）・投稿待ちタスク（spot）も同様に変更不可
  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'update public.production_tasks set status = ''posting_waiting'', completed_at = null where id = %L', pg_temp.t_id('r_completed')));
  perform pg_temp.t_record('C', '取消済み完了タスク(recurring): status 巻き戻しを拒否', 'error: 取消済みの制作タスクは変更できません', v_res,
    v_res like '%取消済みの制作タスクは変更できません%');

  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'update public.production_tasks set status = ''completed'' where id = %L', pg_temp.t_id('s_posting_waiting')));
  perform pg_temp.t_record('C', '取消済み投稿待ちタスク(spot): status 変更を拒否', 'error: 取消済みの制作タスクは変更できません', v_res,
    v_res like '%取消済みの制作タスクは変更できません%');

  -- RLS をバイパスする postgres でも trigger により拒否される
  v_res := pg_temp.t_try_sql('postgres', null, format(
    'update public.production_tasks set status = ''completed'' where id = %L', v_task));
  perform pg_temp.t_record('C', '取消済み: postgres(owner) でも status 変更を拒否', 'error: 取消済みの制作タスクは変更できません', v_res,
    v_res like '%取消済みの制作タスクは変更できません%');

  select * into t from public.production_tasks where id = v_task;
  perform pg_temp.t_record('C', '拒否後も取消内容は不変', 'production_waiting / テスト取消理由A / not null / staff_active',
    t.status || ' / ' || coalesce(t.cancel_reason, 'NULL') || ' / ' || coalesce(t.cancelled_at::text, 'NULL') || ' / ' || coalesce(t.assignee_staff_id::text, 'NULL'),
    t.status = 'production_waiting' and t.cancel_reason = 'テスト取消理由A' and t.cancelled_at is not null
      and t.assignee_staff_id = pg_temp.t_id('staff_active') and t.cancelled_by_staff_id = pg_temp.t_id('staff_active'));

  perform pg_temp.t_record('C', '取消済み完了タスクは completed のまま', 'completed',
    (select status from public.production_tasks where id = pg_temp.t_id('r_completed')),
    (select status from public.production_tasks where id = pg_temp.t_id('r_completed')) = 'completed');
end;
$$;

-- =============================================================================
-- H 関連履歴は取消後も削除・変更されない
-- =============================================================================

do $$
begin
  perform pg_temp.t_record('H', 'Wチェック待ち(waiting)の w_checks が残り status 不変', 'waiting',
    coalesce((select status from public.w_checks where id = pg_temp.t_id('h_wcheck_waiting')), 'MISSING'),
    (select status from public.w_checks where id = pg_temp.t_id('h_wcheck_waiting')) = 'waiting');
  perform pg_temp.t_record('H', 'OK済み(approved)の w_checks が残り status 不変', 'approved',
    coalesce((select status from public.w_checks where id = pg_temp.t_id('h_wcheck_approved')), 'MISSING'),
    (select status from public.w_checks where id = pg_temp.t_id('h_wcheck_approved')) = 'approved');
  perform pg_temp.t_record('H', '顧客確認待ち(waiting)の client_confirmations が残り status 不変', 'waiting',
    coalesce((select status from public.client_confirmations where id = pg_temp.t_id('h_confirmation_waiting')), 'MISSING'),
    (select status from public.client_confirmations where id = pg_temp.t_id('h_confirmation_waiting')) = 'waiting');
  perform pg_temp.t_record('H', '顧客OK(approved)の client_confirmations が残り status 不変', 'approved',
    coalesce((select status from public.client_confirmations where id = pg_temp.t_id('h_confirmation_approved')), 'MISSING'),
    (select status from public.client_confirmations where id = pg_temp.t_id('h_confirmation_approved')) = 'approved');
  perform pg_temp.t_record('H', '取消済み完了タスク(recurring)の post_record は残り、有効(cancelled_at NULL)のまま', 'exists / NULL',
    coalesce((select 'exists / ' || coalesce(cancelled_at::text, 'NULL') from public.post_records where id = pg_temp.t_id('h_post_r_completed')), 'MISSING'),
    exists (select 1 from public.post_records where id = pg_temp.t_id('h_post_r_completed') and cancelled_at is null));
  perform pg_temp.t_record('H', '取消済み完了タスク(spot)の post_record は残り、有効(cancelled_at NULL)のまま', 'exists / NULL',
    coalesce((select 'exists / ' || coalesce(cancelled_at::text, 'NULL') from public.post_records where id = pg_temp.t_id('h_post_s_completed')), 'MISSING'),
    exists (select 1 from public.post_records where id = pg_temp.t_id('h_post_s_completed') and cancelled_at is null));
  perform pg_temp.t_record('H', 'fixture の関連履歴件数（w_checks 2 / client_confirmations 2 / post_records 3）', '2 / 2 / 3',
    (select count(*)::text from public.w_checks w join _t_ctx c on c.id = w.production_task_id)
      || ' / ' || (select count(*)::text from public.client_confirmations cc join _t_ctx c on c.id = cc.production_task_id)
      || ' / ' || (select count(*)::text from public.post_records p join _t_ctx c on c.id = p.production_task_id),
    (select count(*) from public.w_checks w join _t_ctx c on c.id = w.production_task_id) = 2
      and (select count(*) from public.client_confirmations cc join _t_ctx c on c.id = cc.production_task_id) = 2
      and (select count(*) from public.post_records p join _t_ctx c on c.id = p.production_task_id) = 3);
end;
$$;

-- =============================================================================
-- P 投稿実績の取消（cancel_post_record）と制作タスク取消の独立性
-- =============================================================================

do $$
declare
  v_auth uuid := pg_temp.t_id('auth_active');
  v_res text;
  t record;
begin
  -- 取消済みの完了タスクに紐づく投稿実績も、投稿実績として個別に取消できる
  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'select public.cancel_post_record(%L, %L, %L)',
    pg_temp.t_id('h_post_r_completed'), pg_temp.t_id('staff_active'), '投稿実績の取消テスト'));
  perform pg_temp.t_record('P', '取消済み完了タスクの post_record を cancel_post_record で取消できる', 'OK', v_res, v_res like 'OK%');

  perform pg_temp.t_record('P', 'その post_record は取消済みになる', 'not null',
    coalesce((select cancelled_at::text from public.post_records where id = pg_temp.t_id('h_post_r_completed')), 'NULL'),
    (select cancelled_at from public.post_records where id = pg_temp.t_id('h_post_r_completed')) is not null);

  select * into t from public.production_tasks where id = pg_temp.t_id('r_completed');
  perform pg_temp.t_record('P', '取消済みタスクは completed / 取消済みのまま（status を巻き戻さない）', 'completed / cancelled',
    t.status || ' / ' || coalesce(t.cancelled_at::text, 'NULL'),
    t.status = 'completed' and t.cancelled_at is not null and t.completed_at is not null);

  -- 回帰: 未取消の完了タスクは従来どおり posting_waiting へ戻る
  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'select public.cancel_post_record(%L, %L, %L)',
    pg_temp.t_id('h_post_done_normal'), pg_temp.t_id('staff_active'), '投稿実績の取消テスト（通常）'));
  perform pg_temp.t_record('P', '未取消の完了タスクの post_record 取消は成功', 'OK', v_res, v_res like 'OK%');

  select * into t from public.production_tasks where id = pg_temp.t_id('t_done_normal');
  perform pg_temp.t_record('P', '未取消の完了タスクは従来どおり posting_waiting へ戻る', 'posting_waiting / completed_at NULL / 未取消',
    t.status || ' / ' || coalesce(t.completed_at::text, 'NULL') || ' / ' || coalesce(t.cancelled_at::text, 'NULL'),
    t.status = 'posting_waiting' and t.completed_at is null and t.cancelled_at is null);

  -- spot 側の投稿実績は触っていないので有効なまま
  perform pg_temp.t_record('P', '他の post_record（spot 完了タスク分）は有効なまま', 'NULL',
    coalesce((select cancelled_at::text from public.post_records where id = pg_temp.t_id('h_post_s_completed')), 'NULL'),
    (select cancelled_at from public.post_records where id = pg_temp.t_id('h_post_s_completed')) is null);
end;
$$;

-- =============================================================================
-- E 権限（part_time 成功 / inactive・staff無し・anon 拒否）
-- =============================================================================

do $$
declare
  v_res text;
  t record;
begin
  v_res := pg_temp.t_try_cancel('authenticated', pg_temp.t_id('auth_part'), pg_temp.t_id('t_ok_part'), 'パート取消');
  perform pg_temp.t_record('E', 'part_time staff は取消できる', 'OK', v_res, v_res = 'OK');
  select * into t from public.production_tasks where id = pg_temp.t_id('t_ok_part');
  perform pg_temp.t_record('E', 'part_time 取消: cancelled_by_staff_id = part_time staff', pg_temp.t_id('staff_part')::text,
    coalesce(t.cancelled_by_staff_id::text, 'NULL'),
    t.cancelled_at is not null and t.cancelled_by_staff_id = pg_temp.t_id('staff_part') and t.status = 'production_waiting');

  v_res := pg_temp.t_try_cancel('authenticated', pg_temp.t_id('auth_inactive'), pg_temp.t_id('t_inactive'), 'inactive');
  perform pg_temp.t_record('E', 'inactive staff を拒否', 'error: ログインが必要です', v_res, v_res <> 'OK' and v_res like '%ログインが必要です%');

  v_res := pg_temp.t_try_cancel('authenticated', pg_temp.t_id('auth_nostaff'), pg_temp.t_id('t_nostaff'), 'nostaff');
  perform pg_temp.t_record('E', 'staff未登録の authenticated を拒否', 'error: ログインが必要です', v_res, v_res <> 'OK' and v_res like '%ログインが必要です%');

  v_res := pg_temp.t_try_cancel('anon', null, pg_temp.t_id('t_anon'), 'anon');
  perform pg_temp.t_record('E', 'anon は EXECUTE 不可', 'error 42501', v_res, v_res like '42501:%');

  perform pg_temp.t_record('E', 'has_function_privilege(anon, EXECUTE) = false', 'false',
    has_function_privilege('anon', 'public.cancel_production_task(uuid, text)', 'EXECUTE')::text,
    not has_function_privilege('anon', 'public.cancel_production_task(uuid, text)', 'EXECUTE'));
  perform pg_temp.t_record('E', 'has_function_privilege(authenticated, EXECUTE) = true', 'true',
    has_function_privilege('authenticated', 'public.cancel_production_task(uuid, text)', 'EXECUTE')::text,
    has_function_privilege('authenticated', 'public.cancel_production_task(uuid, text)', 'EXECUTE'));

  perform pg_temp.t_record('E', '拒否された対象は未取消のまま', '0',
    (select count(*)::text from public.production_tasks
      where id in (pg_temp.t_id('t_inactive'), pg_temp.t_id('t_nostaff'), pg_temp.t_id('t_anon')) and cancelled_at is not null),
    (select count(*) from public.production_tasks
      where id in (pg_temp.t_id('t_inactive'), pg_temp.t_id('t_nostaff'), pg_temp.t_id('t_anon')) and cancelled_at is not null) = 0);
end;
$$;

-- =============================================================================
-- F 再生成防止（取消済み recurring 行が残り、UNIQUE index が status に関係なく効く）
-- =============================================================================

do $$
declare
  v_auth uuid := pg_temp.t_id('auth_active');
  v_key text;
  t record;
  v_res text;
  v_insert_sql text;
begin
  perform pg_temp.t_record('F', 'unique index production_tasks_unique_recurring は cancelled_at で絞っていない', 'no cancelled_at',
    coalesce(pg_get_indexdef('public.production_tasks_unique_recurring'::regclass), 'MISSING'),
    pg_get_indexdef('public.production_tasks_unique_recurring'::regclass) not ilike '%cancelled_at%');

  foreach v_key in array array['t_ok_active', 'r_material_waiting', 'r_wcheck_waiting', 'r_completed'] loop
    select * into t from public.production_tasks where id = pg_temp.t_id(v_key);

    -- アプリ(generateTasksForRule)と同じ存在チェック（cancelled_at で絞らない）を authenticated として実行
    v_res := pg_temp.t_try_count('authenticated', v_auth, format(
      'select count(*) from public.production_tasks where client_id = %L and schedule_rule_id = %L and scheduled_post_date = %L and post_type = %L',
      t.client_id, t.schedule_rule_id, t.scheduled_post_date, t.post_type));
    perform pg_temp.t_record('F', v_key || ' (' || t.status || '): アプリの存在チェックが取消済み行を検出', '1', v_res, v_res = '1');

    v_insert_sql := format(
      'insert into public.production_tasks (client_id, schedule_rule_id, post_type, task_kind, source_month, scheduled_post_date, status, title) '
      || 'values (%L, %L, %L, ''recurring'', %L, %L, ''production_waiting'', ''ZZTEST-PTC-TITLE regenerate'')',
      t.client_id, t.schedule_rule_id, t.post_type, t.source_month, t.scheduled_post_date);

    v_res := pg_temp.t_try_sql('authenticated', v_auth, v_insert_sql);
    perform pg_temp.t_record('F', v_key || ' (' || t.status || '): 同一 rule/date/post_type の INSERT を拒否', 'error 23505', v_res, v_res like '23505:%');
  end loop;

  -- postgres でも同様
  select * into t from public.production_tasks where id = pg_temp.t_id('r_completed');
  v_res := pg_temp.t_try_sql('postgres', null, format(
    'insert into public.production_tasks (client_id, schedule_rule_id, post_type, task_kind, source_month, scheduled_post_date, status, title) '
    || 'values (%L, %L, %L, ''recurring'', %L, %L, ''production_waiting'', ''ZZTEST-PTC-TITLE regenerate'')',
    t.client_id, t.schedule_rule_id, t.post_type, t.source_month, t.scheduled_post_date));
  perform pg_temp.t_record('F', 'postgres でも同一キーの INSERT を拒否', 'error 23505', v_res, v_res like '23505:%');

  -- 対照: 別日付なら INSERT できる（index が過剰に効いていないこと）
  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'insert into public.production_tasks (client_id, schedule_rule_id, post_type, task_kind, source_month, scheduled_post_date, status, title) '
    || 'values (%L, %L, %L, ''recurring'', %L, %L, ''production_waiting'', ''ZZTEST-PTC-TITLE other-date'')',
    t.client_id, t.schedule_rule_id, t.post_type, t.source_month, date '2099-03-31'));
  perform pg_temp.t_record('F', '対照: 別日付の INSERT は成功', 'OK (rows=1)', v_res, v_res = 'OK (rows=1)');

  -- spot は再生成対象外: 取消済み spot 行は単純に残る
  perform pg_temp.t_record('F', '取消済み spot 行は残存（7 件）', '7',
    (select count(*)::text from public.production_tasks pt join _t_ctx c on c.id = pt.id
      where c.k like 's\_%' and pt.task_kind = 'spot' and pt.cancelled_at is not null),
    (select count(*) from public.production_tasks pt join _t_ctx c on c.id = pt.id
      where c.k like 's\_%' and pt.task_kind = 'spot' and pt.cancelled_at is not null) = 7);
end;
$$;

-- =============================================================================
-- G 通常行（未取消行の UPDATE / status 遷移を trigger が妨げない）
-- =============================================================================

do $$
declare
  v_auth uuid := pg_temp.t_id('auth_active');
  v_task uuid := pg_temp.t_id('t_normal');
  v_res text;
  t record;
begin
  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'update public.production_tasks set status = ''in_production'', started_at = now() where id = %L', v_task));
  perform pg_temp.t_record('G', '未取消: production_waiting -> in_production', 'OK (rows=1)', v_res, v_res = 'OK (rows=1)');

  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'update public.production_tasks set status = ''wcheck_waiting'' where id = %L', v_task));
  perform pg_temp.t_record('G', '未取消: in_production -> wcheck_waiting', 'OK (rows=1)', v_res, v_res = 'OK (rows=1)');

  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'update public.production_tasks set assignee_staff_id = %L, notes = ''ZZTEST-PTC-NOTES updated'' where id = %L',
    pg_temp.t_id('staff_part'), v_task));
  perform pg_temp.t_record('G', '未取消: 担当・メモ変更', 'OK (rows=1)', v_res, v_res = 'OK (rows=1)');

  v_res := pg_temp.t_try_sql('authenticated', pg_temp.t_id('auth_part'), format(
    'update public.production_tasks set status = ''production_waiting'', material_wait_started_at = null where id = %L',
    pg_temp.t_id('t_normal2')));
  perform pg_temp.t_record('G', '未取消: material_waiting -> production_waiting (part_time)', 'OK (rows=1)', v_res, v_res = 'OK (rows=1)');

  select * into t from public.production_tasks where id = v_task;
  perform pg_temp.t_record('G', '通常行の UPDATE 結果が反映され未取消のまま', 'wcheck_waiting / staff_part / cancelled_at NULL',
    t.status || ' / ' || coalesce(t.assignee_staff_id::text, 'NULL') || ' / ' || coalesce(t.cancelled_at::text, 'NULL'),
    t.status = 'wcheck_waiting' and t.assignee_staff_id = pg_temp.t_id('staff_part') and t.cancelled_at is null);

  -- flagCarryoverForClient / 主担当引き継ぎ相当の一括UPDATE（cancelled_at is null で絞る）は成功する
  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'update public.production_tasks set is_carryover = is_carryover where client_id = %L and task_kind = ''recurring'' and cancelled_at is null',
    pg_temp.t_id('client')));
  perform pg_temp.t_record('G', '一括UPDATE（cancelled_at is null で絞る）は成功', 'OK', v_res, v_res like 'OK%');

  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'update public.production_tasks set assignee_staff_id = %L where client_id = %L and status <> ''completed'' and cancelled_at is null',
    pg_temp.t_id('staff_active'), pg_temp.t_id('client')));
  perform pg_temp.t_record('G', '主担当引き継ぎ相当（cancelled_at is null で絞る）は成功', 'OK', v_res, v_res like 'OK%');

  -- 参考: 絞らない一括UPDATEは取消済み行に当たり失敗する（アプリ側で必ず絞る前提）
  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'update public.production_tasks set is_carryover = is_carryover where client_id = %L and task_kind = ''recurring''',
    pg_temp.t_id('client')));
  perform pg_temp.t_record('G', '参考: 絞らない一括UPDATEは取消済み行で失敗（アプリ側で必ず絞る前提）',
    'error: 取消済みの制作タスクは変更できません', v_res, v_res like '%取消済みの制作タスクは変更できません%');
end;
$$;

-- =============================================================================
-- D activity_logs（全処理後にまとめて検証）
--   取消成功: t_ok_active(1) + 全status × recurring/spot(14) + t_ok_part(1) = 16 件
-- =============================================================================

do $$
declare
  l record;
  v_task_ids uuid[];
  v_cancelled_ids uuid[];
begin
  select array_agg(c.id) into v_task_ids
  from _t_ctx c join public.production_tasks pt on pt.id = c.id;

  select array_agg(pt.id) into v_cancelled_ids
  from public.production_tasks pt
  where pt.id = any (v_task_ids) and pt.cancelled_at is not null;

  perform pg_temp.t_record('D', '取消済みタスク数 = 16', '16',
    coalesce(array_length(v_cancelled_ids, 1), 0)::text,
    coalesce(array_length(v_cancelled_ids, 1), 0) = 16);

  perform pg_temp.t_record('D', 'fixture 全体の取消ログ = 取消成功数(16)', '16',
    (select count(*)::text from public.activity_logs
      where entity_id = any (v_task_ids) and action = 'production_task_cancelled'),
    (select count(*) from public.activity_logs
      where entity_id = any (v_task_ids) and action = 'production_task_cancelled') = 16);

  perform pg_temp.t_record('D', '取消済みタスク 1 件につきログ 1 件（二重ログなし）', '0 件の不一致',
    (select count(*)::text from unnest(v_cancelled_ids) as x(id)
      where (select count(*) from public.activity_logs a
             where a.entity_id = x.id and a.action = 'production_task_cancelled') <> 1),
    (select count(*) from unnest(v_cancelled_ids) as x(id)
      where (select count(*) from public.activity_logs a
             where a.entity_id = x.id and a.action = 'production_task_cancelled') <> 1) = 0);

  perform pg_temp.t_record('D', '未取消タスク（拒否・通常UPDATE・投稿実績取消）ではログなし', '0',
    (select count(*)::text from public.activity_logs
      where entity_id = any (v_task_ids) and not (entity_id = any (v_cancelled_ids))
        and action = 'production_task_cancelled'),
    (select count(*) from public.activity_logs
      where entity_id = any (v_task_ids) and not (entity_id = any (v_cancelled_ids))
        and action = 'production_task_cancelled') = 0);

  perform pg_temp.t_record('D', '全取消ログ: entity_type=production_task / actor = cancelled_by_staff_id', '0 件の不一致',
    (select count(*)::text from public.activity_logs a
      join public.production_tasks pt on pt.id = a.entity_id
      where a.entity_id = any (v_cancelled_ids) and a.action = 'production_task_cancelled'
        and (a.entity_type <> 'production_task' or a.actor_staff_id is distinct from pt.cancelled_by_staff_id)),
    (select count(*) from public.activity_logs a
      join public.production_tasks pt on pt.id = a.entity_id
      where a.entity_id = any (v_cancelled_ids) and a.action = 'production_task_cancelled'
        and (a.entity_type <> 'production_task' or a.actor_staff_id is distinct from pt.cancelled_by_staff_id)) = 0);

  perform pg_temp.t_record('D', '全取消ログ: title / notes をログへ入れていない', '0 件',
    (select count(*)::text from public.activity_logs a
      where a.entity_id = any (v_cancelled_ids) and a.action = 'production_task_cancelled'
        and (coalesce(a.after_data, '{}') ? 'title' or coalesce(a.after_data, '{}') ? 'notes'
             or coalesce(a.before_data, '{}') ? 'title' or coalesce(a.before_data, '{}') ? 'notes'
             or coalesce(a.before_data::text, '') || coalesce(a.after_data::text, '') like '%ZZTEST-PTC-TITLE%'
             or coalesce(a.before_data::text, '') || coalesce(a.after_data::text, '') like '%ZZTEST-PTC-NOTES%')),
    (select count(*) from public.activity_logs a
      where a.entity_id = any (v_cancelled_ids) and a.action = 'production_task_cancelled'
        and (coalesce(a.after_data, '{}') ? 'title' or coalesce(a.after_data, '{}') ? 'notes'
             or coalesce(a.before_data, '{}') ? 'title' or coalesce(a.before_data, '{}') ? 'notes'
             or coalesce(a.before_data::text, '') || coalesce(a.after_data::text, '') like '%ZZTEST-PTC-TITLE%'
             or coalesce(a.before_data::text, '') || coalesce(a.after_data::text, '') like '%ZZTEST-PTC-NOTES%')) = 0);

  -- 詳細確認（active / part_time）
  select * into l from public.activity_logs
  where entity_id = pg_temp.t_id('t_ok_active') and action = 'production_task_cancelled'
  limit 1;
  perform pg_temp.t_record('D', 'active: after_data の内容（reason / staff / client / cancelled_at）', 'match',
    coalesce(l.after_data::text, 'NULL'),
    l.actor_staff_id = pg_temp.t_id('staff_active')
      and l.after_data->>'cancel_reason' = 'テスト取消理由A'
      and l.after_data->>'cancelled_by_staff_id' = pg_temp.t_id('staff_active')::text
      and l.after_data->>'client_id' = pg_temp.t_id('client')::text
      and l.after_data->>'cancelled_at' is not null
      and l.before_data = jsonb_build_object('cancelled_at', null));

  select * into l from public.activity_logs
  where entity_id = pg_temp.t_id('t_ok_part') and action = 'production_task_cancelled'
  limit 1;
  perform pg_temp.t_record('D', 'part_time: actor / entity 一致', 'staff_part / production_task / t_ok_part',
    coalesce(l.actor_staff_id::text, 'NULL') || ' / ' || coalesce(l.entity_type, 'NULL') || ' / ' || coalesce(l.entity_id::text, 'NULL'),
    l.actor_staff_id = pg_temp.t_id('staff_part') and l.entity_type = 'production_task' and l.entity_id = pg_temp.t_id('t_ok_part'));
end;
$$;

-- -----------------------------------------------------------------------------
-- 結果表示（明細 → サマリ）
-- -----------------------------------------------------------------------------

select seq, section, ok, check_name, expected, actual
from _t_results
order by seq;

select
  count(*) as total_checks,
  count(*) filter (where ok) as passed,
  count(*) filter (where not ok) as failed,
  case when count(*) filter (where not ok) = 0 then 'ALL PASS' else 'FAIL' end as result,
  string_agg(section || ': ' || check_name, ' | ' order by seq) filter (where not ok) as failed_checks
from _t_results;

-- -----------------------------------------------------------------------------
-- 必ず ROLLBACK（テストデータ・ログを含め全て破棄）
-- -----------------------------------------------------------------------------

rollback;
