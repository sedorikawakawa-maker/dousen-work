import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getClientDetail, listActiveStaff, listUpcomingProductionTasks } from "@/lib/clients/queries";
import {
  ASSIGNMENT_TYPE_LABELS,
  CLIENT_CURRENT_STATUS_LABELS,
  CONTRACT_STATUS_LABELS,
  LINK_TYPE_LABELS,
  POST_TYPE_LABELS,
  PRODUCTION_TASK_STATUS_LABELS,
} from "@/lib/clients/labels";
import { describeWeekdayRule, isWeekdayRule, type WeekdayRule } from "@/lib/scheduling/weekdayRule";
import { ensureRollingTasksForClient, getMonthlySummary } from "@/lib/scheduling/generate";
import { getMaterialWaitElapsedDays, getMaterialWaitLevel } from "@/lib/reminders/material";
import { updateTaskScheduledDateAction } from "./actions";

const TABS = [
  { key: "overview", label: "概要" },
  { key: "contract", label: "契約・担当" },
  { key: "profile", label: "制作方針" },
  { key: "schedule", label: "投稿スケジュール" },
  { key: "consumption", label: "運用・消化" },
  { key: "materials", label: "素材" },
  { key: "posts", label: "投稿履歴" },
  { key: "confirmations", label: "顧客確認履歴" },
  { key: "links", label: "SNS・リンク" },
  { key: "credentials", label: "ログイン情報" },
  { key: "history", label: "履歴" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const NOT_YET_IMPLEMENTED: Partial<Record<TabKey, string>> = {
  consumption: "Phase 4（担当者ダッシュボード）以降で実装予定です。",
  materials: "Phase 5（素材）で実装予定です。",
  posts: "Phase 8（投稿実績）で実装予定です。",
  confirmations: "Phase 7（顧客確認）で実装予定です。",
};

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const activeTab: TabKey = TABS.some((t) => t.key === tab) ? (tab as TabKey) : "overview";

  const supabase = await createSupabaseServerClient();
  const [detail, staffOptions] = await Promise.all([
    getClientDetail(supabase, id),
    listActiveStaff(supabase),
  ]);

  if (!detail.client) {
    notFound();
  }

  const client = detail.client;
  const staffNameById = new Map(
    staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]),
  );

  let monthlySummary: Awaited<ReturnType<typeof getMonthlySummary>> = [];
  let upcomingTasks: Awaited<ReturnType<typeof listUpcomingProductionTasks>> = [];
  if (activeTab === "schedule") {
    await ensureRollingTasksForClient(supabase, id);
    [monthlySummary, upcomingTasks] = await Promise.all([
      getMonthlySummary(supabase, id),
      listUpcomingProductionTasks(supabase, id),
    ]);
  }

  const materialWaitDays =
    client.current_status === "material_waiting"
      ? getMaterialWaitElapsedDays(client.material_wait_started_at)
      : null;
  const materialWaitLevel =
    client.current_status === "material_waiting"
      ? getMaterialWaitLevel(client.material_wait_started_at)
      : "none";
  const materialWaitBadgeClass =
    materialWaitLevel === "urgent"
      ? "bg-red-100 text-red-700"
      : materialWaitLevel === "warning"
        ? "bg-yellow-100 text-yellow-700"
        : "bg-neutral-100 text-neutral-600";

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-8">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/clients" className="text-sm text-neutral-500">
            ← 顧客一覧に戻る
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-neutral-900">
            {client.company_name}
            {client.shop_name ? `（${client.shop_name}）` : ""}
          </h1>
          <p className="text-sm text-neutral-500">{client.client_code}</p>
        </div>
        <Link
          href={`/clients/${id}/edit`}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          編集
        </Link>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-neutral-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/clients/${id}?tab=${t.key}`}
            className={`rounded-t-md px-3 py-2 text-sm ${
              activeTab === t.key
                ? "border-b-2 border-neutral-900 font-medium text-neutral-900"
                : "text-neutral-500"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="rounded-lg border border-neutral-200 bg-white p-6">
        {NOT_YET_IMPLEMENTED[activeTab] ? (
          <p className="text-sm text-neutral-400">{NOT_YET_IMPLEMENTED[activeTab]}</p>
        ) : null}

        {activeTab === "overview" ? (
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <InfoRow label="契約状況" value={CONTRACT_STATUS_LABELS[client.contract_status]} />
            <div>
              <dt className="text-xs text-neutral-400">現在ステータス</dt>
              <dd className="flex items-center gap-2 text-neutral-900">
                {CLIENT_CURRENT_STATUS_LABELS[client.current_status]}
                {materialWaitDays !== null ? (
                  <span className={`rounded-full px-2 py-0.5 text-xs ${materialWaitBadgeClass}`}>
                    素材待ち{materialWaitDays}日経過
                  </span>
                ) : null}
              </dd>
            </div>
            <InfoRow label="電話番号" value={client.phone ?? "—"} />
            <InfoRow label="メールアドレス" value={client.email ?? "—"} />
            <InfoRow label="先方担当者" value={client.contact_name ?? "—"} />
            <InfoRow label="業種" value={client.industry ?? "—"} />
            <InfoRow label="流入経路" value={client.inflow_channel ?? "—"} />
            <InfoRow label="連絡手段" value={client.contact_method ?? "—"} />
            <div className="col-span-2">
              <InfoRow label="備考" value={client.notes ?? "—"} />
            </div>
          </dl>
        ) : null}

        {activeTab === "contract" ? (
          <div className="flex flex-col gap-6">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <InfoRow label="契約状況" value={CONTRACT_STATUS_LABELS[client.contract_status]} />
              <InfoRow label="契約開始日" value={client.contract_start_date ?? "—"} />
              <InfoRow label="契約終了日" value={client.contract_end_date ?? "—"} />
              <InfoRow
                label="売上"
                value={client.revenue_amount === null ? "—" : String(client.revenue_amount)}
              />
              <InfoRow
                label="料金"
                value={client.fee_amount === null ? "—" : String(client.fee_amount)}
              />
            </dl>
            <div>
              <h3 className="mb-2 text-xs font-semibold text-neutral-500">担当履歴</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {detail.assignments.map((a) => (
                  <li key={a.id}>
                    {ASSIGNMENT_TYPE_LABELS[a.assignment_type]}: {staffNameById.get(a.staff_id) ?? "不明なスタッフ"}
                    （{a.active_from} 〜 {a.active_to ?? "現在"}）
                  </li>
                ))}
                {detail.assignments.length === 0 ? (
                  <li className="text-neutral-400">担当履歴がありません</li>
                ) : null}
              </ul>
            </div>
          </div>
        ) : null}

        {activeTab === "profile" ? (
          detail.profile ? (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <InfoRow label="運用目的" value={detail.profile.purpose ?? "—"} />
              <InfoRow label="ターゲット層" value={detail.profile.target_audience ?? "—"} />
              <InfoRow label="コンテンツ方向性" value={detail.profile.content_direction ?? "—"} />
              <InfoRow label="トーン" value={detail.profile.tone ?? "—"} />
              <InfoRow label="CTA方針" value={detail.profile.cta_policy ?? "—"} />
              <InfoRow label="NG事項" value={detail.profile.ng_notes ?? "—"} />
              <InfoRow label="参考アカウント" value={detail.profile.reference_accounts ?? "—"} />
              <InfoRow label="ハッシュタグ方針" value={detail.profile.hashtag_policy ?? "—"} />
              <InfoRow label="ヒアリングシート" value={detail.profile.hearing_sheet_url ?? "—"} />
            </dl>
          ) : (
            <p className="text-sm text-neutral-400">制作方針は未登録です。</p>
          )
        ) : null}

        {activeTab === "schedule" ? (
          <div className="flex flex-col gap-8">
            <div>
              <h3 className="mb-2 text-xs font-semibold text-neutral-500">現在のルール</h3>
              <ul className="flex flex-col gap-2 text-sm">
                {detail.scheduleRules
                  .filter((rule) => rule.is_active)
                  .map((rule) => (
                    <li key={rule.id} className="rounded-md border border-neutral-200 px-3 py-2">
                      {POST_TYPE_LABELS[rule.post_type]} / 月{rule.monthly_target}本 /{" "}
                      {isWeekdayRule(rule.weekday_rule)
                        ? describeWeekdayRule(rule.weekday_rule as WeekdayRule)
                        : "曜日未設定"}
                      <span className="ml-2 text-xs text-neutral-400">
                        {rule.valid_from} 〜 {rule.valid_to ?? "継続中"}
                      </span>
                    </li>
                  ))}
                {detail.scheduleRules.filter((rule) => rule.is_active).length === 0 ? (
                  <li className="text-neutral-400">
                    投稿ルールが未登録です。編集画面から設定してください。
                  </li>
                ) : null}
              </ul>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold text-neutral-500">
                月間本数（通常＋持越し）
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-neutral-500">
                      <th className="px-2 py-1">月</th>
                      <th className="px-2 py-1">種別</th>
                      <th className="px-2 py-1">通常目標</th>
                      <th className="px-2 py-1">持越し</th>
                      <th className="px-2 py-1">必要本数</th>
                      <th className="px-2 py-1">実績</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlySummary.flatMap((month) =>
                      (["reel", "feed", "story"] as const)
                        .filter((postType) => month.byPostType[postType].target > 0 || month.byPostType[postType].carryover > 0)
                        .map((postType) => {
                          const row = month.byPostType[postType];
                          return (
                            <tr key={`${month.year}-${month.month0}-${postType}`} className="border-b border-neutral-100">
                              <td className="px-2 py-1">{month.label}</td>
                              <td className="px-2 py-1">{POST_TYPE_LABELS[postType]}</td>
                              <td className="px-2 py-1">{row.target}</td>
                              <td className="px-2 py-1">{row.carryover}</td>
                              <td className="px-2 py-1 font-medium">{row.required}</td>
                              <td className="px-2 py-1">{row.actual}</td>
                            </tr>
                          );
                        }),
                    )}
                  </tbody>
                </table>
                {monthlySummary.every((m) =>
                  (["reel", "feed", "story"] as const).every(
                    (postType) => m.byPostType[postType].target === 0 && m.byPostType[postType].carryover === 0,
                  ),
                ) ? (
                  <p className="mt-2 text-sm text-neutral-400">対象データがありません。</p>
                ) : null}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold text-neutral-500">
                今後の制作タスク（未完了）
              </h3>
              <ul className="flex flex-col gap-2 text-sm">
                {upcomingTasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 px-3 py-2"
                  >
                    <span>
                      {task.is_carryover ? (
                        <span className="mr-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                          持越し
                        </span>
                      ) : null}
                      {task.title} / {PRODUCTION_TASK_STATUS_LABELS[task.status]}
                      {task.assignee_staff_id ? (
                        <span className="ml-2 text-xs text-neutral-400">
                          担当: {staffNameById.get(task.assignee_staff_id) ?? "不明"}
                        </span>
                      ) : null}
                    </span>
                    <form action={updateTaskScheduledDateAction} className="flex items-center gap-2">
                      <input type="hidden" name="clientId" value={id} />
                      <input type="hidden" name="taskId" value={task.id} />
                      <input
                        type="date"
                        name="scheduledPostDate"
                        defaultValue={task.scheduled_post_date ?? ""}
                        className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
                      />
                      <button
                        type="submit"
                        className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700"
                      >
                        この1件だけ日付変更
                      </button>
                    </form>
                  </li>
                ))}
                {upcomingTasks.length === 0 ? (
                  <li className="text-neutral-400">未完了のタスクはありません。</li>
                ) : null}
              </ul>
            </div>
          </div>
        ) : null}

        {activeTab === "links" ? (
          <ul className="flex flex-col gap-2 text-sm">
            {detail.links.map((link) => (
              <li key={link.id}>
                <strong>{link.label || LINK_TYPE_LABELS[link.link_type]}</strong>:{" "}
                <a href={link.url} target="_blank" rel="noreferrer" className="underline">
                  {link.url}
                </a>
              </li>
            ))}
            {detail.links.length === 0 ? (
              <li className="text-neutral-400">登録済みのリンクはありません。</li>
            ) : null}
          </ul>
        ) : null}

        {activeTab === "credentials" ? (
          <ul className="flex flex-col gap-2 text-sm">
            {detail.credentials.map((c) => (
              <li key={c.id}>
                <strong>{c.service_name}</strong>
                {c.login_id ? ` / ID: ${c.login_id}` : ""}
                {c.password_vault_url ? (
                  <>
                    {" / 保管先: "}
                    <a href={c.password_vault_url} target="_blank" rel="noreferrer" className="underline">
                      リンク
                    </a>
                  </>
                ) : (
                  " / 保管先: —"
                )}
              </li>
            ))}
            {detail.credentials.length === 0 ? (
              <li className="text-neutral-400">登録済みのログイン情報はありません。</li>
            ) : null}
          </ul>
        ) : null}

        {activeTab === "history" ? (
          <ul className="flex flex-col gap-2 text-sm">
            {detail.activityLogs.map((log) => (
              <li key={log.id} className="border-b border-neutral-100 pb-2">
                <span className="text-neutral-400">
                  {new Date(log.created_at).toLocaleString("ja-JP")}
                </span>{" "}
                {log.actor_staff_id ? staffNameById.get(log.actor_staff_id) ?? "不明なスタッフ" : "システム"}{" "}
                — {log.action}
              </li>
            ))}
            {detail.activityLogs.length === 0 ? (
              <li className="text-neutral-400">履歴はありません。</li>
            ) : null}
          </ul>
        ) : null}
      </div>
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
