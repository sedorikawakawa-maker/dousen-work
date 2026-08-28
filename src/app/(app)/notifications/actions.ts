"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";

export async function markNotificationReadAction(formData: FormData) {
  const notificationId = String(formData.get("notificationId"));
  const supabase = await createSupabaseServerClient();

  await supabase.from("notifications").update({ is_read: true }).eq("id", notificationId);

  // Sidebar/モバイルヘッダーの未読バッジは(app)/layout.tsxがcountUnreadNotificationsを都度
  // 読んで描画するだけで、fetchキャッシュ等は使っていない。それでもredirect()だけでは
  // クライアントルーターが遷移先のlayoutをキャッシュ済みとして扱い、更新前の件数のまま
  // 描画され続けるため、refresh()でこのServer Actionのレスポンスに現在ルートの最新RSCを
  // 含めさせ、リロードなしで反映させる。
  refresh();
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

  refresh();
  redirect("/notifications");
}

/** 通知クリック時、既読にしつつ対象画面へ移動する。 */
export async function openNotificationAction(formData: FormData) {
  const notificationId = String(formData.get("notificationId"));
  const href = String(formData.get("href") ?? "/");
  const supabase = await createSupabaseServerClient();

  await supabase.from("notifications").update({ is_read: true }).eq("id", notificationId);

  refresh();
  redirect(href.startsWith("/") ? href : "/");
}
