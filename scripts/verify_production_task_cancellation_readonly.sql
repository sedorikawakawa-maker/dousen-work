-- =============================================================================
-- verify_production_task_cancellation_readonly.sql
--
-- 用途: supabase/migrations/20261026000001_production_task_cancellation.sql
--       適用後の read-only 確認。
--
-- ・SELECT のみ。DDL / DML / 関数呼び出し（cancel_production_task）は一切行わない。
-- ・1本のSELECTで「check / expected / actual / ok」の一覧を返す。
--   ok が全行 true であれば合格。false の行があれば migration 未適用 or 差分あり。
-- ・最終行 "__SUMMARY__" に総数と失敗数をまとめる。
-- =============================================================================

with
fn as (
  select p.oid, p.prosecdef, p.prosrc, p.proacl, p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'cancel_production_task'
    and pg_get_function_identity_arguments(p.oid) = 'p_task_id uuid, p_reason text'
),
fn_acl as (
  -- proacl が NULL の場合はデフォルト権限（PUBLIC に EXECUTE）とみなす
  select (a).grantee, (a).privilege_type
  from (
    select aclexplode(coalesce(fn.proacl, acldefault('f', (select proowner from pg_proc where oid = fn.oid)))) as a
    from fn
  ) s
),
log_fn as (
  select p.prosecdef, p.prosrc
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'log_production_tasks_cancellation'
),
imm_fn as (
  select p.prosrc
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'enforce_production_tasks_cancelled_immutable'
),
trg as (
  select t.tgname, t.tgenabled, t.tgtype, pr.proname as fn_name
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc pr on pr.oid = t.tgfoid
  where n.nspname = 'public' and c.relname = 'production_tasks' and not t.tgisinternal
),
pol as (
  select policyname, cmd, roles::text as roles, qual, with_check
  from pg_policies
  where schemaname = 'public' and tablename = 'production_tasks'
),
cols as (
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'production_tasks'
    and column_name in ('cancelled_at', 'cancelled_by_staff_id', 'cancel_reason')
),
pt_json as (
  select to_jsonb(pt) as j from public.production_tasks pt
),
checks as (
  -- ----------------------------------------------------------------- 列
  select 10 as ord, 'column production_tasks.cancelled_at (timestamptz, nullable)' as check_name,
         'exists' as expected,
         coalesce((select data_type::text || ' / nullable=' || is_nullable::text from cols where column_name = 'cancelled_at'), 'MISSING') as actual,
         exists (select 1 from cols where column_name = 'cancelled_at'
                 and data_type = 'timestamp with time zone' and is_nullable = 'YES') as ok
  union all
  select 11, 'column production_tasks.cancelled_by_staff_id (uuid, nullable)', 'exists',
         coalesce((select data_type::text || ' / nullable=' || is_nullable::text from cols where column_name = 'cancelled_by_staff_id'), 'MISSING'),
         exists (select 1 from cols where column_name = 'cancelled_by_staff_id'
                 and data_type = 'uuid' and is_nullable = 'YES')
  union all
  select 12, 'FK cancelled_by_staff_id -> staff(id)', 'exists',
         coalesce((select string_agg(conname::text, ',') from pg_constraint
                   where conrelid = 'public.production_tasks'::regclass and contype = 'f'
                     and confrelid = 'public.staff'::regclass
                     and pg_get_constraintdef(oid) ilike '%(cancelled_by_staff_id)%'), 'MISSING'),
         exists (select 1 from pg_constraint
                 where conrelid = 'public.production_tasks'::regclass and contype = 'f'
                   and confrelid = 'public.staff'::regclass
                   and pg_get_constraintdef(oid) ilike '%(cancelled_by_staff_id)%')
  union all
  select 13, 'column production_tasks.cancel_reason (text, nullable)', 'exists',
         coalesce((select data_type::text || ' / nullable=' || is_nullable::text from cols where column_name = 'cancel_reason'), 'MISSING'),
         exists (select 1 from cols where column_name = 'cancel_reason'
                 and data_type = 'text' and is_nullable = 'YES')

  -- ----------------------------------------------------------------- CHECK制約
  union all
  select 20, 'CHECK production_tasks_cancel_reason_required', 'cancelled_at IS NULL OR cancel_reason IS NOT NULL',
         coalesce((select pg_get_constraintdef(oid) from pg_constraint
                   where conname = 'production_tasks_cancel_reason_required'
                     and conrelid = 'public.production_tasks'::regclass), 'MISSING'),
         exists (select 1 from pg_constraint
                 where conname = 'production_tasks_cancel_reason_required'
                   and conrelid = 'public.production_tasks'::regclass
                   and contype = 'c' and convalidated
                   and pg_get_constraintdef(oid) ilike '%cancelled_at is null%'
                   and pg_get_constraintdef(oid) ilike '%cancel_reason is not null%')

  -- ----------------------------------------------------------------- immutable trigger
  union all
  select 30, 'trigger production_tasks_enforce_cancelled_immutable (BEFORE UPDATE, ROW, enabled)',
         'exists -> enforce_production_tasks_cancelled_immutable',
         coalesce((select fn_name::text || ' / enabled=' || tgenabled::text || ' / tgtype=' || tgtype::text
                   from trg where tgname = 'production_tasks_enforce_cancelled_immutable'), 'MISSING'),
         -- tgtype: ROW(1) + BEFORE(2) + UPDATE(16) = 19
         exists (select 1 from trg where tgname = 'production_tasks_enforce_cancelled_immutable'
                 and fn_name = 'enforce_production_tasks_cancelled_immutable'
                 and tgenabled <> 'D' and tgtype = 19)
  union all
  select 31, 'immutable fn body checks old.cancelled_at is not null and raises', 'contains',
         coalesce((select case when prosrc ilike '%old.cancelled_at is not null%' and prosrc ilike '%raise exception%'
                               then 'ok' else 'body mismatch' end from imm_fn), 'MISSING'),
         exists (select 1 from imm_fn where prosrc ilike '%old.cancelled_at is not null%' and prosrc ilike '%raise exception%')

  -- ----------------------------------------------------------------- cancellation log trigger
  union all
  select 40, 'trigger production_tasks_log_cancellation (AFTER UPDATE, ROW, enabled)',
         'exists -> log_production_tasks_cancellation',
         coalesce((select fn_name::text || ' / enabled=' || tgenabled::text || ' / tgtype=' || tgtype::text
                   from trg where tgname = 'production_tasks_log_cancellation'), 'MISSING'),
         -- tgtype: ROW(1) + UPDATE(16) = 17 （AFTER は BEFORE ビットなし）
         exists (select 1 from trg where tgname = 'production_tasks_log_cancellation'
                 and fn_name = 'log_production_tasks_cancellation'
                 and tgenabled <> 'D' and tgtype = 17)
  union all
  select 41, 'log fn: security definer + action production_task_cancelled', 'definer=true, contains action',
         coalesce((select 'definer=' || prosecdef::text from log_fn), 'MISSING'),
         exists (select 1 from log_fn where prosecdef
                 and prosrc ilike '%production_task_cancelled%'
                 and prosrc ilike '%old.cancelled_at is null and new.cancelled_at is not null%')
  union all
  select 42, 'log fn: title / notes をログへ入れていない', 'no new.title / new.notes',
         coalesce((select case when prosrc ilike '%new.title%' or prosrc ilike '%new.notes%'
                               then 'FOUND title/notes' else 'ok' end from log_fn), 'MISSING'),
         exists (select 1 from log_fn where prosrc not ilike '%new.title%' and prosrc not ilike '%new.notes%')

  -- ----------------------------------------------------------------- RPC
  union all
  select 50, 'function public.cancel_production_task(uuid, text)', 'exists',
         case when exists (select 1 from fn) then 'exists' else 'MISSING' end,
         exists (select 1 from fn)
  union all
  select 51, 'cancel_production_task is SECURITY INVOKER', 'prosecdef=false',
         coalesce((select 'prosecdef=' || prosecdef::text from fn), 'MISSING'),
         exists (select 1 from fn where not prosecdef)
  union all
  select 52, 'cancel_production_task search_path=public', 'proconfig contains search_path=public',
         coalesce((select coalesce(array_to_string(proconfig, ','), '(none)') from fn), 'MISSING'),
         exists (select 1 from fn where 'search_path=public' = any (coalesce(proconfig, '{}')))
  union all
  select 53, 'authenticated has EXECUTE', 'true',
         coalesce((select has_function_privilege('authenticated', oid, 'EXECUTE')::text from fn), 'MISSING'),
         coalesce((select has_function_privilege('authenticated', oid, 'EXECUTE') from fn), false)
  union all
  select 54, 'anon has NO EXECUTE (PUBLIC経由も含む)', 'false',
         coalesce((select has_function_privilege('anon', oid, 'EXECUTE')::text from fn), 'MISSING'),
         coalesce((select not has_function_privilege('anon', oid, 'EXECUTE') from fn), false)
  union all
  select 55, 'PUBLIC has NO EXECUTE', 'no ACL entry for grantee=0(PUBLIC)',
         case when not exists (select 1 from fn) then 'MISSING'
              when exists (select 1 from fn_acl where grantee = 0 and privilege_type = 'EXECUTE') then 'PUBLIC EXECUTE granted'
              else 'none' end,
         exists (select 1 from fn)
           and not exists (select 1 from fn_acl where grantee = 0 and privilege_type = 'EXECUTE')
  union all
  select 56, 'RPC uses public.current_staff_id()', 'contains',
         coalesce((select case when prosrc ilike '%current_staff_id()%' then 'ok' else 'not found' end from fn), 'MISSING'),
         exists (select 1 from fn where prosrc ilike '%current_staff_id()%')
  union all
  select 57, 'RPC locks row with FOR UPDATE', 'contains',
         coalesce((select case when prosrc ~* 'for\s+update' then 'ok' else 'not found' end from fn), 'MISSING'),
         exists (select 1 from fn where prosrc ~* 'for\s+update')
  union all
  select 58, 'RPC guards: recurring / production_waiting / already cancelled / empty reason', 'all contained',
         coalesce((select concat_ws(',',
                    case when prosrc ilike '%''recurring''%' then 'recurring' end,
                    case when prosrc ilike '%''production_waiting''%' then 'production_waiting' end,
                    case when prosrc ilike '%v_cancelled_at is not null%' then 'already_cancelled' end,
                    case when prosrc ilike '%btrim(p_reason)%' then 'empty_reason' end) from fn), 'MISSING'),
         exists (select 1 from fn
                 where prosrc ilike '%''recurring''%'
                   and prosrc ilike '%''production_waiting''%'
                   and prosrc ilike '%v_cancelled_at is not null%'
                   and prosrc ilike '%btrim(p_reason)%')
  union all
  select 59, 'RPC does not DELETE', 'no DELETE statement',
         coalesce((select case when prosrc ~* '\mdelete\s+from\M' then 'DELETE FOUND' else 'ok' end from fn), 'MISSING'),
         exists (select 1 from fn where prosrc !~* '\mdelete\s+from\M')

  -- ----------------------------------------------------------------- RLS / policy
  union all
  select 60, 'RLS enabled on production_tasks', 'true',
         (select relrowsecurity::text from pg_class where oid = 'public.production_tasks'::regclass),
         (select relrowsecurity from pg_class where oid = 'public.production_tasks'::regclass)
  union all
  select 61, 'policy production_tasks_select (SELECT, authenticated, is_active_staff())', 'exists',
         coalesce((select cmd::text || ' ' || roles || ' using=' || coalesce(qual, '') from pol where policyname = 'production_tasks_select'), 'MISSING'),
         exists (select 1 from pol where policyname = 'production_tasks_select' and cmd = 'SELECT'
                 and roles = '{authenticated}' and qual ilike '%is_active_staff()%')
  union all
  select 62, 'policy production_tasks_insert (INSERT, authenticated, is_active_staff())', 'exists',
         coalesce((select cmd::text || ' ' || roles || ' check=' || coalesce(with_check, '') from pol where policyname = 'production_tasks_insert'), 'MISSING'),
         exists (select 1 from pol where policyname = 'production_tasks_insert' and cmd = 'INSERT'
                 and roles = '{authenticated}' and with_check ilike '%is_active_staff()%')
  union all
  select 63, 'policy production_tasks_update (UPDATE, authenticated, is_active_staff())', 'exists',
         coalesce((select cmd::text || ' ' || roles || ' using=' || coalesce(qual, '') || ' check=' || coalesce(with_check, '') from pol where policyname = 'production_tasks_update'), 'MISSING'),
         exists (select 1 from pol where policyname = 'production_tasks_update' and cmd = 'UPDATE'
                 and roles = '{authenticated}' and qual ilike '%is_active_staff()%' and with_check ilike '%is_active_staff()%')
  union all
  select 64, 'NO DELETE / ALL policy on production_tasks', 'none',
         coalesce((select string_agg(policyname::text || '(' || cmd::text || ')', ',') from pol where cmd in ('DELETE', 'ALL')), 'none'),
         not exists (select 1 from pol where cmd in ('DELETE', 'ALL'))
  union all
  select 65, 'policy count on production_tasks', '3 (select/insert/update)',
         (select count(*)::text from pol),
         (select count(*) from pol) = 3

  -- ----------------------------------------------------------------- 再生成防止 UNIQUE index
  union all
  select 70, 'unique index production_tasks_unique_recurring (取消済み行を除外していない)',
         'unique, no cancelled_at in predicate',
         coalesce((select pg_get_indexdef(i.indexrelid) from pg_index i
                   join pg_class ic on ic.oid = i.indexrelid
                   where ic.relname = 'production_tasks_unique_recurring'), 'MISSING'),
         exists (select 1 from pg_index i
                 join pg_class ic on ic.oid = i.indexrelid
                 where ic.relname = 'production_tasks_unique_recurring'
                   and i.indrelid = 'public.production_tasks'::regclass
                   and i.indisunique and i.indisvalid
                   and pg_get_indexdef(i.indexrelid) ilike '%(client_id, schedule_rule_id, scheduled_post_date, post_type)%'
                   and pg_get_indexdef(i.indexrelid) not ilike '%cancelled_at%')

  -- ----------------------------------------------------------------- 既存データ整合
  -- （列が未作成でもクエリ全体がエラーにならないよう to_jsonb 経由で参照する）
  union all
  select 80, 'existing rows: cancelled but no reason (should be 0)', '0',
         (select count(*)::text from pt_json where j->>'cancelled_at' is not null and j->>'cancel_reason' is null),
         (select count(*) from pt_json where j->>'cancelled_at' is not null and j->>'cancel_reason' is null) = 0
  union all
  select 81, 'existing rows: cancelled but no staff (should be 0)', '0',
         (select count(*)::text from pt_json where j->>'cancelled_at' is not null and j->>'cancelled_by_staff_id' is null),
         (select count(*) from pt_json where j->>'cancelled_at' is not null and j->>'cancelled_by_staff_id' is null) = 0
  union all
  select 82, 'info: cancelled production_tasks count', '(info)',
         (select count(*)::text from pt_json where j->>'cancelled_at' is not null),
         true
)
select ord, check_name, expected, actual, ok
from checks
union all
select 999, '__SUMMARY__', 'failed=0',
       'total=' || count(*)::text || ' failed=' || (count(*) filter (where not coalesce(ok, false)))::text,
       count(*) filter (where not coalesce(ok, false)) = 0
from checks
order by ord;
