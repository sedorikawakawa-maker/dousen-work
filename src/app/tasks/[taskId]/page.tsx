import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listActiveStaff } from "@/lib/clients/queries";
import { listMaterialSubmissionsWithFilesForClient } from "@/lib/materials/queries";
import { listWChecksForTask } from "@/lib/wchecks/queries";
import { listClientConfirmationsForTask } from "@/lib/clientConfirmations/queries";
import { PRODUCTION_TASK_STATUS_LABELS, POST_TYPE_LABELS, postUsageLabel } from "@/lib/clients/labels";
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
  skipWCheckAction,
  startProductionAction,
} from "./actions";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { PageContainer } from "@/components/PageContainer";
import { StatusBadge } from "@/components/StatusBadge";
import { UrgencyBadge } from "@/components/UrgencyBadge";

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ saved?: string; error?: string; assetUrl?: string }>;
}) {
  const { taskId } = await params;
  const { saved, error, assetUrl } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const { data: task } = await supabase
    .from("production_tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) {
    notFound();
  }

  const [{ data: client }, staffOptions, materialSubmissions, wChecks, confirmations, { data: lineLink }] =
    await Promise.all([
      supabase.from("clients_view").select("id, company_name, shop_name").eq("id", task.client_id).maybeSingle(),
      listActiveStaff(supabase),
      listMaterialSubmissionsWithFilesForClient(supabase, task.client_id),
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

  const canSetMaterialWaiting =
    task.status === "production_waiting" || task.status === "in_production";
  const materialWaitLevel = getMaterialWaitLevel(task.material_wait_started_at);
  const materialWaitDays = getMaterialWaitElapsedDays(task.material_wait_started_at);

  const today = new Date().toISOString().slice(0, 10);
  const wcheckDueUrgency =
    !pendingWCheck || !task.wcheck_due_date
      ? null
      : task.wcheck_due_date < today
        ? "overdue"
        : task.wcheck_due_date === today
          ? "due_today"
          : null;

  return (
    <PageContainer className="max-w-2xl gap-5 bg-neutral-50 py-8">
      <div>
        {client ? (
          <Link href={`/clients/${client.id}?tab=schedule`} className="text-sm text-neutral-500">
            ← {client.company_name}
            {client.shop_name ? `（${client.shop_name}）` : ""} の投稿スケジュールに戻る
          </Link>
        ) : null}
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">{task.title}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-neutral-500">{POST_TYPE_LABELS[task.post_type]}</span>
          <StatusBadge status={task.status} label={PRODUCTION_TASK_STATUS_LABELS[task.status]} />
          {materialWaitDays !== null && materialWaitLevel !== "none" ? (
            <>
              <UrgencyBadge level={materialWaitLevel === "urgent" ? "urgent" : "warning"} />
              <span className="text-xs text-neutral-500">{materialWaitDays}日経過</span>
            </>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-neutral-500">投稿予定日: {task.scheduled_post_date ?? "未定"}</p>
      </div>

      {saved ? (
        <p className="rounded-2xl bg-[var(--accent-soft-bg)] px-4 py-2 text-sm text-[var(--accent-soft-text)]">
          更新しました。
        </p>
      ) : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p> : null}

      {/* 次にやる操作 */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-xs font-semibold text-neutral-500">次にやる操作</h2>
        {task.status === "posting_waiting" && client ? (
          <Link
            href={`/clients/${client.id}/post-records/new?type=${task.post_type}&taskId=${task.id}`}
            className="block w-full rounded-full bg-[var(--accent)] px-4 py-3.5 text-center text-base font-semibold text-white hover:bg-[var(--accent-strong)]"
          >
            投稿実績を登録する
          </Link>
        ) : task.status === "production_waiting" ? (
          <form action={startProductionAction}>
            <input type="hidden" name="taskId" value={taskId} />
            <button
              type="submit"
              className="w-full rounded-full bg-[var(--accent)] px-4 py-3.5 text-base font-semibold text-white hover:bg-[var(--accent-strong)]"
            >
              制作を開始する（制作中にする）
            </button>
          </form>
        ) : task.status === "in_production" ? (
          <p className="text-sm text-neutral-600">
            制作物ができたら、下の「Wチェック」欄からWチェックを登録してください。
          </p>
        ) : task.status === "wcheck_waiting" ? (
          <p className="text-sm text-neutral-600">Wチェック待ちです。下の「Wチェック」欄で対応してください。</p>
        ) : task.status === "client_confirmation_waiting" ? (
          <p className="text-sm text-neutral-600">
            {pendingConfirmation
              ? "顧客からの回答待ちです。下の「顧客確認」欄で対応してください。"
              : "顧客へ確認を依頼し、下の「顧客確認」欄で「顧客確認依頼済みにする」を押してください。"}
          </p>
        ) : task.status === "material_waiting" ? (
          <p className="text-sm text-neutral-600">
            素材待ち中です。素材が届いたら、下の「素材待ちへの変更」欄で状態を解除してください。
          </p>
        ) : (
          <p className="text-sm text-neutral-400">現在、対応が必要な操作はありません。</p>
        )}
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-xs font-semibold text-neutral-500">タスク詳細</h2>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <InfoRow label="持越し" value={task.is_carryover ? "はい" : "いいえ"} />
          <InfoRow label="制作開始予定" value={task.production_start_date ?? "—"} />
          <div>
            <dt className="text-xs text-neutral-400">Wチェック期限</dt>
            <dd className="flex items-center gap-1.5 text-neutral-900">
              {task.wcheck_due_date ?? "—"}
              {wcheckDueUrgency ? <UrgencyBadge level={wcheckDueUrgency} /> : null}
            </dd>
          </div>
          <InfoRow label="顧客確認期限" value={task.client_confirm_due_date ?? "—"} />
          <InfoRow
            label="担当"
            value={task.assignee_staff_id ? staffNameById.get(task.assignee_staff_id) ?? "不明" : "未割当"}
          />
          <InfoRow
            label="副担当"
            value={task.secondary_staff_id ? staffNameById.get(task.secondary_staff_id) ?? "不明" : "—"}
          />
        </dl>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-xs font-semibold text-neutral-500">素材待ちへの変更</h2>
        {canSetMaterialWaiting ? (
          <form action={setTaskMaterialWaitingAction} className="flex flex-col gap-2">
            <input type="hidden" name="taskId" value={taskId} />
            <p className="text-xs text-neutral-500">
              素材が届いておらず制作を進められない場合に設定します。設定時点の日時を記録します。
            </p>
            <button
              type="submit"
              className="w-full rounded-full border border-orange-300 bg-orange-50 px-4 py-2.5 text-sm font-medium text-orange-800"
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
                className="flex-1 rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700"
              >
                制作待ちに戻す
              </button>
              <button
                type="submit"
                name="nextStatus"
                value="in_production"
                className="flex-1 rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700"
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

      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-xs font-semibold text-neutral-500">この顧客の素材一覧</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {materialSubmissions.map(({ submission, files }) => (
            <li key={submission.id} className="rounded-xl border border-neutral-200 px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {submission.title}
                  <span className="ml-2 text-xs text-neutral-400">{files.length}ファイル</span>
                </span>
                <span className="text-xs text-neutral-400">
                  {new Date(submission.received_at).toLocaleDateString("ja-JP")} 受領
                </span>
              </div>
              {submission.post_usage ? (
                <p className="text-xs text-neutral-500">用途: {postUsageLabel(submission.post_usage)}</p>
              ) : null}
            </li>
          ))}
          {materialSubmissions.length === 0 ? (
            <li className="text-neutral-400">この顧客の素材はまだ登録されていません。</li>
          ) : null}
        </ul>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-xs font-semibold text-neutral-500">Wチェック</h2>

        <div className="mb-4 rounded-2xl bg-purple-50 px-3.5 py-2.5 text-xs text-purple-800">
          チェック基準: {WCHECK_CRITERIA.join(" / ")}
        </div>

        {pendingWCheck ? (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
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
            </dl>
            <a
              href={pendingWCheck.asset_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1.5 rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700"
            >
              {pendingWCheck.asset_type === "drive_video" ? "動画を開く" : "Canvaを開く"}
            </a>
            {pendingWCheck.notes ? (
              <p className="text-xs text-neutral-500">補足: {pendingWCheck.notes}</p>
            ) : null}

            <div className="grid grid-cols-1 gap-2 border-t border-neutral-100 pt-3 sm:grid-cols-2">
              <form action={approveWCheckAction}>
                <input type="hidden" name="wcheckId" value={pendingWCheck.id} />
                <input type="hidden" name="taskId" value={taskId} />
                <input type="hidden" name="returnTo" value={`/tasks/${taskId}`} />
                <button
                  type="submit"
                  className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]"
                >
                  確認する（OK）
                </button>
              </form>
              <details className="rounded-full">
                <summary className="cursor-pointer rounded-full border border-neutral-300 px-4 py-3 text-center text-sm font-medium text-neutral-500">
                  修正依頼
                </summary>
                <form action={requestWCheckRevisionAction} className="mt-2 flex flex-col gap-2 rounded-2xl bg-neutral-50 p-3">
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
                    className="w-full rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
                  >
                    修正依頼を送る
                  </button>
                </form>
              </details>
            </div>
          </div>
        ) : (
          <>
            <form action={registerWCheckAction} className="flex flex-col gap-3">
              <input type="hidden" name="taskId" value={taskId} />
              <label className="text-sm font-medium text-neutral-700">
                {WCHECK_ASSET_TYPE_LABELS[assetTypeForPostType(task.post_type)]}
                <input
                  name="assetUrl"
                  type="url"
                  required
                  defaultValue={assetUrl ?? ""}
                  className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
                />
                {assetUrl ? (
                  <span className="mt-1 block text-xs text-neutral-400">
                    外注納品物のリンクを入力済みです。必要に応じて変更してください。
                  </span>
                ) : null}
              </label>
              <label className="text-sm font-medium text-neutral-700">
                Wチェック担当（任意）
                <select
                  name="reviewerStaffId"
                  defaultValue=""
                  className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
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
                  className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base"
                />
              </label>
              <button
                type="submit"
                className="mt-1 w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]"
              >
                Wチェック登録
              </button>
            </form>

            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-neutral-400 underline">
                Wチェックを省略して顧客確認へ
              </summary>
              <form action={skipWCheckAction} className="mt-2 flex flex-col gap-2 rounded-2xl bg-neutral-50 p-3.5">
                <input type="hidden" name="taskId" value={taskId} />
                <input type="hidden" name="returnTo" value={`/tasks/${taskId}`} />
                <p className="text-xs text-neutral-500">
                  Wチェックを行わず、このタスクを直接「顧客確認待ち」へ進めます。この操作は記録に残ります。
                </p>
                <textarea
                  name="reason"
                  rows={2}
                  placeholder="理由（任意）"
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
                <ConfirmSubmitButton
                  confirmMessage="このタスクはWチェックを行わず顧客確認へ進みます。よろしいですか？"
                  className="self-start rounded-full border border-neutral-300 px-3.5 py-2 text-xs text-neutral-600"
                >
                  Wチェックを省略して顧客確認へ進める
                </ConfirmSubmitButton>
              </form>
            </details>
          </>
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

      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-xs font-semibold text-neutral-500">顧客確認</h2>

        {pendingConfirmation ? (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-neutral-400">確認依頼日</dt>
                <dd className="flex flex-wrap items-center gap-1.5 text-neutral-900">
                  {new Date(pendingConfirmation.requested_at).toLocaleString("ja-JP")}
                  {confirmationLevel !== "none" ? <UrgencyBadge level={confirmationLevel} /> : null}
                  {confirmationDays !== null ? (
                    <span className="text-xs text-neutral-500">{confirmationDays}日経過</span>
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
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent-soft-bg)] px-4 py-2.5 text-sm font-medium text-[var(--accent-soft-text)]"
              >
                公式LINEを開く
              </a>
            ) : null}

            <div className="grid grid-cols-1 gap-2 border-t border-neutral-100 pt-3 sm:grid-cols-2">
              <form action={approveClientConfirmationAction}>
                <input type="hidden" name="confirmationId" value={pendingConfirmation.id} />
                <input type="hidden" name="taskId" value={taskId} />
                <input type="hidden" name="returnTo" value={`/tasks/${taskId}`} />
                <button
                  type="submit"
                  className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]"
                >
                  顧客OK
                </button>
              </form>
              <details className="rounded-full">
                <summary className="cursor-pointer rounded-full border border-neutral-300 px-4 py-3 text-center text-sm font-medium text-neutral-500">
                  修正依頼
                </summary>
                <form
                  action={requestClientConfirmationRevisionAction}
                  className="mt-2 flex flex-col gap-2 rounded-2xl bg-neutral-50 p-3"
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
                    className="w-full rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
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
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent-soft-bg)] px-4 py-2.5 text-sm font-medium text-[var(--accent-soft-text)]"
              >
                公式LINEを開く
              </a>
            ) : null}
            <button
              type="submit"
              className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]"
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
    </PageContainer>
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
