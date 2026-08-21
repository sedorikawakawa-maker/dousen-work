import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listActiveStaff } from "@/lib/clients/queries";
import { listMaterialsForClient } from "@/lib/materials/queries";
import { PRODUCTION_TASK_STATUS_LABELS, POST_TYPE_LABELS } from "@/lib/clients/labels";
import { getMaterialWaitElapsedDays, getMaterialWaitLevel } from "@/lib/reminders/material";
import { setTaskMaterialWaitingAction, resolveTaskMaterialWaitingAction } from "./actions";

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

  const [{ data: client }, staffOptions, materials] = await Promise.all([
    supabase.from("clients_view").select("id, company_name, shop_name").eq("id", task.client_id).maybeSingle(),
    listActiveStaff(supabase),
    listMaterialsForClient(supabase, task.client_id),
  ]);

  const staffNameById = new Map(staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));

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
