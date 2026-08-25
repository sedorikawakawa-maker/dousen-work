"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaffManagementAccess } from "@/lib/staff/authGuard";
import { countOtherActiveAdmins, isAdminRole } from "@/lib/staff/queries";
import { generateTempPassword } from "@/lib/staff/tempPassword";
import { logStaffActivity } from "@/lib/staff/activityLog";
import { buildStaffAuthEmail } from "@/lib/auth/staffEmail";
import type { StaffRole } from "@/lib/supabase/database.types";

const STAFF_PATH = "/management/staff";
const ALLOWED_ROLES: readonly string[] = ["president", "executive", "employee", "part_time"];

function isValidRole(value: string): value is StaffRole {
  return ALLOWED_ROLES.includes(value);
}

function errorRedirect(message: string): never {
  redirect(`${STAFF_PATH}?error=${encodeURIComponent(message)}`);
}

/** 仮パスワード発行を伴う操作の結果。URL・DB・ログのいずれにも残さず、戻り値としてのみ一度だけ渡す。 */
export interface TempPasswordActionState {
  error: string | null;
  result: { staffName: string; tempPassword: string } | null;
}

/**
 * スタッフ追加。既存scripts/create-staff.mjsと同じ方式（Auth作成→staff insert、失敗時はAuthをロールバック）。
 * 仮パスワードはURL query parameterへ含めない（ブラウザ履歴・アクセスログ等への残留を防ぐため）。
 * useActionStateでClient Componentから呼び出し、戻り値として一度だけ受け渡す。
 */
export async function createStaffAction(
  _prevState: TempPasswordActionState,
  formData: FormData,
): Promise<TempPasswordActionState> {
  const actor = await requireStaffManagementAccess();

  const lastName = String(formData.get("lastName") ?? "").trim();
  const firstName = String(formData.get("firstName") ?? "").trim();
  const roleRaw = String(formData.get("role") ?? "");

  if (!lastName || !firstName || !isValidRole(roleRaw)) {
    return { error: "姓・名・roleを正しく入力してください", result: null };
  }
  const role = roleRaw;

  const admin = createSupabaseAdminClient();
  const staffId = crypto.randomUUID();
  const email = buildStaffAuthEmail(staffId);
  const tempPassword = generateTempPassword();

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });

  if (authError || !authUser?.user) {
    return { error: "スタッフアカウントの作成に失敗しました", result: null };
  }

  const { error: insertError } = await admin.from("staff").insert({
    id: staffId,
    auth_user_id: authUser.user.id,
    last_name: lastName,
    first_name: firstName,
    role,
  });

  if (insertError) {
    // Authユーザーだけが残る不整合を防ぐための補償ロールバック。
    await admin.auth.admin.deleteUser(authUser.user.id);
    return { error: "スタッフの登録に失敗しました", result: null };
  }

  await logStaffActivity({
    actorStaffId: actor.id,
    targetStaffId: staffId,
    action: "staff_created",
    afterData: { last_name: lastName, first_name: firstName, role },
  });

  revalidatePath(STAFF_PATH);

  return { error: null, result: { staffName: `${lastName} ${firstName}`, tempPassword } };
}

/** 姓・名・roleの編集。自分自身をpresident/executiveから外す変更、最後の管理者を外す変更は拒否する。 */
export async function updateStaffProfileAction(formData: FormData) {
  const actor = await requireStaffManagementAccess();

  const targetId = String(formData.get("staffId") ?? "");
  const lastName = String(formData.get("lastName") ?? "").trim();
  const firstName = String(formData.get("firstName") ?? "").trim();
  const roleRaw = String(formData.get("role") ?? "");

  if (!targetId || !lastName || !firstName || !isValidRole(roleRaw)) {
    errorRedirect("入力内容を確認してください");
  }
  const role = roleRaw;

  const supabase = await createSupabaseServerClient();
  const { data: target, error: fetchError } = await supabase
    .from("staff")
    .select("id, last_name, first_name, role")
    .eq("id", targetId)
    .maybeSingle();

  if (fetchError || !target) {
    errorRedirect("対象のスタッフが見つかりません");
  }

  const isSelf = target.id === actor.id;
  const losingAdminRole = isAdminRole(target.role) && !isAdminRole(role);

  if (isSelf && losingAdminRole) {
    errorRedirect("自分自身の権限をpresident/executiveから外すことはできません");
  }

  if (losingAdminRole) {
    const remaining = await countOtherActiveAdmins(supabase, target.id);
    if (remaining === 0) {
      errorRedirect("最後の管理者（president/executive）のroleは変更できません");
    }
  }

  const { error: updateError } = await supabase
    .from("staff")
    .update({ last_name: lastName, first_name: firstName, role })
    .eq("id", targetId);

  if (updateError) {
    errorRedirect("更新に失敗しました");
  }

  if (target.last_name !== lastName || target.first_name !== firstName) {
    await logStaffActivity({
      actorStaffId: actor.id,
      targetStaffId: targetId,
      action: "staff_profile_updated",
      beforeData: { last_name: target.last_name, first_name: target.first_name },
      afterData: { last_name: lastName, first_name: firstName },
    });
  }

  if (target.role !== role) {
    await logStaffActivity({
      actorStaffId: actor.id,
      targetStaffId: targetId,
      action: "staff_role_changed",
      beforeData: { role: target.role },
      afterData: { role },
    });
  }

  redirect(`${STAFF_PATH}?updated=1`);
}

/** 退職処理（is_active=falseのみ。物理DELETEは行わない）。自分自身、最後の管理者は拒否する。 */
export async function deactivateStaffAction(formData: FormData) {
  const actor = await requireStaffManagementAccess();
  const targetId = String(formData.get("staffId") ?? "");

  if (!targetId) {
    errorRedirect("対象が指定されていません");
  }
  if (targetId === actor.id) {
    errorRedirect("自分自身を退職処理することはできません");
  }

  const supabase = await createSupabaseServerClient();
  const { data: target, error: fetchError } = await supabase
    .from("staff")
    .select("id, role, is_active")
    .eq("id", targetId)
    .maybeSingle();

  if (fetchError || !target) {
    errorRedirect("対象のスタッフが見つかりません");
  }

  if (!target.is_active) {
    redirect(`${STAFF_PATH}?updated=1`);
  }

  if (isAdminRole(target.role)) {
    const remaining = await countOtherActiveAdmins(supabase, target.id);
    if (remaining === 0) {
      errorRedirect("最後の管理者（president/executive）を退職処理することはできません");
    }
  }

  const { error: updateError } = await supabase.from("staff").update({ is_active: false }).eq("id", targetId);
  if (updateError) {
    errorRedirect("退職処理に失敗しました");
  }

  await logStaffActivity({ actorStaffId: actor.id, targetStaffId: targetId, action: "staff_deactivated" });

  redirect(`${STAFF_PATH}?deactivated=1`);
}

/** 再有効化（is_active=true）。既存Authユーザー・既存パスワードのまま再ログイン可能になる。 */
export async function reactivateStaffAction(formData: FormData) {
  const actor = await requireStaffManagementAccess();
  const targetId = String(formData.get("staffId") ?? "");

  if (!targetId) {
    errorRedirect("対象が指定されていません");
  }

  const supabase = await createSupabaseServerClient();
  const { error: updateError } = await supabase.from("staff").update({ is_active: true }).eq("id", targetId);
  if (updateError) {
    errorRedirect("再有効化に失敗しました");
  }

  await logStaffActivity({ actorStaffId: actor.id, targetStaffId: targetId, action: "staff_reactivated" });

  redirect(`${STAFF_PATH}?reactivated=1`);
}

/**
 * 仮パスワード再発行。DBには一切保存せず、戻り値として一度だけ渡す
 * （URL query parameterへは含めない。useActionStateでClient Componentから呼び出す）。
 */
export async function resetStaffPasswordAction(
  _prevState: TempPasswordActionState,
  formData: FormData,
): Promise<TempPasswordActionState> {
  const actor = await requireStaffManagementAccess();
  const targetId = String(formData.get("staffId") ?? "");

  if (!targetId) {
    return { error: "対象が指定されていません", result: null };
  }

  const admin = createSupabaseAdminClient();
  const { data: target, error: fetchError } = await admin
    .from("staff")
    .select("id, auth_user_id, last_name, first_name")
    .eq("id", targetId)
    .maybeSingle();

  if (fetchError || !target) {
    return { error: "対象のスタッフが見つかりません", result: null };
  }

  const tempPassword = generateTempPassword();
  const { error: updateError } = await admin.auth.admin.updateUserById(target.auth_user_id, {
    password: tempPassword,
  });

  if (updateError) {
    return { error: "仮パスワードの発行に失敗しました", result: null };
  }

  await logStaffActivity({ actorStaffId: actor.id, targetStaffId: targetId, action: "staff_password_reset" });

  revalidatePath(STAFF_PATH);

  return { error: null, result: { staffName: `${target.last_name} ${target.first_name}`, tempPassword } };
}
