"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";
import { buildStaffAuthEmail } from "@/lib/auth/staffEmail";
import { isValidNewPassword, MIN_PASSWORD_LENGTH } from "@/lib/staff/passwordPolicy";
import { logStaffActivity } from "@/lib/staff/activityLog";

export interface ChangePasswordState {
  error: string | null;
  success: boolean;
}

/**
 * 本人によるパスワード変更。service_role/Admin APIは使用せず、本人のSupabase session
 * （createSupabaseServerClient）のみで完結させる。内部email(buildStaffAuthEmail)は
 * 現在パスワードの再検証にのみ使い、UIへは一切表示しない。
 */
export async function changeOwnPasswordAction(
  _prevState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const staff = await getCurrentStaff();
  if (!staff) {
    return { error: "ログインが必要です。", success: false };
  }

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const newPasswordConfirm = String(formData.get("newPasswordConfirm") ?? "");

  if (!currentPassword || !newPassword || !newPasswordConfirm) {
    return { error: "すべての項目を入力してください。", success: false };
  }

  if (!isValidNewPassword(newPassword)) {
    return { error: `新しいパスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください。`, success: false };
  }

  if (newPassword !== newPasswordConfirm) {
    return { error: "新しいパスワード（確認）が一致しません。", success: false };
  }

  if (currentPassword === newPassword) {
    return { error: "現在のパスワードと異なるパスワードを入力してください。", success: false };
  }

  const supabase = await createSupabaseServerClient();
  const email = buildStaffAuthEmail(staff.id);

  // 現在のパスワードが正しいことを、本人のセッションで再ログインして確認する
  // （updateUserは有効なセッションさえあれば現在のパスワードを検証せず変更できてしまうため）。
  const { error: reverifyError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
  if (reverifyError) {
    return { error: "現在のパスワードが正しくありません。", success: false };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    return { error: "パスワードの変更に失敗しました。時間をおいて再度お試しください。", success: false };
  }

  await logStaffActivity({
    actorStaffId: staff.id,
    targetStaffId: staff.id,
    action: "staff_password_self_changed",
  });

  return { error: null, success: true };
}
