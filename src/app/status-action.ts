"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ClientCurrentStatus } from "@/lib/supabase/database.types";

export async function updateClientStatusAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const newStatus = String(formData.get("currentStatus")) as ClientCurrentStatus;
  const supabase = await createSupabaseServerClient();

  await supabase.rpc("update_client_status", {
    p_client_id: clientId,
    p_new_status: newStatus,
  });

  redirect("/");
}
