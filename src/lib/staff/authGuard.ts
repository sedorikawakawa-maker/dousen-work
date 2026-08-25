import "server-only";
import { redirect } from "next/navigation";
import { getCurrentStaff, type CurrentStaff } from "@/lib/auth/session";
import { canManageStaff } from "@/lib/auth/roles";

/**
 * スタッフ管理（一覧閲覧含む）で共通に使う権限チェック。
 * president / executiveのみ許可し、employee / part_timeおよび未ログインは弾く
 * （既存のcanAccessManagementFeaturesより厳しい、staff_write_admin RLSと同じ基準）。
 * 各server actionで個別に条件を書かず、必ずこの関数経由でチェックする。
 */
export async function requireStaffManagementAccess(): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }
  if (!canManageStaff(staff.role)) {
    redirect("/");
  }
  return staff;
}
