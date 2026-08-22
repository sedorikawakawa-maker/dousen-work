import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listActiveStaff, listClients } from "@/lib/clients/queries";
import { listPendingClientConfirmationsWithTasks } from "@/lib/clientConfirmations/queries";
import { getLatestApprovedWCheckByTaskIds } from "@/lib/wchecks/queries";
import { POST_TYPE_LABELS } from "@/lib/clients/labels";
import { WCHECK_ASSET_TYPE_LABELS } from "@/lib/wchecks/labels";
import {
  getClientConfirmationElapsedDays,
  getClientConfirmationLevel,
} from "@/lib/reminders/clientConfirmation";
import {
  approveClientConfirmationAction,
  requestClientConfirmationRevisionAction,
} from "../tasks/[taskId]/actions";

export default async function ClientConfirmationsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;

  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();
  const items = await listPendingClientConfirmationsWithTasks(supabase);
  const taskIds = items.map((i) => i.task.id);
  const clientIds = [...new Set(items.map((i) => i.task.client_id))];

  const [clients, staffOptions, latestWCheckByTaskId, lineLinksResult] = await Promise.all([
    listClients(supabase),
    listActiveStaff(supabase),
    getLatestApprovedWCheckByTaskIds(supabase, taskIds),
    clientIds.length > 0
      ? supabase
          .from("client_links")
          .select("client_id, url")
          .in("client_id", clientIds)
          .eq("link_type", "official_line")
      : Promise.resolve({ data: [] as { client_id: string; url: string }[] }),
  ]);

  const clientNameById = new Map(
    clients.map((c) => [c.id, c.shop_name ? `${c.company_name}（${c.shop_name}）` : c.company_name]),
  );
  const staffNameById = new Map(staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));
  const lineLinkByClientId = new Map(
    (lineLinksResult.data ?? []).map((l) => [l.client_id, l.url]),
  );

  const sorted = [...items].sort((a, b) => {
    const daysA = getClientConfirmationElapsedDays(a.confirmation.requested_at) ?? 0;
    const daysB = getClientConfirmationElapsedDays(b.confirmation.requested_at) ?? 0;
    return daysB - daysA;
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-6 sm:py-8">
      <div>
        <Link href="/" className="text-sm text-neutral-500">
          ← ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">顧客確認待ち</h1>
      </div>

      {saved ? (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">更新しました。</p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="flex flex-col gap-3">
        {sorted.map(({ confirmation, task }) => {
          const days = getClientConfirmationElapsedDays(confirmation.requested_at);
          const level = getClientConfirmationLevel(confirmation.requested_at);
          const badgeClass =
            level === "urgent"
              ? "bg-red-600 text-white"
              : level === "warning"
                ? "bg-yellow-100 text-yellow-800"
                : "bg-neutral-100 text-neutral-600";
          const wcheck = latestWCheckByTaskId.get(task.id);
          const lineUrl = lineLinkByClientId.get(task.client_id);

          return (
            <div
              key={confirmation.id}
              className={`flex flex-col gap-3 rounded-lg border p-4 ${
                level === "urgent" ? "border-red-400 bg-red-50/40" : "border-neutral-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Link href={`/tasks/${task.id}`} className="font-medium text-neutral-900 hover:underline">
                    {clientNameById.get(task.client_id) ?? "不明な顧客"} / {task.title}
                  </Link>
                  <p className="text-xs text-neutral-500">
                    {POST_TYPE_LABELS[task.post_type]} ・ 投稿予定日: {task.scheduled_post_date ?? "未定"}
                  </p>
                </div>
                {days !== null ? (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
                    確認待ち{days}日経過{level === "urgent" ? "（最優先催促対象）" : ""}
                  </span>
                ) : null}
              </div>

              <dl className="grid grid-cols-2 gap-2 text-xs text-neutral-500">
                <div>
                  <dt>確認依頼日</dt>
                  <dd className="text-neutral-800">
                    {new Date(confirmation.requested_at).toLocaleString("ja-JP")}
                  </dd>
                </div>
                <div>
                  <dt>制作担当</dt>
                  <dd className="text-neutral-800">
                    {task.assignee_staff_id ? staffNameById.get(task.assignee_staff_id) ?? "不明" : "未割当"}
                  </dd>
                </div>
              </dl>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {wcheck ? (
                  <a
                    href={wcheck.asset_url}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full rounded-md border border-neutral-300 px-4 py-3 text-center text-sm font-medium text-neutral-700"
                  >
                    {WCHECK_ASSET_TYPE_LABELS[wcheck.asset_type]}を開く
                  </a>
                ) : (
                  <span className="w-full rounded-md border border-dashed border-neutral-300 px-4 py-3 text-center text-sm text-neutral-400">
                    制作物リンクなし
                  </span>
                )}
                {lineUrl ? (
                  <a
                    href={lineUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full rounded-md border border-green-400 bg-green-50 px-4 py-3 text-center text-sm font-medium text-green-800"
                  >
                    公式LINEを開く
                  </a>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <form action={approveClientConfirmationAction}>
                  <input type="hidden" name="confirmationId" value={confirmation.id} />
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="returnTo" value="/client-confirmations" />
                  <button
                    type="submit"
                    className="w-full rounded-md bg-green-600 px-4 py-3 text-sm font-medium text-white"
                  >
                    顧客OK
                  </button>
                </form>
                <details className="rounded-md border border-neutral-300">
                  <summary className="cursor-pointer px-4 py-3 text-center text-sm font-medium text-red-700">
                    修正依頼
                  </summary>
                  <form
                    action={requestClientConfirmationRevisionAction}
                    className="flex flex-col gap-2 p-3 pt-0"
                  >
                    <input type="hidden" name="confirmationId" value={confirmation.id} />
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="returnTo" value="/client-confirmations" />
                    <textarea
                      name="revisionComment"
                      rows={2}
                      required
                      placeholder="修正内容"
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      className="w-full rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white"
                    >
                      修正依頼を記録
                    </button>
                  </form>
                </details>
              </div>
            </div>
          );
        })}
        {sorted.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-400">
            顧客確認待ちのタスクはありません。
          </p>
        ) : null}
      </div>
    </main>
  );
}
