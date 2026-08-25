import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

const ADMIN_ROLES = ["president", "executive"] as const;

export async function listAllStaffForManagement(supabase: TypedClient) {
  const { data, error } = await supabase
    .from("staff")
    .select("id, last_name, first_name, role, is_active, last_login_at, created_at")
    .order("is_active", { ascending: false })
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * 「最後の管理者がいなくなる」変更を防ぐためのチェック用。
 * excludeStaffId（操作対象本人）を除いた、在籍中のpresident/executiveの人数を返す。
 */
export async function countOtherActiveAdmins(supabase: TypedClient, excludeStaffId: string): Promise<number> {
  const { count, error } = await supabase
    .from("staff")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .in("role", [...ADMIN_ROLES])
    .neq("id", excludeStaffId);

  if (error) throw error;
  return count ?? 0;
}

export function isAdminRole(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}
