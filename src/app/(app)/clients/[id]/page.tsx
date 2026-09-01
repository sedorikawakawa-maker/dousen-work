import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getClientDetail,
  listActiveStaff,
  listClientLoginStaffForClient,
  listUpcomingProductionTasks,
  type ClientLoginStaffEntry,
} from "@/lib/clients/queries";
import {
  ASSIGNMENT_TYPE_LABELS,
  CLIENT_CURRENT_STATUS_LABELS,
  CONTRACT_STATUS_LABELS,
  LINK_TYPE_LABELS,
  POST_TYPE_LABELS,
  POST_TYPE_OPTIONS,
  PRODUCTION_TASK_STATUS_LABELS,
  postUsageLabel,
} from "@/lib/clients/labels";
import { describeWeekdayRule, isWeekdayRule, type WeekdayRule } from "@/lib/scheduling/weekdayRule";
import { ensureRollingTasksForClient, getMonthlySummary } from "@/lib/scheduling/generate";
import { getMaterialWaitElapsedDays, getMaterialWaitLevel } from "@/lib/reminders/material";
import {
  listMaterialOptionsForClient,
  listMaterialSubmissionsWithFilesForClient,
  type MaterialSubmissionWithFiles,
} from "@/lib/materials/queries";
import { buildMaterialFormUrl } from "@/lib/materials/formToken";
import { listClientConfirmationsForClient } from "@/lib/clientConfirmations/queries";
import { CLIENT_CONFIRMATION_STATUS_LABELS } from "@/lib/clientConfirmations/labels";
import { listPostRecordsForClient, listRecentlyCompletedTasks } from "@/lib/postRecords/queries";
import { cancelPostRecordAction } from "@/app/(app)/post-records/actions";
import { addProductionVideoAction } from "@/app/(app)/production-videos/actions";
import { listProductionVideosForClient, type ProductionVideoRow } from "@/lib/productionVideos/queries";
import { resolveProductionVideoFolder } from "@/lib/productionVideos/upload";
import { DriveMockNotice } from "@/components/DriveMockNotice";
import { CopyButton } from "@/components/CopyButton";
import { StatusBadge } from "@/components/StatusBadge";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import { PageContainer } from "@/components/PageContainer";
import { ClientAvatar } from "@/components/ClientAvatar";
import { SubmitButton } from "@/components/SubmitButton";
import {
  addMaterialAction,
  issueMaterialFormTokenAction,
  removeClientThumbnailAction,
  revokeMaterialFormTokenAction,
  updateTaskScheduledDateAction,
  uploadClientThumbnailAction,
} from "./actions";

const TABS = [
  { key: "overview", label: "概要" },
  { key: "contract", label: "契約・担当" },
  { key: "profile", label: "制作方針" },
  { key: "schedule", label: "投稿スケジュール" },
  { key: "consumption", label: "運用・消化" },
  { key: "materials", label: "素材" },
  { key: "productionVideos", label: "制作動画" },
  { key: "posts", label: "投稿履歴" },
  { key: "confirmations", label: "顧客確認履歴" },
  { key: "links", label: "SNS・リンク" },
  { key: "credentials", label: "ログイン情報" },
  { key: "history", label: "履歴" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** タブの並び・キー・URLパラメータは変えず、見た目のグルーピングだけに使う。 */
const TAB_GROUPS: { label: string; keys: TabKey[] }[] = [
  { label: "基本", keys: ["overview", "contract"] },
  { label: "制作・運用", keys: ["profile", "schedule", "consumption"] },
  { label: "やり取り", keys: ["materials", "productionVideos", "posts", "confirmations"] },
  { label: "参照情報", keys: ["links", "credentials", "history"] },
];

const NOT_YET_IMPLEMENTED: Partial<Record<TabKey, string>> = {
  consumption: "Phase 4（担当者ダッシュボード）以降で実装予定です。",
};

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; newToken?: string; saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const { tab, newToken, saved, error } = await searchParams;
  const activeTab: TabKey = TABS.some((t) => t.key === tab) ? (tab as TabKey) : "overview";
  const activeGroup = TAB_GROUPS.find((group) => group.keys.includes(activeTab)) ?? TAB_GROUPS[0];

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
  const todayIsoStr = new Date().toISOString().slice(0, 10);

  let monthlySummary: Awaited<ReturnType<typeof getMonthlySummary>> = [];
  let upcomingTasks: Awaited<ReturnType<typeof listUpcomingProductionTasks>> = [];
  let recentlyCompletedTasks: Awaited<ReturnType<typeof listRecentlyCompletedTasks>> = [];
  if (activeTab === "schedule") {
    await ensureRollingTasksForClient(supabase, id);
    [monthlySummary, upcomingTasks, recentlyCompletedTasks] = await Promise.all([
      getMonthlySummary(supabase, id),
      listUpcomingProductionTasks(supabase, id),
      listRecentlyCompletedTasks(supabase, id),
    ]);
  }

  let materialSubmissions: MaterialSubmissionWithFiles[] = [];
  let hasActiveMaterialFormToken = false;
  let newlyIssuedFormUrl: string | null = null;
  if (activeTab === "materials") {
    const [materialsResult, tokenResult] = await Promise.all([
      listMaterialSubmissionsWithFilesForClient(supabase, id),
      supabase
        .from("material_form_tokens")
        .select("id")
        .eq("client_id", id)
        .eq("is_active", true)
        .maybeSingle(),
    ]);
    materialSubmissions = materialsResult;
    hasActiveMaterialFormToken = !!tokenResult.data;
    if (newToken) {
      newlyIssuedFormUrl = await buildMaterialFormUrl(newToken);
    }
  }

  let confirmations: Awaited<ReturnType<typeof listClientConfirmationsForClient>> = [];
  if (activeTab === "confirmations") {
    confirmations = await listClientConfirmationsForClient(supabase, id);
  }

  let productionVideos: ProductionVideoRow[] = [];
  let productionVideoFolderUrl: string | null = null;
  if (activeTab === "productionVideos") {
    productionVideos = await listProductionVideosForClient(supabase, id);
    // フォルダの解決はこのタブを開いたときだけ、かつ既に1件以上動画がある場合のみ行う。
    // 0件の顧客で毎回resolveすると「見ただけ」でDrive側に空の制作動画フォルダを
    // 作ってしまう（findOrCreateFolderは無ければ作成するため）ので、それを避ける。
    if (productionVideos.length > 0) {
      try {
        const folder = await resolveProductionVideoFolder(id);
        productionVideoFolderUrl = folder.folderUrl;
      } catch {
        productionVideoFolderUrl = null;
      }
    }
  }

  let loginStaff: ClientLoginStaffEntry[] = [];
  if (activeTab === "credentials") {
    loginStaff = await listClientLoginStaffForClient(supabase, id);
  }

  let postRecords: Awaited<ReturnType<typeof listPostRecordsForClient>> = [];
  let materialTitleById = new Map<string, string>();
  if (activeTab === "posts") {
    const [postRecordsResult, materialOptions] = await Promise.all([
      listPostRecordsForClient(supabase, id),
      listMaterialOptionsForClient(supabase, id),
    ]);
    postRecords = postRecordsResult;
    materialTitleById = new Map(materialOptions.map((o) => [o.id, o.label]));
  }

  const materialWaitDays =
    client.current_status === "material_waiting"
      ? getMaterialWaitElapsedDays(client.material_wait_started_at)
      : null;
  const materialWaitLevel =
    client.current_status === "material_waiting"
      ? getMaterialWaitLevel(client.material_wait_started_at)
      : "none";

  return (
    <PageContainer className="gap-5 bg-neutral-50 py-8">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ClientAvatar thumbnailUrl={client.thumbnail_url} name={client.company_name} size="md" />
          <div>
            <Link href="/clients" className="text-sm text-neutral-500">
              ← 顧客一覧に戻る
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-neutral-900">
                {client.company_name}
                {client.shop_name ? `（${client.shop_name}）` : ""}
              </h1>
              {materialWaitDays !== null && materialWaitLevel !== "none" ? (
                <UrgencyBadge level={materialWaitLevel === "urgent" ? "urgent" : "warning"} />
              ) : null}
              <StatusBadge
                status={client.current_status}
                label={CLIENT_CURRENT_STATUS_LABELS[client.current_status]}
              />
              {materialWaitDays !== null && materialWaitLevel !== "none" ? (
                <span className="text-xs font-medium tabular-nums text-neutral-500">
                  {materialWaitDays}日経過
                </span>
              ) : null}
            </div>
            <p className="text-sm font-medium tabular-nums text-neutral-500">{client.client_code}</p>
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-neutral-500 underline">
                {client.thumbnail_url ? "サムネイル画像を変更" : "サムネイル画像を登録"}
              </summary>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <form action={uploadClientThumbnailAction} className="flex items-center gap-2">
                  <input type="hidden" name="clientId" value={id} />
                  <input name="file" type="file" accept="image/jpeg,image/png,image/webp" className="text-xs" />
                  <button
                    type="submit"
                    className="whitespace-nowrap rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700"
                  >
                    アップロード
                  </button>
                </form>
                {client.thumbnail_url ? (
                  <form action={removeClientThumbnailAction}>
                    <input type="hidden" name="clientId" value={id} />
                    <button type="submit" className="text-xs text-red-600 underline">
                      削除
                    </button>
                  </form>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] text-neutral-500">jpg・png・webp / 5MB以下</p>
            </details>
          </div>
        </div>
        <Link
          href={`/clients/${id}/edit`}
          className="whitespace-nowrap rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]"
        >
          編集
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        <nav className="grid grid-cols-4 gap-1 rounded-2xl bg-neutral-100 p-1">
          {TAB_GROUPS.map((group) => {
            const isActiveGroup = group === activeGroup;
            return (
              <Link
                key={group.label}
                href={`/clients/${id}?tab=${group.keys[0]}`}
                className={`rounded-xl px-2 py-2.5 text-center text-xs font-semibold sm:text-sm ${
                  isActiveGroup ? "bg-white text-[var(--accent-strong)] shadow-sm" : "text-neutral-500"
                }`}
              >
                {group.label}
              </Link>
            );
          })}
        </nav>

        <nav className="flex flex-wrap gap-x-5 gap-y-1 border-b border-neutral-200 px-1">
          {activeGroup.keys.map((key) => {
            const tab = TABS.find((t) => t.key === key)!;
            const isActive = activeTab === key;
            return (
              <Link
                key={key}
                href={`/clients/${id}?tab=${key}`}
                className={`border-b-2 pb-2 text-sm ${
                  isActive
                    ? "border-[var(--accent)] font-medium text-neutral-900"
                    : "border-transparent text-neutral-500"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="rounded-2xl bg-white p-5 sm:p-6">
        {NOT_YET_IMPLEMENTED[activeTab] ? (
          <p className="text-sm text-neutral-400">{NOT_YET_IMPLEMENTED[activeTab]}</p>
        ) : null}

        {activeTab === "overview" ? (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-10">
              <div>
                <h3 className="mb-3 text-sm font-semibold text-neutral-700">登録状況</h3>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <InfoRow label="契約状況" value={CONTRACT_STATUS_LABELS[client.contract_status]} />
                  <InfoRow label="業種" value={client.industry ?? "—"} />
                  <InfoRow label="流入経路" value={client.inflow_channel ?? "—"} />
                </dl>
                <div className="mt-4">
                  <dt className="text-xs text-neutral-500">提供サービス</dt>
                  <dd className="mt-1.5 flex flex-wrap gap-1.5">
                    {client.services.length > 0 ? (
                      client.services.map((service) => (
                        <span
                          key={service}
                          className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600"
                        >
                          {service}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-neutral-900">—</span>
                    )}
                  </dd>
                </div>
              </div>
              <div className="border-t border-neutral-100 pt-6 lg:border-t-0 lg:border-l lg:pl-10 lg:pt-0">
                <h3 className="mb-3 text-sm font-semibold text-neutral-700">連絡先</h3>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <InfoRow label="電話番号" value={client.phone ?? "—"} />
                  <InfoRow label="メールアドレス" value={client.email ?? "—"} />
                  <InfoRow label="先方担当者" value={client.contact_name ?? "—"} />
                  <InfoRow label="連絡手段" value={client.contact_method ?? "—"} />
                </dl>
              </div>
            </div>
            <div className="border-t border-neutral-100 pt-6">
              <h3 className="mb-2 text-sm font-semibold text-neutral-700">備考</h3>
              <p className="max-w-2xl text-sm text-neutral-900">{client.notes ?? "—"}</p>
            </div>
          </div>
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
              <h3 className="mb-2 text-sm font-semibold text-neutral-700">担当履歴</h3>
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
              <h3 className="mb-2 text-sm font-semibold text-neutral-700">現在のルール</h3>
              <ul className="flex flex-col gap-2 text-sm">
                {detail.scheduleRules
                  .filter((rule) => rule.is_active)
                  .map((rule) => (
                    <li key={rule.id} className="rounded-md border border-neutral-200 px-3 py-2">
                      {POST_TYPE_LABELS[rule.post_type]} / 月{rule.monthly_target}本 /{" "}
                      {isWeekdayRule(rule.weekday_rule)
                        ? describeWeekdayRule(rule.weekday_rule as WeekdayRule)
                        : "曜日未設定"}
                      <span className="ml-2 text-xs font-medium tabular-nums text-neutral-500">
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
              <h3 className="mb-2 text-sm font-semibold text-neutral-700">
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
                      <th className="px-2 py-1">残り</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlySummary.flatMap((month) =>
                      (["reel", "feed", "story"] as const)
                        .filter((postType) => month.byPostType[postType].target > 0 || month.byPostType[postType].carryover > 0)
                        .map((postType) => {
                          const row = month.byPostType[postType];
                          const remaining = Math.max(row.required - row.actual, 0);
                          return (
                            <tr key={`${month.year}-${month.month0}-${postType}`} className="border-b border-neutral-100">
                              <td className="px-2 py-1">{month.label}</td>
                              <td className="px-2 py-1">{POST_TYPE_LABELS[postType]}</td>
                              <td className="px-2 py-1">{row.target}</td>
                              <td className="px-2 py-1">
                                {row.carryover > 0 ? (
                                  <span>
                                    {row.carryover}本
                                    {row.carryoverNeedsReschedule > 0 ? (
                                      <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                                        再日程設定が必要
                                      </span>
                                    ) : null}
                                  </span>
                                ) : (
                                  0
                                )}
                              </td>
                              <td className="px-2 py-1 font-medium">{row.required}</td>
                              <td className="px-2 py-1">{row.actual}</td>
                              <td className="px-2 py-1">
                                {remaining > 0 ? (
                                  <span className="font-medium text-red-700">{remaining}</span>
                                ) : (
                                  <span className="text-green-700">0</span>
                                )}
                              </td>
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
              <h3 className="mb-2 text-sm font-semibold text-neutral-700">
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
                          {!task.scheduled_post_date || task.scheduled_post_date < todayIsoStr
                            ? "前月持越し・再日程設定が必要"
                            : "前月持越し"}
                        </span>
                      ) : null}
                      <Link href={`/tasks/${task.id}`} className="hover:underline">
                        {task.title}
                      </Link>{" "}
                      / {PRODUCTION_TASK_STATUS_LABELS[task.status]}
                      {task.status === "material_waiting" ? (
                        <span className="ml-2 rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                          素材待ち
                          {getMaterialWaitElapsedDays(task.material_wait_started_at) !== null
                            ? `${getMaterialWaitElapsedDays(task.material_wait_started_at)}日経過`
                            : ""}
                        </span>
                      ) : null}
                      {task.assignee_staff_id ? (
                        <span className="ml-2 text-xs text-neutral-500">
                          担当: {staffNameById.get(task.assignee_staff_id) ?? "不明"}
                        </span>
                      ) : (
                        <span className="ml-2 rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                          未割当
                        </span>
                      )}
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

            <div>
              <h3 className="mb-2 text-sm font-semibold text-neutral-700">投稿済み（直近）</h3>
              <ul className="flex flex-col gap-2 text-sm">
                {recentlyCompletedTasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 px-3 py-2"
                  >
                    <span>
                      <span className="mr-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                        投稿済み
                      </span>
                      {task.title}
                    </span>
                    <Link href={`/clients/${id}?tab=posts`} className="text-xs underline">
                      投稿履歴を見る
                    </Link>
                  </li>
                ))}
                {recentlyCompletedTasks.length === 0 ? (
                  <li className="text-neutral-400">投稿済みのタスクはまだありません。</li>
                ) : null}
              </ul>
            </div>
          </div>
        ) : null}

        {activeTab === "materials" ? (
          <div className="flex flex-col gap-6">
            {saved ? (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                更新しました。
              </p>
            ) : null}
            {error ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}

            <div className="rounded-md border border-neutral-200 p-3">
              <h3 className="mb-2 text-sm font-semibold text-neutral-700">
                顧客向け素材アップロードフォーム
              </h3>

              {newlyIssuedFormUrl ? (
                <div className="mb-3 flex flex-col gap-2 rounded-md bg-yellow-50 px-3 py-2">
                  <p className="text-xs text-yellow-800">
                    発行しました。このURLは今だけ表示されます。必ずコピーして顧客へ共有してください。
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate font-mono text-xs">{newlyIssuedFormUrl}</span>
                    <CopyButton text={newlyIssuedFormUrl} />
                  </div>
                </div>
              ) : (
                <p className="mb-3 text-xs text-neutral-500">
                  {hasActiveMaterialFormToken
                    ? "発行済みです（URLは発行・再発行の直後のみ表示されます）。"
                    : "未発行です。"}
                </p>
              )}

              <div className="flex gap-2">
                <form action={issueMaterialFormTokenAction}>
                  <input type="hidden" name="clientId" value={id} />
                  <button
                    type="submit"
                    className="rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-700"
                  >
                    {hasActiveMaterialFormToken ? "URLを再発行" : "URLを発行"}
                  </button>
                </form>
                {hasActiveMaterialFormToken ? (
                  <form action={revokeMaterialFormTokenAction}>
                    <input type="hidden" name="clientId" value={id} />
                    <button
                      type="submit"
                      className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700"
                    >
                      無効化する
                    </button>
                  </form>
                ) : null}
              </div>
            </div>

            <ul className="flex flex-col gap-2 text-sm">
              {materialSubmissions.map(({ submission, files }) => (
                <li key={submission.id} className="rounded-md border border-neutral-200">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 marker:content-none">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium">{submission.title}</span>
                        <span className="text-xs text-neutral-500">
                          {postUsageLabel(submission.post_usage)}
                        </span>
                        {submission.requested_post_timing ? (
                          <span className="text-xs text-neutral-500">
                            {submission.requested_post_timing}
                          </span>
                        ) : null}
                        <span className="text-xs text-neutral-500">{files.length}ファイル</span>
                        {submission.shot_date ? (
                          <span className="text-xs text-neutral-500">撮影日: {submission.shot_date}</span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-neutral-500">
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5">
                          {submission.submitted_by_type === "client" ? "顧客提出" : "スタッフ登録"}
                        </span>
                        <span className="font-medium tabular-nums">
                          {new Date(submission.received_at).toLocaleString("ja-JP")}
                        </span>{" "}
                        受領
                      </span>
                    </summary>
                    <div className="border-t border-neutral-100 px-3 py-2">
                      {submission.drive_folder_url ? (
                        <a
                          href={submission.drive_folder_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mb-2 inline-block text-xs underline"
                        >
                          Google Driveでまとめて開く
                        </a>
                      ) : null}
                      {submission.editing_instructions ? (
                        <p className="mt-1 text-xs text-neutral-600">
                          編集指示: {submission.editing_instructions}
                        </p>
                      ) : null}
                      {submission.caption_instructions ? (
                        <p className="mt-1 text-xs text-neutral-600">
                          キャプション: {submission.caption_instructions}
                        </p>
                      ) : null}
                      {submission.contact_notes ? (
                        <p className="mt-1 text-xs text-neutral-600">
                          連絡事項: {submission.contact_notes}
                        </p>
                      ) : null}
                      <ul className="mt-2 flex flex-col gap-1">
                        {files.map((file) => (
                          <li
                            key={file.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-neutral-50 px-2 py-1 text-xs"
                          >
                            <span className="text-neutral-700">{file.file_name ?? "（ファイル名不明）"}</span>
                            {file.drive_url ? (
                              <a href={file.drive_url} target="_blank" rel="noreferrer" className="underline">
                                Driveで開く
                              </a>
                            ) : (
                              <span className="text-neutral-400">未登録</span>
                            )}
                          </li>
                        ))}
                        {files.length === 0 ? (
                          <li className="text-neutral-400">ファイルはありません。</li>
                        ) : null}
                      </ul>
                    </div>
                  </details>
                </li>
              ))}
              {materialSubmissions.length === 0 ? (
                <li className="text-neutral-400">登録済みの素材はありません。</li>
              ) : null}
            </ul>

            <form
              action={addMaterialAction}
              className="flex flex-col gap-3 border-t border-neutral-100 pt-4"
            >
              <input type="hidden" name="clientId" value={id} />
              <h3 className="text-sm font-semibold text-neutral-700">
                スタッフによる手動登録（LINE・メール等で受領した場合）
              </h3>
              <MaterialFields />
              <DriveMockNotice />
              <button
                type="submit"
                className="mt-1 w-full rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
              >
                登録する
              </button>
            </form>
          </div>
        ) : null}

        {activeTab === "productionVideos" ? (
          <div className="flex flex-col gap-6">
            {saved ? (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                アップロードしました。
              </p>
            ) : null}
            {error ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-neutral-500">
                完成した納品用・投稿用動画の保管庫です。制作途中の動画や投稿完了フローとは連動しません。
              </p>
              {productionVideoFolderUrl ? (
                <a
                  href={productionVideoFolderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-xs underline"
                >
                  Google Driveでまとめて開く
                </a>
              ) : null}
            </div>

            <ul className="flex flex-col gap-2 text-sm">
              {productionVideos.map((video) => (
                <li
                  key={video.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium">{video.file_name ?? "（ファイル名不明）"}</span>
                      {video.post_type ? (
                        <span className="text-xs text-neutral-500">{POST_TYPE_LABELS[video.post_type]}</span>
                      ) : null}
                    </div>
                    <p className="text-xs text-neutral-500">
                      <span className="font-medium tabular-nums">
                        {new Date(video.created_at).toLocaleString("ja-JP")}
                      </span>{" "}
                      / {staffNameById.get(video.uploaded_by_staff_id) ?? "不明"}
                    </p>
                    {video.memo ? <p className="mt-0.5 text-xs text-neutral-600">メモ: {video.memo}</p> : null}
                  </div>
                  <a href={video.drive_url} target="_blank" rel="noreferrer" className="shrink-0 text-xs underline">
                    Driveで開く
                  </a>
                </li>
              ))}
              {productionVideos.length === 0 ? (
                <li className="text-neutral-400">登録済みの制作動画はありません。</li>
              ) : null}
            </ul>

            <form
              action={addProductionVideoAction}
              className="flex flex-col gap-3 border-t border-neutral-100 pt-4"
            >
              <input type="hidden" name="clientId" value={id} />
              <input type="hidden" name="returnTo" value={`/clients/${id}?tab=productionVideos`} />
              <h3 className="text-sm font-semibold text-neutral-700">制作動画をアップロード</h3>
              <label className="text-sm font-medium text-neutral-700">
                ファイル（複数選択可）
                <input
                  name="files"
                  type="file"
                  multiple
                  required
                  accept="video/*"
                  className="mt-1.5 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm font-medium text-neutral-700">
                投稿種別（任意）
                <select
                  name="postType"
                  defaultValue=""
                  className="mt-1.5 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                >
                  <option value="">未指定</option>
                  {POST_TYPE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-neutral-700">
                メモ（任意）
                <textarea
                  name="memo"
                  rows={2}
                  className="mt-1.5 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </label>
              <DriveMockNotice />
              <SubmitButton
                pendingText="アップロード中..."
                className="mt-1 w-full rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
              >
                アップロードする
              </SubmitButton>
            </form>
          </div>
        ) : null}

        {activeTab === "posts" ? (
          <div className="flex flex-col gap-4">
            {saved ? (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                更新しました。
              </p>
            ) : null}
            {error ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}
            <div className="flex justify-end">
              <Link
                href={`/clients/${id}/post-records/new`}
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]"
              >
                ＋ 投稿実績登録
              </Link>
            </div>
            <ul className="flex flex-col gap-2 text-sm">
              {postRecords.map((p) => (
                <li
                  key={p.id}
                  className={`rounded-md border px-3 py-2 ${
                    p.cancelled_at ? "border-red-200 bg-red-50/40" : "border-neutral-200"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {POST_TYPE_LABELS[p.post_type]} ・{" "}
                      {new Date(p.posted_at).toLocaleDateString("ja-JP")}
                      {p.cancelled_at ? (
                        <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                          取消済み
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-neutral-500">
                      投稿担当: {staffNameById.get(p.posted_by_staff_id) ?? "不明"}
                    </span>
                  </div>
                  {p.title ? <p className="mt-1 text-xs text-neutral-600">{p.title}</p> : null}
                  <div className="mt-1 flex flex-wrap gap-3 text-xs">
                    {p.social_post_url ? (
                      <a href={p.social_post_url} target="_blank" rel="noreferrer" className="underline">
                        SNS投稿
                      </a>
                    ) : null}
                    {p.canva_url ? (
                      <a href={p.canva_url} target="_blank" rel="noreferrer" className="underline">
                        Canva
                      </a>
                    ) : null}
                    {p.final_drive_url ? (
                      <a href={p.final_drive_url} target="_blank" rel="noreferrer" className="underline">
                        制作物（Drive）
                      </a>
                    ) : null}
                    {p.source_material_id ? (
                      <span className="text-neutral-400">
                        元素材: {materialTitleById.get(p.source_material_id) ?? "不明"}
                      </span>
                    ) : null}
                  </div>
                  {p.cancelled_at ? (
                    <p className="mt-1 text-xs text-red-700">
                      {new Date(p.cancelled_at).toLocaleString("ja-JP")} に
                      {staffNameById.get(p.cancelled_by_staff_id ?? "") ?? "不明"}が取消: {p.cancel_reason}
                    </p>
                  ) : (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-red-600 underline">
                        誤登録として取消
                      </summary>
                      <form action={cancelPostRecordAction} className="mt-2 flex flex-col gap-2">
                        <input type="hidden" name="recordId" value={p.id} />
                        <input type="hidden" name="returnTo" value={`/clients/${id}?tab=posts`} />
                        <textarea
                          name="reason"
                          rows={2}
                          required
                          placeholder="取消理由"
                          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                        />
                        <button
                          type="submit"
                          className="w-full rounded-md bg-red-600 px-3 py-2 text-xs font-medium text-white sm:w-auto"
                        >
                          取消を確定する
                        </button>
                      </form>
                    </details>
                  )}
                </li>
              ))}
              {postRecords.length === 0 ? (
                <li className="text-neutral-400">投稿実績はまだありません。</li>
              ) : null}
            </ul>
          </div>
        ) : null}

        {activeTab === "confirmations" ? (
          <ul className="flex flex-col gap-2 text-sm">
            {confirmations.map((c) => (
              <li key={c.id} className="rounded-md border border-neutral-200 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>確認依頼日: {new Date(c.requested_at).toLocaleString("ja-JP")}</span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                    {CLIENT_CONFIRMATION_STATUS_LABELS[c.status]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  依頼者: {staffNameById.get(c.requested_by_staff_id) ?? "不明"}
                </p>
                {c.responded_at ? (
                  <p className="text-xs text-neutral-500">
                    返答日: {new Date(c.responded_at).toLocaleString("ja-JP")}
                  </p>
                ) : null}
                {c.revision_comment ? (
                  <p className="text-xs text-neutral-500">修正内容: {c.revision_comment}</p>
                ) : null}
              </li>
            ))}
            {confirmations.length === 0 ? (
              <li className="text-neutral-400">顧客確認の履歴はありません。</li>
            ) : null}
          </ul>
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
          <div className="flex flex-col gap-6">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-neutral-700">ログイン者</h3>
              <p className="mb-2 text-xs text-neutral-500">
                この顧客のSNS等アカウントへログインできるスタッフです（主担当・副担当とは別の情報です）。
              </p>
              {loginStaff.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {loginStaff.map((s) => (
                    <li
                      key={s.staffId}
                      className={`rounded-full px-2.5 py-1 text-xs ${
                        s.isActive ? "bg-neutral-100 text-neutral-700" : "bg-neutral-100 text-neutral-400"
                      }`}
                    >
                      {s.name}
                      {!s.isActive ? "（無効）" : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-neutral-400">ログイン者は未設定です。</p>
              )}
            </div>

            <ul className="flex flex-col gap-2 border-t border-neutral-100 pt-4 text-sm">
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
          </div>
        ) : null}

        {activeTab === "history" ? (
          <ul className="flex flex-col gap-2 text-sm">
            {detail.activityLogs.map((log) => (
              <li key={log.id} className="border-b border-neutral-100 pb-2">
                <span className="font-medium tabular-nums text-neutral-500">
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
    </PageContainer>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="text-neutral-900">{value}</dd>
    </div>
  );
}

function MaterialFields() {
  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm font-medium text-neutral-700">
        内容（タイトル）
        <input
          name="title"
          type="text"
          required
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-medium text-neutral-700">
          投稿用途
          <input
            name="postUsage"
            type="text"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
          />
        </label>
        <label className="text-sm font-medium text-neutral-700">
          撮影日
          <input
            name="shotDate"
            type="date"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
          />
        </label>
      </div>
      <label className="text-sm font-medium text-neutral-700">
        投稿希望時期
        <input
          name="requestedPostTiming"
          type="text"
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
        />
      </label>
      <label className="text-sm font-medium text-neutral-700">
        編集指示
        <textarea
          name="editingInstructions"
          rows={2}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
        />
      </label>
      <label className="text-sm font-medium text-neutral-700">
        キャプション指定
        <textarea
          name="captionInstructions"
          rows={2}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
        />
      </label>
      <label className="text-sm font-medium text-neutral-700">
        連絡事項
        <textarea
          name="contactNotes"
          rows={2}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base"
        />
      </label>
      <label className="text-sm font-medium text-neutral-700">
        ファイル（任意）
        <input name="file" type="file" accept="image/*,video/*" className="mt-1 w-full text-sm" />
      </label>
    </div>
  );
}
