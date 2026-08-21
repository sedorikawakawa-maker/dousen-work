"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ClientCurrentStatus } from "@/lib/supabase/database.types";

export async function updateClientStatusAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const newStatus = String(formData.get("currentStatus")) as ClientCurrentStatus;
  const supabase = await createSupabaseServerClient();

  const { data: current } = await supabase
    .from("clients")
    .select("current_status")
    .eq("id", clientId)
    .maybeSingle();

  // material_waiting への遷移時のみ開始日時を記録する（既にmaterial_waitingの場合は
  // 経過日数カウントをリセットしないよう据え置く）。それ以外の状態へ移る場合はnullに戻す。
  const enteringMaterialWaiting =
    newStatus === "material_waiting" && current?.current_status !== "material_waiting";
  const leavingMaterialWaiting = newStatus !== "material_waiting";

  const materialWaitStartedAt = enteringMaterialWaiting
    ? new Date().toISOString()
    : leavingMaterialWaiting
      ? null
      : undefined;

  await supabase
    .from("clients")
    .update({
      current_status: newStatus,
      ...(materialWaitStartedAt !== undefined
        ? { material_wait_started_at: materialWaitStartedAt }
        : {}),
    })
    .eq("id", clientId);

  redirect("/");
}
