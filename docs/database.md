# 2. Supabase DB設計 v1

## 共通方針

- PK は原則 UUID
- `created_at`, `updated_at` を基本付与
- 論理削除が必要なマスタは `is_active`
- 重要変更は `activity_logs` に記録
- 過去実績は上書きしない

---

## staff

| column | type | note |
|---|---|---|
| id | uuid PK | |
| auth_user_id | uuid unique | Supabase Auth |
| last_name | text | 姓 |
| first_name | text | 名 |
| role | text | president / executive / employee / part_time |
| is_active | boolean | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

料金閲覧可否は role から判定。

---

## clients

| column | type | note |
|---|---|---|
| id | uuid PK | |
| client_code | text unique | D00028 等 |
| company_name | text | |
| shop_name | text nullable | |
| phone | text nullable | |
| email | text nullable | |
| contact_name | text nullable | |
| industry | text nullable | |
| inflow_channel | text nullable | |
| contact_method | text nullable | |
| contract_status | text | contracted / proposal / paused / ended 等 |
| current_status | text | 顧客全体の状態 |
| contract_start_date | date nullable | |
| contract_end_date | date nullable | |
| notes | text nullable | |
| revenue_amount | numeric nullable | パート非表示 |
| fee_amount | numeric nullable | パート非表示 |
| material_wait_started_at | timestamptz nullable | 素材待ち開始 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

---

## client_assignments

| column | type |
|---|---|
| id | uuid PK |
| client_id | uuid FK clients |
| staff_id | uuid FK staff |
| assignment_type | text (`primary`, `secondary`) |
| active_from | date |
| active_to | date nullable |
| created_at | timestamptz |

---

## client_operation_profiles

| column | type |
|---|---|
| id | uuid PK |
| client_id | uuid FK unique |
| purpose | text nullable |
| target_audience | text nullable |
| content_direction | text nullable |
| tone | text nullable |
| cta_policy | text nullable |
| ng_notes | text nullable |
| reference_accounts | text nullable |
| hashtag_policy | text nullable |
| hearing_sheet_url | text nullable |
| created_at | timestamptz |
| updated_at | timestamptz |

---

## client_links

| column | type |
|---|---|
| id | uuid PK |
| client_id | uuid FK |
| link_type | text |
| label | text nullable |
| url | text |
| created_at | timestamptz |
| updated_at | timestamptz |

link_type例:
instagram, tiktok, youtube, website, drive_root, canva_feed, canva_story, canva_thumbnail, official_line, material_form

---

## client_credentials

平文パスワード保存禁止。

| column | type |
|---|---|
| id | uuid PK |
| client_id | uuid FK |
| service_name | text |
| login_id | text nullable |
| password_vault_url | text nullable |
| last_updated_at | timestamptz nullable |
| notes | text nullable |
| created_at | timestamptz |
| updated_at | timestamptz |

---

## service_plans

顧客の契約サービス。

| column | type |
|---|---|
| id | uuid PK |
| client_id | uuid FK |
| service_name | text |
| is_active | boolean |
| start_date | date nullable |
| end_date | date nullable |
| created_at | timestamptz |

---

## posting_schedule_rules

定期投稿ルール。

| column | type |
|---|---|
| id | uuid PK |
| client_id | uuid FK |
| post_type | text (`reel`,`feed`,`story`) |
| monthly_target | integer |
| weekday_rule | jsonb |
| production_lead_days | integer nullable |
| wcheck_lead_days | integer nullable |
| client_confirm_lead_days | integer nullable |
| valid_from | date |
| valid_to | date nullable |
| is_active | boolean |
| created_at | timestamptz |
| updated_at | timestamptz |

`weekday_rule` は将来拡張を考え JSONB。
例:
`{"mode":"weekly","weekdays":[2]}`
`{"mode":"nth_weekday","rules":[{"nth":1,"weekday":4},{"nth":3,"weekday":4}]}`

---

## production_tasks

| column | type |
|---|---|
| id | uuid PK |
| client_id | uuid FK |
| schedule_rule_id | uuid FK nullable |
| post_type | text |
| task_kind | text (`recurring`,`spot`) |
| source_month | date | 本来どの月の義務か |
| scheduled_post_date | date nullable |
| original_scheduled_post_date | date nullable |
| status | text |
| assignee_staff_id | uuid FK staff |
| secondary_staff_id | uuid FK staff nullable |
| title | text |
| production_start_date | date nullable |
| wcheck_due_date | date nullable |
| client_confirm_due_date | date nullable |
| is_carryover | boolean default false |
| carried_from_task_id | uuid FK nullable |
| started_at | timestamptz nullable |
| completed_at | timestamptz nullable |
| work_minutes | integer nullable |
| notes | text nullable |
| created_at | timestamptz |
| updated_at | timestamptz |

重要:
`source_month` は持越し後も変更しない。
これにより「8月未達」を9月に実行しても、8月分として追跡可能。

---

## materials

| column | type |
|---|---|
| id | uuid PK |
| client_id | uuid FK |
| title | text |
| post_usage | text nullable |
| requested_post_timing | text nullable |
| editing_instructions | text nullable |
| caption_instructions | text nullable |
| contact_notes | text nullable |
| shot_date | date nullable |
| received_at | timestamptz |
| drive_file_id | text nullable |
| drive_url | text nullable |
| submitted_by_type | text default `client` |
| created_at | timestamptz |

---

## w_checks

| column | type |
|---|---|
| id | uuid PK |
| production_task_id | uuid FK |
| requested_by_staff_id | uuid FK |
| reviewer_staff_id | uuid FK nullable |
| asset_type | text (`drive_video`,`canva`) |
| asset_url | text |
| status | text (`waiting`,`approved`,`revision_requested`) |
| revision_comment | text nullable |
| requested_at | timestamptz |
| reviewed_at | timestamptz nullable |
| created_at | timestamptz |

再登録時は新しい w_checks 行を作成して履歴保持。
差し戻し回数をUI集計する必要はない。

---

## client_confirmations

| column | type |
|---|---|
| id | uuid PK |
| production_task_id | uuid FK |
| requested_by_staff_id | uuid FK |
| status | text (`waiting`,`approved`,`revision_requested`) |
| requested_at | timestamptz |
| responded_at | timestamptz nullable |
| revision_comment | text nullable |
| created_at | timestamptz |

---

## post_records

| column | type |
|---|---|
| id | uuid PK |
| production_task_id | uuid FK nullable |
| client_id | uuid FK |
| post_type | text |
| posted_at | timestamptz |
| posted_by_staff_id | uuid FK |
| title | text nullable |
| social_post_url | text nullable |
| canva_url | text nullable |
| final_drive_file_id | text nullable |
| final_drive_url | text nullable |
| source_material_id | uuid FK nullable |
| created_at | timestamptz |

---

## outsourcing_requests

| column | type |
|---|---|
| id | uuid PK |
| client_id | uuid FK nullable |
| production_task_id | uuid FK nullable |
| title | text |
| contractor_name | text |
| instruction | text |
| requested_at | timestamptz |
| due_date | date nullable |
| upload_token_hash | text |
| token_expires_at | timestamptz nullable |
| status | text |
| created_by_staff_id | uuid FK |
| created_at | timestamptz |

---

## outsourcing_deliveries

| column | type |
|---|---|
| id | uuid PK |
| outsourcing_request_id | uuid FK |
| drive_file_id | text nullable |
| drive_url | text nullable |
| contractor_note | text nullable |
| delivered_at | timestamptz |
| created_at | timestamptz |

---

## internal_tasks

| column | type |
|---|---|
| id | uuid PK |
| client_id | uuid FK nullable |
| assignee_staff_id | uuid FK |
| category | text |
| title | text |
| description | text nullable |
| priority | text (`A`,`B`,`C`) |
| status | text (`not_started`,`in_progress`,`done`) |
| due_at | timestamptz nullable |
| attachment_url | text nullable |
| created_at | timestamptz |
| updated_at | timestamptz |

---

## notifications

| column | type |
|---|---|
| id | uuid PK |
| recipient_staff_id | uuid FK |
| notification_type | text |
| title | text |
| body | text nullable |
| entity_type | text nullable |
| entity_id | uuid nullable |
| is_read | boolean |
| created_at | timestamptz |

---

## reminder_logs

| column | type |
|---|---|
| id | uuid PK |
| client_id | uuid FK |
| production_task_id | uuid FK nullable |
| reminder_type | text (`material`,`client_confirmation`) |
| reminded_by_staff_id | uuid FK |
| reminded_at | timestamptz |
| note | text nullable |

---

## activity_logs

| column | type |
|---|---|
| id | uuid PK |
| actor_staff_id | uuid FK nullable |
| entity_type | text |
| entity_id | uuid |
| action | text |
| before_data | jsonb nullable |
| after_data | jsonb nullable |
| created_at | timestamptz |

重要変更のみ記録:
- 担当変更
- 契約状況
- 投稿ルール
- 顧客ステータス
- ログインID / 保管先
- 料金・売上
