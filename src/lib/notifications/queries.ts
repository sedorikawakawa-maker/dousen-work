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

/** entity_type='material_submission' の通知だけ、遷移先を組み立てるためclient_idを引く。 */
export async function getMaterialSubmissionClientIdMap(
  supabase: TypedClient,
  submissionIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (submissionIds.length === 0) return result;

  const { data } = await supabase
    .from("material_submissions")
    .select("id, client_id")
    .in("id", submissionIds);
  for (const s of data ?? []) result.set(s.id, s.client_id);
  return result;
}

/**
 * entity_type='production_task' の通知は title/body に顧客名を含まないため、
 * 表示用に顧客名を出すには紐づく production_tasks から client_id を引く必要がある。
 * 通知の生成ロジックやDB定義には触れず、表示専用の読み取りとして追加。
 */
export async function getProductionTaskClientIdMap(
  supabase: TypedClient,
  taskIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (taskIds.length === 0) return result;

  const { data } = await supabase.from("production_tasks").select("id, client_id").in("id", taskIds);
  for (const t of data ?? []) result.set(t.id, t.client_id);
  return result;
}

/** entity_type='outsourcing_request' の通知の表示用に、紐づく client_id を引く（無い場合もある）。 */
export async function getOutsourcingRequestClientIdMap(
  supabase: TypedClient,
  outsourcingIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (outsourcingIds.length === 0) return result;

  const { data } = await supabase
    .from("outsourcing_requests")
    .select("id, client_id")
    .in("id", outsourcingIds);
  for (const o of data ?? []) {
    if (o.client_id) result.set(o.id, o.client_id);
  }
  return result;
}

/** clients_view から表示用の顧客名だけをまとめて引く（料金等は取得しない）。 */
export async function getClientNamesByIds(
  supabase: TypedClient,
  clientIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (clientIds.length === 0) return result;

  const { data } = await supabase
    .from("clients_view")
    .select("id, company_name, shop_name")
    .in("id", clientIds);
  for (const c of data ?? []) {
    result.set(c.id, c.shop_name ? `${c.company_name}（${c.shop_name}）` : c.company_name);
  }
  return result;
}

/** clients_view から表示用のサムネイルURLだけをまとめて引く。 */
export async function getClientThumbnailsByIds(
  supabase: TypedClient,
  clientIds: string[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (clientIds.length === 0) return result;

  const { data } = await supabase.from("clients_view").select("id, thumbnail_url").in("id", clientIds);
  for (const c of data ?? []) {
    result.set(c.id, c.thumbnail_url);
  }
  return result;
}

export function resolveNotificationHref(
  notification: NotificationRow,
  materialClientIdById: Map<string, string>,
  materialSubmissionClientIdById: Map<string, string> = new Map(),
): string {
  if (notification.entity_type === "production_task" && notification.entity_id) {
    return `/tasks/${notification.entity_id}`;
  }
  // 過去通知用: entity_type='material'（旧仕様）は必ず維持する。
  if (notification.entity_type === "material" && notification.entity_id) {
    const clientId = materialClientIdById.get(notification.entity_id);
    if (clientId) return `/clients/${clientId}?tab=materials`;
  }
  if (notification.entity_type === "material_submission" && notification.entity_id) {
    const clientId = materialSubmissionClientIdById.get(notification.entity_id);
    if (clientId) return `/clients/${clientId}?tab=materials`;
  }
  if (notification.entity_type === "outsourcing_request" && notification.entity_id) {
    return `/outsourcing/${notification.entity_id}`;
  }
  return "/";
}
