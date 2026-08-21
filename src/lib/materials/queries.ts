import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

export async function listMaterialsForClient(supabase: TypedClient, clientId: string) {
  const { data, error } = await supabase
    .from("materials")
    .select("*")
    .eq("client_id", clientId)
    .order("received_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/** 主担当・副担当へ新着素材の通知を作成する（顧客向けフォームからの登録時のみ呼び出す）。 */
export async function notifyAssignedStaffOfNewMaterial(
  supabase: TypedClient,
  params: { clientId: string; clientName: string; materialId: string; materialTitle: string },
): Promise<void> {
  const { data: assignments } = await supabase
    .from("client_assignments")
    .select("staff_id")
    .eq("client_id", params.clientId)
    .is("active_to", null);

  const recipientIds = [...new Set((assignments ?? []).map((a) => a.staff_id))];
  if (recipientIds.length === 0) return;

  await supabase.from("notifications").insert(
    recipientIds.map((staffId) => ({
      recipient_staff_id: staffId,
      notification_type: "new_material",
      title: `新着素材: ${params.clientName}`,
      body: params.materialTitle,
      entity_type: "material",
      entity_id: params.materialId,
    })),
  );
}
