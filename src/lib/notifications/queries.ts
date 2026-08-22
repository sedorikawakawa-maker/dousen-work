import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;
type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

export async function listNotificationsForStaff(
  supabase: TypedClient,
  staffId: string,
  limit = 50,
): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("recipient_staff_id", staffId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function countUnreadNotifications(
  supabase: TypedClient,
  staffId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_staff_id", staffId)
    .eq("is_read", false);

  if (error) throw error;
  return count ?? 0;
}

/** entity_type='material' の通知だけ、遷移先を組み立てるためclient_idを引く。 */
export async function getMaterialClientIdMap(
  supabase: TypedClient,
  materialIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (materialIds.length === 0) return result;

  const { data } = await supabase.from("materials").select("id, client_id").in("id", materialIds);
  for (const m of data ?? []) result.set(m.id, m.client_id);
  return result;
}

export function resolveNotificationHref(
  notification: NotificationRow,
  materialClientIdById: Map<string, string>,
): string {
  if (notification.entity_type === "production_task" && notification.entity_id) {
    return `/tasks/${notification.entity_id}`;
  }
  if (notification.entity_type === "material" && notification.entity_id) {
    const clientId = materialClientIdById.get(notification.entity_id);
    if (clientId) return `/clients/${clientId}?tab=materials`;
  }
  return "/";
}
