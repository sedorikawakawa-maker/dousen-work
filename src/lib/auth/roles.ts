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
