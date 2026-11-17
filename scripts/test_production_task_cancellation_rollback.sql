-- =============================================================================
-- test_production_task_cancellation_rollback.sql
--
-- 用途: production_tasks 個別取消機能の機能テスト（BEGIN 〜 ROLLBACK のみ）。
--       migration 20261026000001_production_task_cancellation.sql 適用後に実行する。
--
-- 安全性:
--   ・全処理を 1 トランザクション内で行い、最後に必ず ROLLBACK する（COMMIT は書かない）。
--   ・テスト用の auth.users / staff / clients / posting_schedule_rules / production_tasks を
--     トランザクション内で作成し、ROLLBACK で全て消える。既存行は一切 UPDATE / DELETE しない。
--   ・clients.client_code は明示指定し、client_code_seq（ROLLBACK で戻らない sequence）を消費しない。
--   ・途中で想定外のエラーが起きた場合もトランザクションは abort 状態になり何も確定しない。
--     その場合は ROLLBACK; を単独で実行してから原因を確認すること。
--
-- 実行方法（推奨）:
--   psql "<接続文字列>" -v ON_ERROR_STOP=1 -f scripts/test_production_task_cancellation_rollback.sql
--   ※ postgres ロール（Supabase SQL Editor と同じ権限）で実行する前提。
--   ※ 結果は最後の 2 つの SELECT（明細 / サマリ）で確認する。
--     ok=false の行が 1 つでもあれば不合格。
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
    -- ロールを元に戻す（authenticated のまま pg_temp 関数を呼ばないようインラインで実行）
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    perform set_config('request.jwt.claims', '', true);
    return 'OK (rows=' || v_rows || ')';
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
    -- ロールを元に戻す（authenticated のまま pg_temp 関数を呼ばないようインラインで実行）
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

  -- 制作タスク（recurring は同一ルール・日付違い。spot はルールなし）
  for r in
    select * from (values
      ('t_ok_active',   'recurring', 'production_waiting',          1),
      ('t_ok_part',     'recurring', 'production_waiting',          2),
      ('t_inactive',    'recurring', 'production_waiting',          3),
      ('t_nostaff',     'recurring', 'production_waiting',          4),
      ('t_anon',        'recurring', 'production_waiting',          5),
      ('t_reason',      'recurring', 'production_waiting',          6),
      ('t_material',    'recurring', 'material_waiting',            7),
      ('t_inprod',      'recurring', 'in_production',               8),
      ('t_wcheck',      'recurring', 'wcheck_waiting',              9),
      ('t_clientconf',  'recurring', 'client_confirmation_waiting', 10),
      ('t_posting',     'recurring', 'posting_waiting',             11),
      ('t_completed',   'recurring', 'completed',                   12),
      ('t_spot',        'spot',      'production_waiting',          13),
      ('t_normal',      'recurring', 'production_waiting',          14),
      ('t_normal2',     'recurring', 'material_waiting',            15)
    ) as v(k, task_kind, status, day_offset)
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
end;
$$;

-- =============================================================================
-- A 正常取消（recurring / production_waiting / 未取消 → 成功）
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
-- B ガード
-- =============================================================================

do $$
declare
  v_auth uuid := pg_temp.t_id('auth_active');
  v_res text;
  r record;
begin
  -- 二重取消
  v_res := pg_temp.t_try_cancel('authenticated', v_auth, pg_temp.t_id('t_ok_active'), '二重取消');
  perform pg_temp.t_record('B', '二重取消を拒否', 'error: 既に取消済み', v_res, v_res <> 'OK' and v_res like '%既に取消済み%');

  -- status ガード（素材待ち・制作中・Wチェック以降・完了）
  for r in
    select * from (values
      ('t_material',   'material_waiting'),
      ('t_inprod',     'in_production'),
      ('t_wcheck',     'wcheck_waiting'),
      ('t_clientconf', 'client_confirmation_waiting'),
      ('t_posting',    'posting_waiting'),
      ('t_completed',  'completed')
    ) as v(k, status)
  loop
    v_res := pg_temp.t_try_cancel('authenticated', v_auth, pg_temp.t_id(r.k), 'statusガード');
    perform pg_temp.t_record('B', r.status || ' を拒否', 'error: 制作待ちの制作タスクのみ', v_res,
      v_res <> 'OK' and v_res like '%制作待ちの制作タスクのみ%');
  end loop;

  -- spot
  v_res := pg_temp.t_try_cancel('authenticated', v_auth, pg_temp.t_id('t_spot'), 'spotガード');
  perform pg_temp.t_record('B', 'spot を拒否', 'error: 自動生成（定期）', v_res, v_res <> 'OK' and v_res like '%自動生成（定期）%');

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

  -- 拒否されたタスクは全て未取消のまま
  perform pg_temp.t_record('B', '拒否されたタスクは未取消のまま', '0',
    (select count(*)::text from public.production_tasks
      where id in (pg_temp.t_id('t_material'), pg_temp.t_id('t_inprod'), pg_temp.t_id('t_wcheck'),
                   pg_temp.t_id('t_clientconf'), pg_temp.t_id('t_posting'), pg_temp.t_id('t_completed'),
                   pg_temp.t_id('t_spot'), pg_temp.t_id('t_reason'))
        and cancelled_at is not null),
    (select count(*) from public.production_tasks
      where id in (pg_temp.t_id('t_material'), pg_temp.t_id('t_inprod'), pg_temp.t_id('t_wcheck'),
                   pg_temp.t_id('t_clientconf'), pg_temp.t_id('t_posting'), pg_temp.t_id('t_completed'),
                   pg_temp.t_id('t_spot'), pg_temp.t_id('t_reason'))
        and cancelled_at is not null) = 0);
  perform pg_temp.t_record('B', '拒否されたタスクの status は不変', 'unchanged',
    (select string_agg(status, ',' order by scheduled_post_date) from public.production_tasks
      where id in (pg_temp.t_id('t_material'), pg_temp.t_id('t_inprod'), pg_temp.t_id('t_wcheck'),
                   pg_temp.t_id('t_clientconf'), pg_temp.t_id('t_posting'), pg_temp.t_id('t_completed'))),
    (select string_agg(status, ',' order by scheduled_post_date) from public.production_tasks
      where id in (pg_temp.t_id('t_material'), pg_temp.t_id('t_inprod'), pg_temp.t_id('t_wcheck'),
                   pg_temp.t_id('t_clientconf'), pg_temp.t_id('t_posting'), pg_temp.t_id('t_completed')))
      = 'material_waiting,in_production,wcheck_waiting,client_confirmation_waiting,posting_waiting,completed');
end;
$$;

-- =============================================================================
-- C immutable（取消済み行は一切変更できない）
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
  -- part_time
  v_res := pg_temp.t_try_cancel('authenticated', pg_temp.t_id('auth_part'), pg_temp.t_id('t_ok_part'), 'パート取消');
  perform pg_temp.t_record('E', 'part_time staff は取消できる', 'OK', v_res, v_res = 'OK');
  select * into t from public.production_tasks where id = pg_temp.t_id('t_ok_part');
  perform pg_temp.t_record('E', 'part_time 取消: cancelled_by_staff_id = part_time staff', pg_temp.t_id('staff_part')::text,
    coalesce(t.cancelled_by_staff_id::text, 'NULL'),
    t.cancelled_at is not null and t.cancelled_by_staff_id = pg_temp.t_id('staff_part') and t.status = 'production_waiting');

  -- inactive staff
  v_res := pg_temp.t_try_cancel('authenticated', pg_temp.t_id('auth_inactive'), pg_temp.t_id('t_inactive'), 'inactive');
  perform pg_temp.t_record('E', 'inactive staff を拒否', 'error: ログインが必要です', v_res, v_res <> 'OK' and v_res like '%ログインが必要です%');

  -- staff 行のない authenticated ユーザー
  v_res := pg_temp.t_try_cancel('authenticated', pg_temp.t_id('auth_nostaff'), pg_temp.t_id('t_nostaff'), 'nostaff');
  perform pg_temp.t_record('E', 'staff未登録の authenticated を拒否', 'error: ログインが必要です', v_res, v_res <> 'OK' and v_res like '%ログインが必要です%');

  -- anon
  v_res := pg_temp.t_try_cancel('anon', null, pg_temp.t_id('t_anon'), 'anon');
  perform pg_temp.t_record('E', 'anon は EXECUTE 不可', 'error 42501', v_res, v_res like '42501:%');

  perform pg_temp.t_record('E', 'has_function_privilege(anon, EXECUTE) = false', 'false',
    has_function_privilege('anon', 'public.cancel_production_task(uuid, text)', 'EXECUTE')::text,
    not has_function_privilege('anon', 'public.cancel_production_task(uuid, text)', 'EXECUTE'));
  perform pg_temp.t_record('E', 'has_function_privilege(authenticated, EXECUTE) = true', 'true',
    has_function_privilege('authenticated', 'public.cancel_production_task(uuid, text)', 'EXECUTE')::text,
    has_function_privilege('authenticated', 'public.cancel_production_task(uuid, text)', 'EXECUTE'));

  -- inactive / staff無し / anon の対象は未取消のまま
  perform pg_temp.t_record('E', '拒否された対象は未取消のまま', '0',
    (select count(*)::text from public.production_tasks
      where id in (pg_temp.t_id('t_inactive'), pg_temp.t_id('t_nostaff'), pg_temp.t_id('t_anon')) and cancelled_at is not null),
    (select count(*) from public.production_tasks
      where id in (pg_temp.t_id('t_inactive'), pg_temp.t_id('t_nostaff'), pg_temp.t_id('t_anon')) and cancelled_at is not null) = 0);
end;
$$;

-- =============================================================================
-- F 再生成防止（取消済み行が残り、UNIQUE index が取消済み行にも効く）
-- =============================================================================

do $$
declare
  v_auth uuid := pg_temp.t_id('auth_active');
  v_task uuid := pg_temp.t_id('t_ok_active');
  t record;
  v_res text;
  v_insert_sql text;
begin
  select * into t from public.production_tasks where id = v_task;

  perform pg_temp.t_record('F', '取消済み recurring task が残存', '1 row, cancelled',
    (select count(*)::text from public.production_tasks where id = v_task and cancelled_at is not null),
    (select count(*) from public.production_tasks where id = v_task and cancelled_at is not null) = 1);

  perform pg_temp.t_record('F', 'unique index production_tasks_unique_recurring は cancelled_at で絞っていない', 'no cancelled_at',
    coalesce(pg_get_indexdef('public.production_tasks_unique_recurring'::regclass), 'MISSING'),
    pg_get_indexdef('public.production_tasks_unique_recurring'::regclass) not ilike '%cancelled_at%');

  -- アプリ(generateTasksForRule)と同じ存在チェック（cancelled_at で絞らない）を authenticated として実行
  v_res := pg_temp.t_try_count('authenticated', v_auth, format(
    'select count(*) from public.production_tasks where client_id = %L and schedule_rule_id = %L and scheduled_post_date = %L and post_type = %L',
    t.client_id, t.schedule_rule_id, t.scheduled_post_date, t.post_type));
  perform pg_temp.t_record('F', 'アプリの存在チェックが取消済み行を検出（=再生成しない）', '1', v_res, v_res = '1');

  -- 同一 rule / date / post_type の INSERT は UNIQUE 違反
  v_insert_sql := format(
    'insert into public.production_tasks (client_id, schedule_rule_id, post_type, task_kind, source_month, scheduled_post_date, status, title) '
    || 'values (%L, %L, %L, ''recurring'', %L, %L, ''production_waiting'', ''ZZTEST-PTC-TITLE regenerate'')',
    t.client_id, t.schedule_rule_id, t.post_type, t.source_month, t.scheduled_post_date);

  v_res := pg_temp.t_try_sql('authenticated', v_auth, v_insert_sql);
  perform pg_temp.t_record('F', '同一 rule/date/post_type の INSERT を拒否 (authenticated)', 'error 23505', v_res, v_res like '23505:%');

  v_res := pg_temp.t_try_sql('postgres', null, v_insert_sql);
  perform pg_temp.t_record('F', '同一 rule/date/post_type の INSERT を拒否 (postgres)', 'error 23505', v_res, v_res like '23505:%');

  perform pg_temp.t_record('F', '同一キーの行は取消済み 1 件のみ', '1',
    (select count(*)::text from public.production_tasks
      where client_id = t.client_id and schedule_rule_id = t.schedule_rule_id
        and scheduled_post_date = t.scheduled_post_date and post_type = t.post_type),
    (select count(*) from public.production_tasks
      where client_id = t.client_id and schedule_rule_id = t.schedule_rule_id
        and scheduled_post_date = t.scheduled_post_date and post_type = t.post_type) = 1);

  -- 対照: 別日付なら INSERT できる（index が過剰に効いていないこと）
  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'insert into public.production_tasks (client_id, schedule_rule_id, post_type, task_kind, source_month, scheduled_post_date, status, title) '
    || 'values (%L, %L, %L, ''recurring'', %L, %L, ''production_waiting'', ''ZZTEST-PTC-TITLE other-date'')',
    t.client_id, t.schedule_rule_id, t.post_type, t.source_month, date '2099-02-28'));
  perform pg_temp.t_record('F', '対照: 別日付の INSERT は成功', 'OK (rows=1)', v_res, v_res = 'OK (rows=1)');
end;
$$;

-- =============================================================================
-- G 通常行（未取消行の UPDATE / status 遷移を新 trigger が妨げない）
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

  -- flagCarryoverForClient 相当の一括UPDATE（cancelled_at is null で絞る）は成功する
  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'update public.production_tasks set is_carryover = is_carryover where client_id = %L and task_kind = ''recurring'' and cancelled_at is null',
    pg_temp.t_id('client')));
  perform pg_temp.t_record('G', '一括UPDATE（cancelled_at is null で絞る）は成功', 'OK', v_res, v_res like 'OK%');

  -- 参考: 絞らない一括UPDATEは取消済み行に当たり失敗する（migration 注記どおりの挙動）
  v_res := pg_temp.t_try_sql('authenticated', v_auth, format(
    'update public.production_tasks set is_carryover = is_carryover where client_id = %L and task_kind = ''recurring''',
    pg_temp.t_id('client')));
  perform pg_temp.t_record('G', '参考: 絞らない一括UPDATEは取消済み行で失敗（アプリ側で必ず絞る前提）',
    'error: 取消済みの制作タスクは変更できません', v_res, v_res like '%取消済みの制作タスクは変更できません%');
end;
$$;

-- =============================================================================
-- D activity_logs（A〜G 実行後にまとめて検証）
-- =============================================================================

do $$
declare
  l record;
  v_fixture_ids uuid[];
begin
  select array_agg(id) into v_fixture_ids
  from _t_ctx where k like 't\_%';

  -- 取消 1 回につき 1 件（t_ok_active: 二重取消・immutable 拒否後も 1 件のまま）
  perform pg_temp.t_record('D', 't_ok_active の production_task_cancelled ログ = 1 件', '1',
    (select count(*)::text from public.activity_logs
      where entity_id = pg_temp.t_id('t_ok_active') and action = 'production_task_cancelled'),
    (select count(*) from public.activity_logs
      where entity_id = pg_temp.t_id('t_ok_active') and action = 'production_task_cancelled') = 1);

  perform pg_temp.t_record('D', 't_ok_part の production_task_cancelled ログ = 1 件', '1',
    (select count(*)::text from public.activity_logs
      where entity_id = pg_temp.t_id('t_ok_part') and action = 'production_task_cancelled'),
    (select count(*) from public.activity_logs
      where entity_id = pg_temp.t_id('t_ok_part') and action = 'production_task_cancelled') = 1);

  -- 二重ログなし: fixture 全体で取消成功数(2)と一致
  perform pg_temp.t_record('D', 'fixture 全体の取消ログ = 成功した取消数(2)', '2',
    (select count(*)::text from public.activity_logs
      where entity_id = any (v_fixture_ids) and action = 'production_task_cancelled'),
    (select count(*) from public.activity_logs
      where entity_id = any (v_fixture_ids) and action = 'production_task_cancelled') = 2);

  -- 拒否・通常UPDATE ではログが出ない
  perform pg_temp.t_record('D', '拒否された取消・通常UPDATEではログなし', '0',
    (select count(*)::text from public.activity_logs
      where entity_id = any (v_fixture_ids)
        and entity_id not in (pg_temp.t_id('t_ok_active'), pg_temp.t_id('t_ok_part'))
        and action = 'production_task_cancelled'),
    (select count(*) from public.activity_logs
      where entity_id = any (v_fixture_ids)
        and entity_id not in (pg_temp.t_id('t_ok_active'), pg_temp.t_id('t_ok_part'))
        and action = 'production_task_cancelled') = 0);

  -- actor / entity 一致（active）
  select * into l from public.activity_logs
  where entity_id = pg_temp.t_id('t_ok_active') and action = 'production_task_cancelled'
  limit 1;
  perform pg_temp.t_record('D', 'active: actor_staff_id = 取消staff', pg_temp.t_id('staff_active')::text,
    coalesce(l.actor_staff_id::text, 'NULL'), l.actor_staff_id = pg_temp.t_id('staff_active'));
  perform pg_temp.t_record('D', 'active: entity_type / entity_id 一致', 'production_task / t_ok_active',
    coalesce(l.entity_type, 'NULL') || ' / ' || coalesce(l.entity_id::text, 'NULL'),
    l.entity_type = 'production_task' and l.entity_id = pg_temp.t_id('t_ok_active'));
  perform pg_temp.t_record('D', 'active: after_data の内容（reason / staff / client / cancelled_at）', 'match',
    coalesce(l.after_data::text, 'NULL'),
    l.after_data->>'cancel_reason' = 'テスト取消理由A'
      and l.after_data->>'cancelled_by_staff_id' = pg_temp.t_id('staff_active')::text
      and l.after_data->>'client_id' = pg_temp.t_id('client')::text
      and l.after_data->>'cancelled_at' is not null
      and l.before_data = jsonb_build_object('cancelled_at', null));
  perform pg_temp.t_record('D', 'active: title / notes をログへ入れていない', 'no title/notes',
    'keys=' || coalesce((select string_agg(k, ',') from jsonb_object_keys(coalesce(l.before_data, '{}') || coalesce(l.after_data, '{}')) k), ''),
    not (coalesce(l.after_data, '{}') ? 'title') and not (coalesce(l.after_data, '{}') ? 'notes')
      and not (coalesce(l.before_data, '{}') ? 'title') and not (coalesce(l.before_data, '{}') ? 'notes')
      and coalesce(l.before_data::text, '') || coalesce(l.after_data::text, '') not like '%ZZTEST-PTC-TITLE%'
      and coalesce(l.before_data::text, '') || coalesce(l.after_data::text, '') not like '%ZZTEST-PTC-NOTES%');

  -- actor / entity 一致（part_time）
  select * into l from public.activity_logs
  where entity_id = pg_temp.t_id('t_ok_part') and action = 'production_task_cancelled'
  limit 1;
  perform pg_temp.t_record('D', 'part_time: actor / entity 一致', 'staff_part / production_task / t_ok_part',
    coalesce(l.actor_staff_id::text, 'NULL') || ' / ' || coalesce(l.entity_type, 'NULL') || ' / ' || coalesce(l.entity_id::text, 'NULL'),
    l.actor_staff_id = pg_temp.t_id('staff_part') and l.entity_type = 'production_task' and l.entity_id = pg_temp.t_id('t_ok_part'));
  perform pg_temp.t_record('D', 'part_time: title / notes をログへ入れていない', 'no title/notes',
    'keys=' || coalesce((select string_agg(k, ',') from jsonb_object_keys(coalesce(l.before_data, '{}') || coalesce(l.after_data, '{}')) k), ''),
    coalesce(l.before_data::text, '') || coalesce(l.after_data::text, '') not like '%ZZTEST-PTC-%'
      and not (coalesce(l.after_data, '{}') ? 'title') and not (coalesce(l.after_data, '{}') ? 'notes'));
end;
$$;

-- -----------------------------------------------------------------------------
-- 結果表示（明細 → サマリ）
-- -----------------------------------------------------------------------------

select seq, section, ok, check_name, expected, actual
from _t_results
order by section, seq;

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
