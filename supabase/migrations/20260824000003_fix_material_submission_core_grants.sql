-- _create_material_submission_core は権限チェックを一切行わない内部専用関数であり、
-- 2つの公開ラッパー(create_material_submission / create_client_material_submission)経由
-- でのみ呼ばれる前提だが、Supabaseの新規関数への自動デフォルト権限付与により
-- anon/authenticatedへ意図せずEXECUTE権限が付与されていたため、明示的に取り消す。

revoke execute on function public._create_material_submission_core(
  uuid, uuid, text, text, text, text, text, text, date, text, text, text, jsonb
) from anon;

revoke execute on function public._create_material_submission_core(
  uuid, uuid, text, text, text, text, text, text, date, text, text, text, jsonb
) from authenticated;
