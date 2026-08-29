# 6. セキュリティ仕様

## 認証

Supabase Auth。
各スタッフ個別アカウント。

ユーザーUIは姓・名・パスワードを想定するが、Auth内部では email 等の一意識別子が必要になる場合がある。
その場合はユーザーに見せない内部用ログインIDを生成してよい。

## RLS

最低限:
- 認証済みスタッフのみ業務データ閲覧可
- `staff.role = part_time` の場合、料金・売上を取得させない
- 外注フォームは専用トークン経由の限定エンドポイント
- 外注トークンはDBに平文保存せず hash 保存
- token expiry を持たせる

## 顧客ログイン情報

禁止:
- SNSパスワードの平文保存
- ブラウザlocalStorageへの保存
- ログへの出力

保存可能:
- login_id
- password_vault_url
- last_updated_at

推奨:
1Password 等の外部安全保管先。

## Google Drive

OAuth token / refresh token はサーバー側のみ。
ブラウザへ露出させない。

## Realtime Presence（稼働状況）

`staff-presence` トピックのみを対象に、`realtime.messages` へRLSポリシーを追加し、
active staff以外（未ログイン・inactive）がpresenceの読み書きに参加できないようにする。
channelは必ず `private: true` で作成し、公開アクセスに依存しない。
Presence payloadに email・synthetic email・auth_user_id等の秘匿情報は含めない
（staff_id・display_nameのみ）。実機で未認証・inactive staffとも参加不可であることを確認済み。

**read側でbroadcast拡張も許可している理由**: presence専用チャンネルであっても、
channel join時の認可チェック自体がbroadcast拡張への読み取り可否も評価するため
（実機で確認済み。read側を`extension = 'presence'`のみに絞ると、認証済みactive
staffでもjoinそのものが拒否された。Supabase公式の実装例でも同様にread側は
`extension in ('broadcast', 'presence')`としている）。**write(insert)側は
`extension = 'presence'`のみに絞っており、broadcast writeは許可していない**
（実機で、認証済みstaffがこのトピックへ`channel.send({type:'broadcast',...})`
してもack無しでタイムアウトし、実際には送信できないことを確認済み）。
トピックを`staff-presence`一つに固定しているため万一broadcast readが悪用されても
影響範囲は同じ社内staffが集まる稼働状況チャンネル内に限られ、かつアプリ側は
このトピックでbroadcastイベントを一切購読していないため実害はないと判断した。

## 操作履歴

以下は activity_logs:
- 料金変更
- 担当変更
- 契約状態変更
- 投稿ルール変更
- 顧客ステータス変更
- credential metadata変更
