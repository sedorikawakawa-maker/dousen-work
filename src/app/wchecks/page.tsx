import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listActiveStaff, listClients } from "@/lib/clients/queries";
import { listPendingWChecksWithTasks } from "@/lib/wchecks/queries";
import { POST_TYPE_LABELS } from "@/lib/clients/labels";
import { WCHECK_ASSET_TYPE_LABELS, WCHECK_CRITERIA } from "@/lib/wchecks/labels";
import { approveWCheckAction, requestWCheckRevisionAction } from "../tasks/[taskId]/actions";

export default async function WChecksPage({
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
  const [items, clients, staffOptions] = await Promise.all([
    listPendingWChecksWithTasks(supabase),
    listClients(supabase),
    listActiveStaff(supabase),
  ]);

  const clientNameById = new Map(
    clients.map((c) => [c.id, c.shop_name ? `${c.company_name}（${c.shop_name}）` : c.company_name]),
  );
  const staffNameById = new Map(staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));

  const sorted = [...items].sort((a, b) => {
    const aMine = a.wcheck.reviewer_staff_id === staff.id ? 0 : 1;
    const bMine = b.wcheck.reviewer_staff_id === staff.id ? 0 : 1;
    if (aMine !== bMine) return aMine - bMine;
    return a.wcheck.requested_at.localeCompare(b.wcheck.requested_at);
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-6 sm:py-8">
      <div>
        <Link href="/" className="text-sm text-neutral-500">
          ← ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">Wチェック待ち</h1>
      </div>

      <div className="rounded-md bg-purple-50 px-3 py-2 text-xs text-purple-800">
        チェック基準: {WCHECK_CRITERIA.join(" / ")}
      </div>

      {saved ? (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">更新しました。</p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="flex flex-col gap-3">
        {sorted.map(({ wcheck, task }) => {
          const isMine = wcheck.reviewer_staff_id === staff.id;
          return (
            <div
              key={wcheck.id}
              className={`flex flex-col gap-3 rounded-lg border p-4 ${
                isMine ? "border-purple-400 bg-purple-50/40" : "border-neutral-200 bg-white"
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
                {wcheck.reviewer_staff_id ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      isMine ? "bg-purple-600 text-white" : "bg-purple-100 text-purple-700"
                    }`}
                  >
                    指定: {staffNameById.get(wcheck.reviewer_staff_id) ?? "不明"}
                    {isMine ? "（あなた）" : ""}
                  </span>
                ) : (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                    指定なし（誰でも可）
                  </span>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-2 text-xs text-neutral-500">
                <div>
                  <dt>依頼日時</dt>
                  <dd className="text-neutral-800">
                    {new Date(wcheck.requested_at).toLocaleString("ja-JP")}
                  </dd>
                </div>
                <div>
                  <dt>制作担当</dt>
                  <dd className="text-neutral-800">
                    {staffNameById.get(wcheck.requested_by_staff_id) ?? "不明"}
                  </dd>
                </div>
              </dl>

              <a
                href={wcheck.asset_url}
                target="_blank"
                rel="noreferrer"
                className="w-full rounded-md border border-neutral-300 px-4 py-3 text-center text-sm font-medium text-neutral-700"
              >
                {WCHECK_ASSET_TYPE_LABELS[wcheck.asset_type]}を開く
              </a>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <form action={approveWCheckAction}>
                  <input type="hidden" name="wcheckId" value={wcheck.id} />
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="returnTo" value="/wchecks" />
                  <button
                    type="submit"
                    className="w-full rounded-md bg-green-600 px-4 py-3 text-sm font-medium text-white"
                  >
                    OK
                  </button>
                </form>
                <details className="rounded-md border border-neutral-300">
                  <summary className="cursor-pointer px-4 py-3 text-center text-sm font-medium text-red-700">
                    修正依頼
                  </summary>
                  <form action={requestWCheckRevisionAction} className="flex flex-col gap-2 p-3 pt-0">
                    <input type="hidden" name="wcheckId" value={wcheck.id} />
                    <input type="hidden" name="taskId" value={task.id} />
                    <input type="hidden" name="returnTo" value="/wchecks" />
                    <textarea
                      name="revisionComment"
                      rows={2}
                      required
                      placeholder="修正コメント"
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      className="w-full rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white"
                    >
                      修正依頼を送る
                    </button>
                  </form>
                </details>
              </div>
            </div>
          );
        })}
        {sorted.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-400">
            Wチェック待ちのタスクはありません。
          </p>
        ) : null}
      </div>
    </main>
  );
}
