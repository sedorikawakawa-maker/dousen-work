import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type StaffActivityAction =
  | "staff_created"
  | "staff_profile_updated"
  | "staff_role_changed"
  | "staff_deactivated"
  | "staff_reactivated"
  | "staff_password_reset"
  | "staff_password_self_changed";

/**
 * スタッフ管理操作の監査ログ。activity_logsへの書込は既存の設計上トリガー経由のみ許可されており
 * （authenticatedへのINSERTポリシーは存在しない）、認証済みクライアントからは直接書き込めない。
 * スタッフ作成・パスワード再発行はSupabase Auth Admin APIを伴い元々service_role必須のため、
 * 監査ログの記録もservice_role（admin client）で統一する。パスワードそのものは記録しない。
 */
export async function logStaffActivity(params: {
  actorStaffId: string;
  targetStaffId: string;
  action: StaffActivityAction;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.from("activity_logs").insert({
    actor_staff_id: params.actorStaffId,
    entity_type: "staff",
    entity_id: params.targetStaffId,
    action: params.action,
    before_data: params.beforeData ?? null,
    after_data: params.afterData ?? null,
  });
}
