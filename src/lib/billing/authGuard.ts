import "server-only";
import { redirect } from "next/navigation";
import { getCurrentStaff, type CurrentStaff } from "@/lib/auth/session";
import { canViewFinance } from "@/lib/auth/roles";

/**
 * 請求・売上機能で共通に使う権限チェック。
 * president / executive / employee のみ許可し、part_timeおよび未ログインは弾く。
 * 各server actionで個別に条件を書かず、必ずこの関数経由でチェックする。
 */
export async function requireBillingAccess(): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }
  if (!canViewFinance(staff.role)) {
    redirect("/");
  }
  return staff;
}
