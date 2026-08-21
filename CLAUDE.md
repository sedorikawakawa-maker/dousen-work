# DOUSEN WORK — Claude Code 実装指示

あなたは DOUSEN WORK の実装担当です。
このプロジェクトでは「制作工程を流す業務OS」を作ります。

## 最優先原則

1. UIを作るだけではなく、Supabase DB と実データ連携まで実装する。
2. 既存仕様にない機能を勝手に増やさない。
3. 顧客パスワードを平文保存しない。
4. 投稿スケジュールのルールと、実際に生成された制作タスクを分離する。
5. 過去実績は書き換えず履歴として残す。
6. 前月未達は翌月へ持ち越すが、前月が未達だった事実は保持する。
7. PC・スマホ双方で使いやすくする。
8. パートは料金・売上のみ閲覧不可。それ以外は基本閲覧可能。
9. Wチェックは全スタッフが可能。担当者指定も可能。
10. 投稿完了は「実際の投稿 + 投稿実績登録」が済んだ時点。

## 技術スタック

- Next.js App Router
- TypeScript
- Supabase
  - Auth
  - Postgres
  - Row Level Security
- Netlify
- Google Drive API/連携は段階実装
- Canva は URL 管理
- CSS はシンプルで保守性の高い構成。必要なら Tailwind を採用可。

## 開発の進め方

- まず `docs/database.md` に基づいて migration SQL を作成。
- 次に Auth / staff / role 制御。
- その後、顧客 → 投稿スケジュール → 制作タスク → Wチェック → 顧客確認 → 投稿実績の縦串を1本完成させる。
- その後、通知・催促・持越し・外注・社内タスクへ広げる。
- 各フェーズで lint / typecheck / build を実行。
- 破壊的変更の前には必ず migration を作る。

## 実装時に確認が必要なもの

以下は秘密情報なのでユーザーからコード内へ直接貼らせないこと。
- Supabase secret/service_role
- Google Drive OAuth client secret
- 本番用シークレット

公開可能なクライアント用環境変数とサーバー専用環境変数を分離する。
