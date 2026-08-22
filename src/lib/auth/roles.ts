import type { StaffRole } from "@/lib/supabase/database.types";

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  president: "社長",
  executive: "役員",
  employee: "社員",
  part_time: "パート",
};

export function canViewFinance(role: StaffRole): boolean {
  return role === "president" || role === "executive" || role === "employee";
}

export function canManageStaff(role: StaffRole): boolean {
  return role === "president" || role === "executive";
}

/**
 * 管理ダッシュボード・担当者別進捗・全社未割当警告など、パートに見せない
 * 社長/役員/社員向け機能の判定。値の集合はcanViewFinanceと同じだが、
 * 目的が異なるため別名で公開する（将来的に条件が分岐する可能性に備える）。
 */
export function canAccessManagementFeatures(role: StaffRole): boolean {
  return canViewFinance(role);
}
