import "server-only";
import { redirect } from "next/navigation";
import { getCurrentStaff, type CurrentStaff } from "@/lib/auth/session";
import { canAccessManagementFeatures } from "@/lib/auth/roles";

/**
 * Google Drive連携の設定操作（OAuth開始/callback/接続テスト/再接続/連携解除/
 * root folder作成・変更）で共通に使う管理者チェック。
 * president / executive / employee のみ許可し、part_timeおよび未ログインは弾く。
 * 各server actionで個別に条件を書かず、必ずこの関数経由でチェックする。
 */
export async function requireDriveSettingsAccess(): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }
  if (!canAccessManagementFeatures(staff.role)) {
    redirect("/");
  }
  return staff;
}
