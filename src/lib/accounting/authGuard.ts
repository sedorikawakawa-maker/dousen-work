import "server-only";
import { redirect } from "next/navigation";
import { getCurrentStaff, type CurrentStaff } from "@/lib/auth/session";
import { canViewFinance } from "@/lib/auth/roles";

/**
 * 経理機能（書類BOX・経費等）で共通に使う権限チェック。
 * @/lib/billing/authGuardのrequireBillingAccessと判定基準は同じ（canViewFinance）だが、
 * 呼び出し元の意図を明確にするため別名で公開する
 * （canAccessManagementFeatures/canViewFinanceと同じ考え方）。
 */
export async function requireAccountingAccess(): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }
  if (!canViewFinance(staff.role)) {
    redirect("/");
  }
  return staff;
}
