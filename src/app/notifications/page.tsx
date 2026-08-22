import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getMaterialClientIdMap,
  listNotificationsForStaff,
  resolveNotificationHref,
} from "@/lib/notifications/queries";
import { notificationTypeLabel } from "@/lib/notifications/labels";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
  openNotificationAction,
} from "./actions";

export default async function NotificationsPage() {
  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();
  const notifications = await listNotificationsForStaff(supabase, staff.id);

  const materialIds = notifications
    .filter((n) => n.entity_type === "material" && n.entity_id)
    .map((n) => n.entity_id as string);
  const materialClientIdById = await getMaterialClientIdMap(supabase, materialIds);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-6 sm:py-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-neutral-500">
            ← ダッシュボードに戻る
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-neutral-900">
            通知{unreadCount > 0 ? `（未読${unreadCount}）` : ""}
          </h1>
        </div>
        {unreadCount > 0 ? (
          <form action={markAllNotificationsReadAction}>
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700"
            >
              すべて既読にする
            </button>
          </form>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        {notifications.map((n) => {
          const href = resolveNotificationHref(n, materialClientIdById);
          return (
            <div
              key={n.id}
              className={`rounded-lg border p-4 ${
                n.is_read ? "border-neutral-200 bg-white" : "border-blue-300 bg-blue-50"
              }`}
            >
              <form action={openNotificationAction}>
                <input type="hidden" name="notificationId" value={n.id} />
                <input type="hidden" name="href" value={href} />
                <button type="submit" className="w-full text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      {!n.is_read ? <span className="h-2 w-2 rounded-full bg-blue-600" /> : null}
                      <span className="text-sm font-medium text-neutral-900">
                        {notificationTypeLabel(n.notification_type)}
                      </span>
                    </span>
                    <span className="text-xs text-neutral-400">
                      {new Date(n.created_at).toLocaleString("ja-JP")}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-neutral-700">{n.title}</p>
                  {n.body ? <p className="mt-1 text-xs text-neutral-500">{n.body}</p> : null}
                </button>
              </form>
              {!n.is_read ? (
                <form action={markNotificationReadAction} className="mt-2">
                  <input type="hidden" name="notificationId" value={n.id} />
                  <button type="submit" className="text-xs text-blue-700 underline">
                    既読にする
                  </button>
                </form>
              ) : null}
            </div>
          );
        })}
        {notifications.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-400">通知はありません。</p>
        ) : null}
      </div>
    </main>
  );
}
