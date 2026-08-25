-- スタッフ管理画面の「最終ログイン日時」表示用。ログイン成功時にのみ更新する
-- （更新自体はアプリ側のservice_roleクライアントから行うため、RLSの変更は不要）。

alter table public.staff
  add column if not exists last_login_at timestamptz;
