# DOUSEN WORK

SNS運用・投稿制作を中心とした社内業務管理システム。仕様は `CLAUDE.md` と `docs/` を参照。

## 読む順番

1. `CLAUDE.md`
2. `docs/requirements.md`
3. `docs/database.md`
4. `docs/workflows.md`
5. `docs/automation-rules.md`
6. `docs/ui-spec.md`
7. `docs/security.md`
8. `docs/implementation-plan.md`

## 重要

- 既存のシフト申請システムとは別アプリとして構築する。
- 本番候補構成は Next.js + Supabase + Netlify。
- 顧客のログインパスワードを平文保存しない。
- PC / スマホ双方で実運用する。
- 顧客素材、完成動画は Google Drive をファイル保管先として利用する想定。
- Canva はリンク連携。
- 外注先は DOUSEN WORK へログインさせず、専用アップロードフォームを利用する。

## 開発

```bash
npm install
npm run dev      # http://localhost:3000
npm run lint
npm run typecheck
npm run build
```

環境変数は `.env.local.example` を参照し、`.env.local` を作成すること（コミット禁止）。

## Supabase migration

```bash
supabase db push   # または supabase/migrations 配下を対象環境に適用
```

## スタッフアカウント作成（暫定CLI・Phase1）

スタッフ管理画面が実装されるまでの暫定手段。`SUPABASE_SERVICE_ROLE_KEY` を含む `.env.local` が必要。

```bash
node --env-file=.env.local scripts/create-staff.mjs \
  --lastName 姓 --firstName 名 --role president --password "強力なパスワード"
```

role は `president` / `executive` / `employee` / `part_time` のいずれか。
ログイン画面では姓・名・パスワードのみを入力する（Auth用メールは内部生成のため非表示）。
