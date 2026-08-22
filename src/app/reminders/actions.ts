"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";
import type { ReminderType } from "@/lib/supabase/database.types";

/**
 * 催促済みの記録のみ行う。素材待ち/顧客確認待ちの状態そのものは変更しない。
 */
export async function recordReminderAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const taskId = String(formData.get("taskId") ?? "").trim() || null;
  const reminderType = String(formData.get("reminderType")) as ReminderType;
  const note = String(formData.get("note") ?? "").trim() || null;

  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  const supabase = await createSupabaseServerClient();
  await supabase.from("reminder_logs").insert({
    client_id: clientId,
    production_task_id: taskId,
    reminder_type: reminderType,
    reminded_by_staff_id: staff.id,
    note,
  });

  redirect("/reminders?saved=1");
}
