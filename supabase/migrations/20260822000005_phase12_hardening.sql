-- Phase 12: 本番前の総仕上げ（データ整合性の補強）
-- 二重送信等により同一タスクに複数の有効なpost_recordsが作成されると、
-- 月間実績集計が不正確になるため、タスクごとに有効な実績は1件のみに制限する。
-- （取消済み(cancelled_at is not null)は履歴として複数残ってよい）

create unique index if not exists post_records_one_active_per_task
  on public.post_records (production_task_id)
  where cancelled_at is null and production_task_id is not null;
