import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

export interface StaffPresenceRosterItem {
  id: string;
  name: string;
  /** staff_presenceに行が無い(まだ一度も接続したことが無い)場合はnull。 */
  lastSeenAt: string | null;
}

/**
 * Sidebarの「稼働状況」表示用に、全active staff(part_time含む)と、分かる範囲の
 * 最終アクセス時刻(staff_presence)をあわせて返す。オンライン/オフライン自体は
 * ここでは判定しない(クライアント側でRealtime Presenceの状態と突き合わせる)。
 */
export async function listStaffPresenceRoster(supabase: TypedClient): Promise<StaffPresenceRosterItem[]> {
  const [{ data: staffRows, error: staffError }, { data: presenceRows, error: presenceError }] = await Promise.all([
    supabase.from("staff").select("id, last_name, first_name").eq("is_active", true).order("last_name"),
    supabase.from("staff_presence").select("staff_id, last_seen_at"),
  ]);

  if (staffError) throw staffError;
  if (presenceError) throw presenceError;

  const lastSeenById = new Map((presenceRows ?? []).map((row) => [row.staff_id, row.last_seen_at]));

  return (staffRows ?? []).map((s) => ({
    id: s.id,
    name: `${s.last_name} ${s.first_name}`,
    lastSeenAt: lastSeenById.get(s.id) ?? null,
  }));
}
