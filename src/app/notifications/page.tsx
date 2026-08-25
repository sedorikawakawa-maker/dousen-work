import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getClientNamesByIds,
  getClientThumbnailsByIds,
  getMaterialClientIdMap,
  getMaterialSubmissionClientIdMap,
  getOutsourcingRequestClientIdMap,
  getProductionTaskClientIdMap,
  listNotificationsForStaff,
  resolveNotificationHref,
} from "@/lib/notifications/queries";
import { notificationTypeLabel } from "@/lib/notifications/labels";
import { notificationTypeStyle } from "@/lib/notifications/styles";
import type { Database } from "@/lib/supabase/database.types";
import { PageContainer } from "@/components/PageContainer";
import { ClientAvatar } from "@/components/ClientAvatar";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
  openNotificationAction,
} from "./actions";

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

function resolveNotificationClientId(
  notification: NotificationRow,
  maps: {
    materialClientIdById: Map<string, string>;
    materialSubmissionClientIdById: Map<string, string>;
    taskClientIdById: Map<string, string>;
    outsourcingClientIdById: Map<string, string>;
  },
): string | null {
  if (notification.entity_type === "material" && notification.entity_id) {
    return maps.materialClientIdById.get(notification.entity_id) ?? null;
  }
  if (notification.entity_type === "material_submission" && notification.entity_id) {
    return maps.materialSubmissionClientIdById.get(notification.entity_id) ?? null;
  }
  if (notification.entity_type === "production_task" && notification.entity_id) {
    return maps.taskClientIdById.get(notification.entity_id) ?? null;
  }
  if (notification.entity_type === "outsourcing_request" && notification.entity_id) {
    return maps.outsourcingClientIdById.get(notification.entity_id) ?? null;
  }
  return null;
}

/** body があればそれを本文として使い、無ければ title がラベルと同じ文言でない場合のみ使う（重複表示を避ける）。 */
function resolveNotificationContent(notification: NotificationRow): string | null {
  if (notification.body) return notification.body;
  const label = notificationTypeLabel(notification.notification_type);
  return notification.title !== label ? notification.title : null;
}

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
  const materialSubmissionIds = notifications
    .filter((n) => n.entity_type === "material_submission" && n.entity_id)
    .map((n) => n.entity_id as string);
  const taskIds = notifications
    .filter((n) => n.entity_type === "production_task" && n.entity_id)
    .map((n) => n.entity_id as string);
  const outsourcingIds = notifications
    .filter((n) => n.entity_type === "outsourcing_request" && n.entity_id)
    .map((n) => n.entity_id as string);

  const [materialClientIdById, materialSubmissionClientIdById, taskClientIdById, outsourcingClientIdById] =
    await Promise.all([
      getMaterialClientIdMap(supabase, materialIds),
      getMaterialSubmissionClientIdMap(supabase, materialSubmissionIds),
      getProductionTaskClientIdMap(supabase, taskIds),
      getOutsourcingRequestClientIdMap(supabase, outsourcingIds),
    ]);

  const allClientIds = new Set<string>();
  for (const clientId of materialClientIdById.values()) allClientIds.add(clientId);
  for (const clientId of materialSubmissionClientIdById.values()) allClientIds.add(clientId);
  for (const clientId of taskClientIdById.values()) allClientIds.add(clientId);
  for (const clientId of outsourcingClientIdById.values()) allClientIds.add(clientId);
  const [clientNameById, clientThumbnailById] = await Promise.all([
    getClientNamesByIds(supabase, [...allClientIds]),
    getClientThumbnailsByIds(supabase, [...allClientIds]),
  ]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <PageContainer className="gap-5 bg-neutral-50 py-6 sm:py-8">
      <div className="flex items-center justify-between gap-3">
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
              className="whitespace-nowrap rounded-full border border-neutral-300 bg-white px-3.5 py-2 text-sm text-neutral-700"
            >
              すべて既読にする
            </button>
          </form>
        ) : null}
      </div>

      <div className="rounded-2xl bg-white">
        {notifications.map((n) => {
          const href = resolveNotificationHref(n, materialClientIdById, materialSubmissionClientIdById);
          const clientId = resolveNotificationClientId(n, {
            materialClientIdById,
            materialSubmissionClientIdById,
            taskClientIdById,
            outsourcingClientIdById,
          });
          const clientName = clientId ? (clientNameById.get(clientId) ?? null) : null;
          const clientThumbnailUrl = clientId ? (clientThumbnailById.get(clientId) ?? null) : null;
          const contentText = resolveNotificationContent(n);
          const style = notificationTypeStyle(n.notification_type);

          return (
            <div
              key={n.id}
              className={`flex items-stretch gap-3 border-b border-neutral-100 py-3.5 pl-2.5 pr-2 last:border-b-0 sm:pl-3.5 sm:pr-3 ${
                n.is_read ? "" : "border-l-4 border-l-[var(--accent)] bg-[var(--accent-soft-bg)]"
              }`}
            >
              <span
                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base ${style.bg} ${style.text}`}
                aria-hidden="true"
              >
                {style.icon}
              </span>

              <div className="min-w-0 flex-1">
                <form action={openNotificationAction}>
                  <input type="hidden" name="notificationId" value={n.id} />
                  <input type="hidden" name="href" value={href} />
                  <button type="submit" className="flex w-full items-start gap-2 text-left">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        {clientName ? (
                          <span className="inline-flex items-center gap-1.5">
                            <ClientAvatar thumbnailUrl={clientThumbnailUrl} name={clientName} size="xs" />
                            <span
                              className={`font-semibold ${n.is_read ? "text-neutral-600" : "text-neutral-900"}`}
                            >
                              {clientName}
                            </span>
                          </span>
                        ) : null}
                        <span className={`text-xs font-medium ${style.text}`}>
                          {notificationTypeLabel(n.notification_type)}
                        </span>
                        <span
                          className={`text-[10px] font-bold ${
                            n.is_read ? "text-neutral-500" : "text-[var(--accent-strong)]"
                          }`}
                        >
                          {n.is_read ? "既読" : "未読"}
                        </span>
                      </div>
                      {contentText ? (
                        <p className={`mt-0.5 text-sm ${n.is_read ? "text-neutral-500" : "text-neutral-700"}`}>
                          {contentText}
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-xs font-medium tabular-nums text-neutral-500">
                        {new Date(n.created_at).toLocaleString("ja-JP")}
                      </p>
                    </div>
                    <span className="mt-1 shrink-0 text-lg text-neutral-300" aria-hidden="true">
                      ›
                    </span>
                  </button>
                </form>
                {!n.is_read ? (
                  <form action={markNotificationReadAction} className="mt-1.5">
                    <input type="hidden" name="notificationId" value={n.id} />
                    <button type="submit" className="text-xs font-medium text-[var(--accent-strong)] underline">
                      既読にする
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          );
        })}
        {notifications.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-400">通知はありません。</p>
        ) : null}
      </div>
    </PageContainer>
  );
}
