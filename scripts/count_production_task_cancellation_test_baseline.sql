-- =============================================================================
-- count_production_task_cancellation_test_baseline.sql
--
-- 用途: test_production_task_cancellation_rollback.sql の実行「前」と「後」に
--       同じものを実行し、件数が完全に一致すること（= ROLLBACK で何も残っていないこと）を確認する。
--
-- ・SELECT のみ（read-only）。1 回の実行で 1 行に全件数を返す。
-- ・migration 適用前でもエラーにならないよう、cancelled_at 系は to_jsonb 経由で参照する。
-- ・zztest_* 列はテスト fixture（client_code / staff.last_name / task・post_record の title /
--   email に 'ZZTEST-PTC-'、w_checks.asset_url に 'zztest-' を含む）の残存件数。実行前後とも 0 であること。
-- ・対象 migration: 20261026000001 / 20261118000001（全status取消対応）。
-- =============================================================================

select
  now() as checked_at,

  -- 最低限の比較対象
  (select count(*) from public.production_tasks) as production_tasks,
  (select count(*) from public.activity_logs)    as activity_logs,
  (select count(*) from public.clients)          as clients,
  (select count(*) from public.staff)            as staff,

  -- 補助（テストで fixture を作成するテーブル）
  (select count(*) from public.posting_schedule_rules) as posting_schedule_rules,
  (select count(*) from auth.users)                    as auth_users,
  (select count(*) from public.w_checks)               as w_checks,
  (select count(*) from public.client_confirmations)   as client_confirmations,
  (select count(*) from public.post_records)           as post_records,

  -- 取消関連（制作タスク取消 / 投稿実績取消）
  (select count(*) from public.production_tasks pt
    where to_jsonb(pt)->>'cancelled_at' is not null)  as production_tasks_cancelled,
  (select count(*) from public.activity_logs
    where action = 'production_task_cancelled')       as activity_logs_production_task_cancelled,
  (select count(*) from public.post_records
    where cancelled_at is not null)                   as post_records_cancelled,
  (select count(*) from public.activity_logs
    where action = 'post_record_cancelled')           as activity_logs_post_record_cancelled,

  -- 変更検知用（最終更新・最終作成時刻。前後で変わらないこと）
  (select max(updated_at) from public.production_tasks) as production_tasks_max_updated_at,
  (select max(created_at) from public.activity_logs)    as activity_logs_max_created_at,

  -- テスト fixture の残存（常に 0 であること）
  (select count(*) from public.clients where client_code like 'ZZTEST-PTC-%')       as zztest_clients,
  (select count(*) from public.staff where last_name like 'ZZTEST-PTC-%')           as zztest_staff,
  (select count(*) from public.production_tasks where title like 'ZZTEST-PTC-%')    as zztest_production_tasks,
  (select count(*) from public.post_records where title like 'ZZTEST-PTC-%')        as zztest_post_records,
  (select count(*) from public.w_checks where asset_url like 'https://example.invalid/zztest-%') as zztest_w_checks,
  (select count(*) from auth.users where email like 'zztest-ptc-%@example.invalid') as zztest_auth_users;
