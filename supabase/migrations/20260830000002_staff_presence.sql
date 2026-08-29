-- スタッフの「稼働状況」表示機能。
-- オンライン/オフライン自体はSupabase Realtime Presence（DB非経由）で判定するため
-- このmigrationはオフラインstaffの「最終アクセス」表示専用テーブルと、
-- Realtime Presence(private channel)のAuthorization用RLSポリシーのみを追加する。

-- ---------------------------------------------------------------------------
-- staff_presence: 1スタッフ1行の「最終アクセス時刻」。履歴テーブルではない。
-- ---------------------------------------------------------------------------

create table if not exists public.staff_presence (
  staff_id uuid primary key references public.staff (id) on delete cascade,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.staff_presence enable row level security;

-- 全active staffが閲覧可能（財務情報ではないためis_active_staff()のみで判定）。
drop policy if exists staff_presence_select on public.staff_presence;
create policy staff_presence_select on public.staff_presence
  for select
  to authenticated
  using (public.is_active_staff());

-- 自分自身の行のみ作成・更新可能。current_staff_id()はis_active=trueのstaffのみ
-- 返すため、inactive staffは自分の行も操作できない。
drop policy if exists staff_presence_insert_own on public.staff_presence;
create policy staff_presence_insert_own on public.staff_presence
  for insert
  to authenticated
  with check (staff_id = public.current_staff_id());

drop policy if exists staff_presence_update_own on public.staff_presence;
create policy staff_presence_update_own on public.staff_presence
  for update
  to authenticated
  using (staff_id = public.current_staff_id())
  with check (staff_id = public.current_staff_id());

-- ---------------------------------------------------------------------------
-- Realtime Authorization: staff-presenceトピック専用のprivate channel。
-- 参照: https://supabase.com/docs/guides/realtime/authorization
-- realtime.messagesはデフォルトでRLSが有効なため、ENABLE ROW LEVEL SECURITYは不要
-- （realtimeスキーマはSupabase管理のため、テーブル作成等はできずポリシー追加のみ可能）。
-- 対象トピックを'staff-presence'一つに限定し、is_active_staff()で認証済みactive staff
-- のみに読み書きを許可する（未ログイン・inactiveは参加不可）。
--
-- readポリシーでextension in ('presence','broadcast')が必要な理由: presence専用
-- チャンネルであっても、channel joinの認可チェック自体はbroadcast拡張への読み取り
-- 可否も評価する（実機検証で確認済み。readを'presence'のみに絞ると、認証済み
-- active staffでも "Unauthorized: You do not have permissions to read from this
-- Channel topic" で拒否された。Supabase公式ブログ「Broadcast and Presence
-- Authorization」のサンプルでも同様にread側は
-- extension in ('broadcast', 'presence') としている）。
--
-- writeポリシーはpresenceのみに絞れることも実機で確認済み。broadcast writeまで
-- 許可する必要はなく、insert対象をextension='presence'に限定することで、
-- 認証済みstaffであってもこのトピックでbroadcastメッセージを実際に送信すること
-- はできない（channel.send({type:'broadcast',...})がack無しでタイムアウトする
-- ことを実機確認）。read側はjoin成立のためbroadcastの読み取りだけ許可されるが、
-- 本アプリはこのトピックでbroadcastを一切購読・送信しないため実害はない。
-- 詳細は docs/security.md を参照。
-- ---------------------------------------------------------------------------

drop policy if exists "active staff can read staff-presence" on "realtime"."messages";
create policy "active staff can read staff-presence"
on "realtime"."messages"
for select
to authenticated
using (
  realtime.topic() = 'staff-presence'
  and realtime.messages.extension in ('presence', 'broadcast')
  and (select public.is_active_staff())
);

drop policy if exists "active staff can write staff-presence" on "realtime"."messages";
create policy "active staff can write staff-presence"
on "realtime"."messages"
for insert
to authenticated
with check (
  realtime.topic() = 'staff-presence'
  and realtime.messages.extension = 'presence'
  and (select public.is_active_staff())
);
