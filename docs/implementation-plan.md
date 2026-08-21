# 7. 実装ロードマップ

## Phase 0 — セットアップ
- Next.js + TypeScript
- Supabase client
- env
- lint / typecheck / build
- GitHub / Netlify

## Phase 1 — DB & Auth
- migration作成
- staff
- role
- Supabase Auth
- RLS
- 個別ログイン

完了条件:
役割別にログインでき、パートから料金・売上が見えない。

## Phase 2 — 顧客
- 顧客一覧
- 顧客検索
- 顧客登録
- 顧客詳細
- 顧客編集
- 主担当 / 副担当
- 制作方針
- links
- credentials metadata

完了条件:
既存顧客を1画面で参照・編集可能。

## Phase 3 — 投稿ルール & 自動生成
- posting_schedule_rules
- production_tasks
- 3か月ローリング生成
- 1件日付変更
- 月間目標
- 持越し

完了条件:
顧客登録だけで制作予定が自動生成される。

## Phase 4 — 担当者ダッシュボード
- 今日やること
- 担当顧客一覧
- inline status edit
- 月間進捗
- 次アクション

## Phase 5 — 素材
- 顧客向け素材フォーム
- materials
- Drive連携
- 新着通知
- 素材待ちアラート

## Phase 6 — Wチェック
- Wチェック登録
- 待ち一覧
- reviewer任意
- OK
- 修正依頼
- 通知

## Phase 7 — 顧客確認
- 確認依頼済み
- waiting / approved / revision
- 14日催促
- reminder_logs

## Phase 8 — 投稿実績
- リールフォーム
- フィードフォーム
- ストーリーズフォーム
- リールのDrive動画格納統合
- post_records
- task complete

## Phase 9 — 管理
- 管理ダッシュボード
- 担当別進捗
- 通知
- 催促
- 未達 / 持越し

## Phase 10 — 外注
- outsourcing_requests
- signed/tokenized upload URL
- 外注アップロードフォーム
- 納品通知

## Phase 11 — 社内タスク
- internal_tasks
- 顧客紐づきあり / なし
- 社長 / 社員向け

## Phase 12 — 仕上げ
- responsive
- error states
- loading
- empty states
- audit log
- E2E tests
- production migration

## Claude Codeへの実装指示

各Phaseごとに:
1. 実装計画を短く出す
2. migration
3. UI/API実装
4. lint
5. typecheck
6. build
7. 主要フローのテスト
8. git diff要約

一度に全Phaseを変更せず、小さいコミットで進める。
