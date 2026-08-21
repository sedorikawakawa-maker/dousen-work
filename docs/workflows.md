# 3. ステータスと業務フロー

## 制作

### 通常
素材待ち
→ 制作待ち
→ 制作中
→ Wチェック待ち
→ 顧客確認待ち
→ 投稿待ち
→ 完了

### Wチェック修正
Wチェック待ち
→ 修正依頼
→ 制作中
→ Wチェック再登録
→ Wチェック待ち

### 顧客修正
顧客確認待ち
→ 修正依頼
→ 制作中
→ Wチェック登録
→ 顧客確認

## Wチェック登録

制作担当:
1. タスクを開く
2. Wチェック登録
3. 制作物リンクを登録
   - リール: Google Drive動画
   - フィード: Canva
   - ストーリーズ: Canva
4. 必要ならWチェック担当を指定
5. 登録
6. production_tasks.status = `wcheck_waiting`
7. notification生成

## 顧客確認

WチェックOK後:
1. 公式LINE等で送信
2. システム上で「顧客確認依頼済み」
3. client_confirmations 作成
4. production_tasks.status = `client_confirmation_waiting`

顧客OK:
→ `posting_waiting`

修正:
→ `in_production`

## 投稿実績登録

### リール
1. 実投稿
2. 投稿実績登録
3. 完成動画アップロード
4. Google Driveへ格納
5. post_records 作成
6. production_tasks.status = `completed`
7. completed_at を記録

### フィード
1. 実投稿
2. Canvaリンク + 投稿URL登録
3. post_records 作成
4. task 完了

### ストーリーズ
1. 実投稿
2. Canvaリンク or ファイル登録
3. post_records 作成
4. task 完了

## 顧客ステータス

顧客一覧上で手動変更。
制作タスクの状態から自動で強制変更しない。

「素材待ち」に変更:
- clients.current_status = material_waiting
- material_wait_started_at = now()

別状態へ変更:
- material_wait_started_at を必要に応じて null

## 担当変更

主担当変更時:
- clients の assignment履歴を閉じる
- 新しい assignment を作成
- 未完了 production_tasks の assignee を新主担当へ変更
- 過去 post_records の posted_by_staff_id は変更しない
