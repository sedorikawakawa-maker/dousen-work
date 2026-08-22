"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";

export async function markNotificationReadAction(formData: FormData) {
  const notificationId = String(formData.get("notificationId"));
  const supabase = await createSupabaseServerClient();

  await supabase.from("notifications").update({ is_read: true }).eq("id", notificationId);

  redirect("/notifications");
}

export async function markAllNotificationsReadAction() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  const supabase = await createSupabaseServerClient();
  await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("recipient_staff_id", staff.id)
    .eq("is_read", false);

  redirect("/notifications");
}

/** 通知クリック時、既読にしつつ対象画面へ移動する。 */
export async function openNotificationAction(formData: FormData) {
  const notificationId = String(formData.get("notificationId"));
  const href = String(formData.get("href") ?? "/");
  const supabase = await createSupabaseServerClient();

  await supabase.from("notifications").update({ is_read: true }).eq("id", notificationId);

  redirect(href.startsWith("/") ? href : "/");
}
