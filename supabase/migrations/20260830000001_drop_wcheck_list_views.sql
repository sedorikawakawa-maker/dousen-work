-- Wチェック待ちバッジの仕様変更: staff別「新着」管理(last_viewed_atカーソル)を廃止し、
-- 全staff共通の現在waiting件数を表示する方式へ変更したため、新着管理専用だった
-- wcheck_list_views は不要になった。他のどのテーブル・機能からも参照されていないことを
-- 確認済み（コード上の参照はSidebarバッジ機能のみで、今回すべて削除した）。
-- 既存の適用済みmigration(20260829000001_wcheck_list_views.sql)は書き換えず、
-- 新規migrationでdropする。

drop table if exists public.wcheck_list_views;
