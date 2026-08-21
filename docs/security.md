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

## 操作履歴

以下は activity_logs:
- 料金変更
- 担当変更
- 契約状態変更
- 投稿ルール変更
- 顧客ステータス変更
- credential metadata変更
