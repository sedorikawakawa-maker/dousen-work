# 4. 自動処理ルール

## 定期タスク生成

### 基本
posting_schedule_rules から production_tasks を自動生成。

### 「常に反映」の実装
無限未来まで作らない。
常に現在月 + 2か月先、合計3か月を生成済みに保つ。

例:
8月 → 8/9/10月
9月になったら11月を追加。

重複生成防止:
- client_id
- schedule_rule_id
- scheduled_post_date
- post_type
の組み合わせを基準に idempotent に生成。

## ルール変更

顧客の投稿ルール変更時:
- 既に制作開始済み / Wチェック以降のタスクは変更しない
- 未着手の未来タスクのみ再計算
- 単発の日付変更済みタスクは上書きしない

## 1件だけ日付変更

カレンダーで特定 production_task の `scheduled_post_date` のみ変更。
`posting_schedule_rules` は変更しない。

## 持越し

月末時点で未完了の recurring production_task:
- 元タスクの source_month は保持
- is_carryover = true
- 翌月カレンダーにも表示
- 翌月の通常目標には含めず、必要本数表示では加算

例:
8月目標4、3完了、1未完了
→ 8月実績 3/4、未達1
→ 9月 通常4 + 持越し1 = 必要5

## 月間集計

target:
posting_schedule_rules.monthly_target

actual:
post_records の投稿完了数

carryover:
前月以前 source_month の未完了 recurring task 数

表示:
今月通常目標 + 持越し / 投稿実績

## 素材待ち

clients.current_status が素材待ちになった時:
- material_wait_started_at を記録

通知・催促画面:
- 7日以上: 黄色
- 14日以上: 赤
- 14日以上は催促候補上位

素材が届いても自動解除は必須ではない。
担当者が内容を確認して状態変更できる。

## 顧客確認待ち

client_confirmations.status = waiting の経過日数で色分け。

- 14日以上: 赤 / 最優先催促
- 14日未満: 段階色分け可能

文章内容は保存しない。

## Wチェック

Wチェック登録時:
- w_checks 作成
- task status = wcheck_waiting
- reviewer指定あり: 指定スタッフへ通知
- reviewer指定なし: Wチェック待ち一覧へ掲載

approved:
- taskを顧客確認へ進められる状態にする

revision_requested:
- task status = in_production

## 投稿実績登録

post_records 作成成功後:
- production_tasks.status = completed
- completed_at = now()

リール:
- Drive格納成功後に post_records を確定
- Drive失敗時は task を完了にしない

## 外注納品

外注フォーム送信:
- outsourcing_deliveries 作成
- outsourcing_requests.status = delivered
- 社内担当へ notification

## 通知

システム内のみ。
主な通知:
- 新着素材
- Wチェック依頼
- Wチェック修正
- WチェックOK
- 顧客確認14日
- 外注納品
- 今日締切
