import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listActiveStaff } from "@/lib/clients/queries";
import { listMaterialsForClient } from "@/lib/materials/queries";
import { listWChecksForTask } from "@/lib/wchecks/queries";
import { listClientConfirmationsForTask } from "@/lib/clientConfirmations/queries";
import { PRODUCTION_TASK_STATUS_LABELS, POST_TYPE_LABELS } from "@/lib/clients/labels";
import {
  WCHECK_ASSET_TYPE_LABELS,
  WCHECK_CRITERIA,
  WCHECK_STATUS_LABELS,
  assetTypeForPostType,
} from "@/lib/wchecks/labels";
import { CLIENT_CONFIRMATION_STATUS_LABELS } from "@/lib/clientConfirmations/labels";
import { getMaterialWaitElapsedDays, getMaterialWaitLevel } from "@/lib/reminders/material";
import {
  getClientConfirmationElapsedDays,
  getClientConfirmationLevel,
} from "@/lib/reminders/clientConfirmation";
import {
  approveClientConfirmationAction,
  approveWCheckAction,
  registerWCheckAction,
  requestClientConfirmationAction,
  requestClientConfirmationRevisionAction,
  requestWCheckRevisionAction,
  resolveTaskMaterialWaitingAction,
  setTaskMaterialWaitingAction,
} from "./actions";

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { taskId } = await params;
  const { saved, error } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const { data: task } = await supabase
    .from("production_tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) {
    notFound();
  }

  const [{ data: client }, staffOptions, materials, wChecks, confirmations, { data: lineLink }] =
    await Promise.all([
      supabase.from("clients_view").select("id, company_name, shop_name").eq("id", task.client_id).maybeSingle(),
      listActiveStaff(supabase),
      listMaterialsForClient(supabase, task.client_id),
      listWChecksForTask(supabase, taskId),
      listClientConfirmationsForTask(supabase, taskId),
      supabase
        .from("client_links")
        .select("url")
        .eq("client_id", task.client_id)
        .eq("link_type", "official_line")
        .maybeSingle(),
    ]);

  const staffNameById = new Map(staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));
  const pendingWCheck = wChecks.find((w) => w.status === "waiting");
  const wCheckHistory = wChecks.filter((w) => w.id !== pendingWCheck?.id);
  const pendingConfirmation = confirmations.find((c) => c.status === "waiting");
  const confirmationHistory = confirmations.filter((c) => c.id !== pendingConfirmation?.id);
  const confirmationDays = pendingConfirmation
    ? getClientConfirmationElapsedDays(pendingConfirmation.requested_at)
    : null;
  const confirmationLevel = pendingConfirmation
    ? getClientConfirmationLevel(pendingConfirmation.requested_at)
    : "none";
  const confirmationBadgeClass =
    confirmationLevel === "urgent"
      ? "bg-red-100 text-red-700"
      : confirmationLevel === "warning"
        ? "bg-yellow-100 text-yellow-700"
        : "bg-neutral-100 text-neutral-600";

  const canSetMaterialWaiting =
    task.status === "production_waiting" || task.status === "in_production";
  const materialWaitLevel = getMaterialWaitLevel(task.material_wait_started_at);
  const materialWaitDays = getMaterialWaitElapsedDays(task.material_wait_started_at);
  const badgeClass =
    materialWaitLevel === "urgent"
      ? "bg-red-100 text-red-700"
      : materialWaitLevel === "warning"
        ? "bg-yellow-100 text-yellow-700"
        : "bg-neutral-100 text-neutral-600";

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        {client ? (
          <Link href={`/clients/${client.id}?tab=schedule`} className="text-sm text-neutral-500">
            ← {client.company_name}
            {client.shop_name ? `（${client.shop_name}）` : ""} の投稿スケジュールに戻る
          </Link>
        ) : null}
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">{task.title}</h1>
        <p className="text-sm text-neutral-500">{POST_TYPE_LABELS[task.post_type]}</p>
      </div>

      {saved ? (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">更新しました。</p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-neutral-400">状態</dt>
            <dd className="flex items-center gap-2 text-neutral-900">
              {PRODUCTION_TASK_STATUS_LABELS[task.status]}
              {materialWaitDays !== null ? (
                <span className={`rounded-full px-2 py-0.5 text-xs ${badgeClass}`}>
                  素材待ち{materialWaitDays}日経過
                </span>
              ) : null}
            </dd>
          </div>
          <InfoRow label="持越し" value={task.is_carryover ? "はい" : "いいえ"} />
          <InfoRow label="投稿予定日" value={task.scheduled_post_date ?? "—"} />
          <InfoRow label="制作開始予定" value={task.production_start_date ?? "—"} />
          <InfoRow label="Wチェック期限" value={task.wcheck_due_date ?? "—"} />
          <InfoRow label="顧客確認期限" value={task.client_confirm_due_date ?? "—"} />
          <InfoRow
            label="担当"
            value={
              task.assignee_staff_id ? staffNameById.get(task.assignee_staff_id) ?? "不明" : "未割当"
            }
          />
          <InfoRow
            label="副担当"
            value={task.secondary_staff_id ? staffNameById.get(task.secondary_staff_id) ?? "不明" : "—"}
          />
        </dl>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">素材待ちへの変更</h2>
        {canSetMaterialWaiting ? (
          <form action={setTaskMaterialWaitingAction} className="flex flex-col gap-2">
            <input type="hidden" name="taskId" value={taskId} />
            <p className="text-xs text-neutral-500">
              素材が届いておらず制作を進められない場合に設定します。設定時点の日時を記録します。
            </p>
            <button
              type="submit"
              className="w-full rounded-md border border-yellow-400 bg-yellow-50 px-4 py-2 text-sm font-medium text-yellow-800"
            >
              素材待ちにする
            </button>
          </form>
        ) : task.status === "material_waiting" ? (
          <form action={resolveTaskMaterialWaitingAction} className="flex flex-col gap-2">
            <input type="hidden" name="taskId" value={taskId} />
            <p className="text-xs text-neutral-500">
              素材が届いても自動では解除されません。内容を確認のうえ、次の状態を選んでください。
            </p>
            <div className="flex gap-2">
              <button
                type="submit"
                name="nextStatus"
                value="production_waiting"
                className="flex-1 rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
              >
                制作待ちに戻す
              </button>
              <button
                type="submit"
                name="nextStatus"
                value="in_production"
                className="flex-1 rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
              >
                制作中にする
              </button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-neutral-400">
            現在の状態（{PRODUCTION_TASK_STATUS_LABELS[task.status]}）では変更できません。
          </p>
        )}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">Wチェック</h2>

        <div className="mb-4 rounded-md bg-purple-50 px-3 py-2 text-xs text-purple-800">
          チェック基準: {WCHECK_CRITERIA.join(" / ")}
        </div>

        {pendingWCheck ? (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <InfoRow label="依頼日時" value={new Date(pendingWCheck.requested_at).toLocaleString("ja-JP")} />
              <InfoRow
                label="制作担当"
                value={staffNameById.get(pendingWCheck.requested_by_staff_id) ?? "不明"}
              />
              <InfoRow
                label="Wチェック担当"
                value={
                  pendingWCheck.reviewer_staff_id
                    ? staffNameById.get(pendingWCheck.reviewer_staff_id) ?? "不明"
                    : "指定なし（誰でも可）"
                }
              />
              <InfoRow label={WCHECK_ASSET_TYPE_LABELS[pendingWCheck.asset_type]} value={pendingWCheck.asset_url} />
            </dl>
            {pendingWCheck.reviewer_staff_id ? (
              <p className="w-fit rounded-full bg-purple-100 px-3 py-1 text-xs font-medium text-purple-800">
                指定担当: {staffNameById.get(pendingWCheck.reviewer_staff_id) ?? "不明"}
              </p>
            ) : null}
            <a
              href={pendingWCheck.asset_url}
              target="_blank"
              rel="noreferrer"
              className="w-full rounded-md border border-neutral-300 px-4 py-3 text-center text-sm font-medium text-neutral-700"
            >
              制作物を開く
            </a>
            {pendingWCheck.notes ? (
              <p className="text-xs text-neutral-500">補足: {pendingWCheck.notes}</p>
            ) : null}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <form action={approveWCheckAction}>
                <input type="hidden" name="wcheckId" value={pendingWCheck.id} />
                <input type="hidden" name="taskId" value={taskId} />
                <input type="hidden" name="returnTo" value={`/tasks/${taskId}`} />
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
                  <input type="hidden" name="wcheckId" value={pendingWCheck.id} />
                  <input type="hidden" name="taskId" value={taskId} />
                  <input type="hidden" name="returnTo" value={`/tasks/${taskId}`} />
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
        ) : (
          <form action={registerWCheckAction} className="flex flex-col gap-3">
            <input type="hidden" name="taskId" value={taskId} />
            <label className="text-sm font-medium text-neutral-700">
              {WCHECK_ASSET_TYPE_LABELS[assetTypeForPostType(task.post_type)]}
              <input
                name="assetUrl"
                type="url"
                required
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
              />
            </label>
            <label className="text-sm font-medium text-neutral-700">
              Wチェック担当（任意）
              <select
                name="reviewerStaffId"
                defaultValue=""
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
              >
                <option value="">指定なし（誰でも可）</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.last_name} {s.first_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-neutral-700">
              補足
              <textarea
                name="notes"
                rows={2}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
              />
            </label>
            <button
              type="submit"
              className="mt-1 w-full rounded-md bg-neutral-900 px-4 py-3 text-sm font-medium text-white"
            >
              Wチェック登録
            </button>
          </form>
        )}

        {wCheckHistory.length > 0 ? (
          <div className="mt-4 border-t border-neutral-100 pt-3">
            <h3 className="mb-2 text-xs font-semibold text-neutral-500">Wチェック履歴</h3>
            <ul className="flex flex-col gap-2 text-xs text-neutral-500">
              {wCheckHistory.map((w) => (
                <li key={w.id}>
                  {new Date(w.requested_at).toLocaleString("ja-JP")} — {WCHECK_STATUS_LABELS[w.status]}
                  {w.reviewed_at ? `（${new Date(w.reviewed_at).toLocaleString("ja-JP")}）` : ""}
                  {w.revision_comment ? ` / ${w.revision_comment}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">顧客確認</h2>

        {pendingConfirmation ? (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-neutral-400">確認依頼日</dt>
                <dd className="flex items-center gap-2 text-neutral-900">
                  {new Date(pendingConfirmation.requested_at).toLocaleString("ja-JP")}
                  {confirmationDays !== null ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs ${confirmationBadgeClass}`}>
                      {confirmationDays}日経過
                    </span>
                  ) : null}
                </dd>
              </div>
              <InfoRow
                label="依頼者"
                value={staffNameById.get(pendingConfirmation.requested_by_staff_id) ?? "不明"}
              />
            </dl>

            {lineLink?.url ? (
              <a
                href={lineLink.url}
                target="_blank"
                rel="noreferrer"
                className="w-full rounded-md border border-green-400 bg-green-50 px-4 py-3 text-center text-sm font-medium text-green-800"
              >
                公式LINEを開く
              </a>
            ) : null}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <form action={approveClientConfirmationAction}>
                <input type="hidden" name="confirmationId" value={pendingConfirmation.id} />
                <input type="hidden" name="taskId" value={taskId} />
                <input type="hidden" name="returnTo" value={`/tasks/${taskId}`} />
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
                  <input type="hidden" name="confirmationId" value={pendingConfirmation.id} />
                  <input type="hidden" name="taskId" value={taskId} />
                  <input type="hidden" name="returnTo" value={`/tasks/${taskId}`} />
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
        ) : task.status === "client_confirmation_waiting" ? (
          <form action={requestClientConfirmationAction} className="flex flex-col gap-2">
            <input type="hidden" name="taskId" value={taskId} />
            <p className="text-xs text-neutral-500">
              公式LINE等で実際に顧客へ送った後に押してください。LINE本文自体はDOUSEN
              WORKに保存されません。
            </p>
            {lineLink?.url ? (
              <a
                href={lineLink.url}
                target="_blank"
                rel="noreferrer"
                className="w-full rounded-md border border-green-400 bg-green-50 px-4 py-3 text-center text-sm font-medium text-green-800"
              >
                公式LINEを開く
              </a>
            ) : null}
            <button
              type="submit"
              className="w-full rounded-md bg-neutral-900 px-4 py-3 text-sm font-medium text-white"
            >
              顧客確認依頼済みにする
            </button>
          </form>
        ) : (
          <p className="text-sm text-neutral-400">
            WチェックOK後（顧客確認へ進められる状態）になると依頼を登録できます。
          </p>
        )}

        {confirmationHistory.length > 0 ? (
          <div className="mt-4 border-t border-neutral-100 pt-3">
            <h3 className="mb-2 text-xs font-semibold text-neutral-500">顧客確認履歴</h3>
            <ul className="flex flex-col gap-2 text-xs text-neutral-500">
              {confirmationHistory.map((c) => (
                <li key={c.id}>
                  {new Date(c.requested_at).toLocaleString("ja-JP")} —{" "}
                  {CLIENT_CONFIRMATION_STATUS_LABELS[c.status]}
                  {c.responded_at ? `（${new Date(c.responded_at).toLocaleString("ja-JP")}）` : ""}
                  {c.revision_comment ? ` / ${c.revision_comment}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">この顧客の素材一覧</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {materials.map((m) => (
            <li key={m.id} className="rounded-md border border-neutral-200 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{m.title}</span>
                <span className="text-xs text-neutral-400">
                  {new Date(m.received_at).toLocaleDateString("ja-JP")} 受領
                </span>
              </div>
              {m.post_usage ? <p className="text-xs text-neutral-500">用途: {m.post_usage}</p> : null}
            </li>
          ))}
          {materials.length === 0 ? (
            <li className="text-neutral-400">この顧客の素材はまだ登録されていません。</li>
          ) : null}
        </ul>
      </section>
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-neutral-400">{label}</dt>
      <dd className="text-neutral-900">{value}</dd>
    </div>
  );
}
