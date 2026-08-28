import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { canAccessManagementFeatures, STAFF_ROLE_LABELS } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listClients } from "@/lib/clients/queries";
import { getDashboardData } from "@/lib/dashboard/queries";
import { buildTodayActionItems } from "@/lib/dashboard/todayActions";
import {
  ASSIGNMENT_TYPE_LABELS,
  CLIENT_CURRENT_STATUS_LABELS,
  NEXT_ACTION_BY_STATUS,
  POST_TYPE_LABELS,
} from "@/lib/clients/labels";
import { listMyIncompleteInternalTasks } from "@/lib/internalTasks/queries";
import { listPendingWCheckRevisionsForAssignee } from "@/lib/wchecks/queries";
import {
  getManagementOverview,
  selectPersonalInterventions,
  selectPersonalPastMonthShortfalls,
  type InterventionItem,
} from "@/lib/interventions/queries";
import { selectRemainingInternalTasks } from "@/lib/dashboard/todayActions";
import {
  addMonths,
  buildCalendarEventsByDate,
  currentCalendarMonthJST,
  filterInternalTasksForMonth,
  listScheduledPostsForMonth,
  todayIsoJST,
  type CalendarInternalTaskEvent,
  type CalendarMonth,
  type CalendarPostEvent,
} from "@/lib/calendar/queries";
import type { Database } from "@/lib/supabase/database.types";
import { StatusBadge } from "@/components/StatusBadge";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import { PageContainer } from "@/components/PageContainer";
import { ClientAvatar } from "@/components/ClientAvatar";
import { InternalTaskCard } from "@/components/InternalTaskCard";
import { DashboardCalendar } from "@/components/DashboardCalendar";
import { logoutAction } from "./logout-action";
import { StatusSelect } from "./StatusSelect";

type ProductionTaskRow = Database["public"]["Tables"]["production_tasks"]["Row"];
const VISIBLE_INTERNAL_TASK_COUNT = 8;

const INTERVENTION_STATUS_VALUE: Partial<Record<string, "material_waiting" | "client_confirmation_waiting">> = {
  "素材待ち14日超": "material_waiting",
  "素材待ち7日超": "material_waiting",
  "顧客確認待ち14日超": "client_confirmation_waiting",
  "顧客確認待ち7日超": "client_confirmation_waiting",
};

const INTERVENTION_STATUS_LABEL: Record<string, string> = {
  material_waiting: "素材待ち",
  client_confirmation_waiting: "顧客確認待ち",
};

function parseDisplayMonth(calYear: string | undefined, calMonth: string | undefined): CalendarMonth {
  const year = Number(calYear);
  const month0 = calMonth ? Number(calMonth) - 1 : NaN;
  const isValid =
    Number.isInteger(year) && year >= 2000 && year <= 2100 && Number.isInteger(month0) && month0 >= 0 && month0 <= 11;
  return isValid ? { year, month0 } : currentCalendarMonthJST();
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ calYear?: string; calMonth?: string }>;
}) {
  const staff = await getCurrentStaff();

  if (!staff) {
    redirect("/login");
  }

  const { calYear, calMonth } = await searchParams;
  const displayMonth = parseDisplayMonth(calYear, calMonth);

  const supabase = await createSupabaseServerClient();
  const [dashboard, allClients, myIncompleteInternalTasks, overview, pendingWCheckRevisions] = await Promise.all([
    getDashboardData(supabase, staff.id),
    listClients(supabase),
    listMyIncompleteInternalTasks(supabase, staff.id),
    getManagementOverview(supabase),
    listPendingWCheckRevisionsForAssignee(supabase, staff.id),
  ]);

  const clientNameById = new Map(
    allClients.map((c) => [c.id, c.shop_name ? `${c.company_name}（${c.shop_name}）` : c.company_name]),
  );
  const clientThumbnailById = new Map(allClients.map((c) => [c.id, c.thumbnail_url]));

  // カレンダー: 担当顧客（主担当・副担当、既存dashboard.myClientsをそのまま再利用）の投稿予定を表示月分だけ取得。
  const myClientIds = dashboard.myClients.map((c) => c.id);
  const scheduledPosts = await listScheduledPostsForMonth(supabase, myClientIds, displayMonth);
  const calendarPostEvents: CalendarPostEvent[] = scheduledPosts
    .filter((t): t is typeof t & { scheduled_post_date: string } => t.scheduled_post_date !== null)
    .map((t) => ({
      id: t.id,
      clientId: t.client_id,
      clientName: clientNameById.get(t.client_id) ?? "不明な顧客",
      clientThumbnailUrl: clientThumbnailById.get(t.client_id) ?? null,
      postType: t.post_type,
      status: t.status,
      scheduledPostDate: t.scheduled_post_date,
    }));

  // カレンダー: 自分担当の未完了社内タスクのうち、表示月が締切のもの（既存クエリの結果を再利用、重複クエリなし）。
  const internalTasksForMonth = filterInternalTasksForMonth(myIncompleteInternalTasks, displayMonth);
  const calendarInternalTaskEvents: CalendarInternalTaskEvent[] = internalTasksForMonth.map((task) => ({
    task,
    clientName: task.client_id ? (clientNameById.get(task.client_id) ?? "不明な顧客") : null,
    clientThumbnailUrl: task.client_id ? (clientThumbnailById.get(task.client_id) ?? null) : null,
  }));

  const calendarEventsByDate = buildCalendarEventsByDate({
    posts: calendarPostEvents,
    internalTasks: calendarInternalTaskEvents,
  });

  const prevMonth = addMonths(displayMonth, -1);
  const nextMonth = addMonths(displayMonth, 1);
  const thisMonth = currentCalendarMonthJST();
  const monthHref = (m: CalendarMonth) => `/?calYear=${m.year}&calMonth=${m.month0 + 1}`;

  const todayActionItems = buildTodayActionItems({
    dashboard,
    staffId: staff.id,
    clientNameById,
    clientThumbnailById,
    myIncompleteInternalTasks,
    pendingWCheckRevisions,
  });
  const mostUrgentCount = todayActionItems.filter(
    (item) => item.urgency === "overdue" || item.urgency === "urgent",
  ).length;

  // 「今日やること」に採用されなかった残りの未完了社内タスク（重複表示は避ける）。
  const remainingInternalTasks = selectRemainingInternalTasks(myIncompleteInternalTasks);
  const visibleInternalTasks = remainingInternalTasks.slice(0, VISIBLE_INTERNAL_TASK_COUNT);

  // 「要対応」= 今日やることよりも複数日放置・滞留しているもの。management側と同じ判定ロジックを再利用し、
  // 自分に関係する分（主担当・副担当・外注作成者等、既存の担当情報）だけに絞り込む。
  const personalInterventions = selectPersonalInterventions(overview, staff.id);
  const personalShortfalls = selectPersonalPastMonthShortfalls(overview, staff.id);
  // Wチェック修正依頼は「今日やること」に既にカードとして表示されるため、ここでは
  // 要対応の集計件数にだけ反映し、カードとしては二重表示しない。
  const needsAttentionCount =
    personalInterventions.length + personalShortfalls.length + pendingWCheckRevisions.length;

  const todayLabel = new Date().toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  // 未割当タスクの全社警告は社長・役員・社員のみに表示する（パートには表示しない）
  const canSeeUnassignedWarning = canAccessManagementFeatures(staff.role);

  return (
    <PageContainer variant="wide" className="gap-6 bg-neutral-50 py-6 sm:py-8">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-neutral-500">{todayLabel}</p>
          <h1 className="text-xl font-semibold text-neutral-900">
            {staff.last_name} {staff.first_name} さん（{STAFF_ROLE_LABELS[staff.role]}）
          </h1>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-full border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700"
          >
            ログアウト
          </button>
        </form>
      </header>

      {/* 1. 今日やること */}
      <section className="rounded-3xl border border-[var(--accent-soft-bg)] bg-gradient-to-br from-[var(--accent-soft-bg)] to-white p-5">
        <h2 className="text-lg font-semibold text-neutral-900">今日やること</h2>
        <p className="mt-1 text-sm text-neutral-600">
          優先度の高い順に並んでいます。上のカードから対応してください。
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <SummaryChip label="今日やること" count={todayActionItems.length} tone="accent" />
          <SummaryChip label="最優先" count={mostUrgentCount} tone="urgent" />
          <SummaryChip label="要対応" count={needsAttentionCount} tone="warning" />
        </div>

        <div className="mt-4 flex flex-col gap-2.5">
          {todayActionItems.map((item) => (
            <div
              key={item.id}
              className={`flex flex-col gap-2 rounded-2xl border-l-4 p-3.5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${
                item.wcheckRevision ? "bg-amber-50" : "bg-white"
              } ${
                item.urgency === "overdue" || item.urgency === "urgent" || item.urgency === "due_today"
                  ? "border-l-red-400"
                  : item.urgency === "warning"
                    ? "border-l-amber-300"
                    : "border-l-neutral-200"
              }`}
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {item.wcheckRevision ? (
                    <ClientAvatar thumbnailUrl={item.clientThumbnailUrl ?? null} name={item.clientName} size="xs" />
                  ) : null}
                  <span className="font-semibold text-neutral-900">{item.clientName}</span>
                  {item.wcheckRevision ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                      Wチェック修正依頼
                    </span>
                  ) : (
                    <>
                      {item.urgency ? <UrgencyBadge level={item.urgency} /> : null}
                      <StatusBadge status={item.statusValue} label={item.statusLabel} />
                    </>
                  )}
                  {item.assignmentTag ? (
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        item.assignmentHighlight
                          ? "bg-[var(--accent-soft-bg)] text-[var(--accent-soft-text)]"
                          : "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {item.assignmentTag}
                    </span>
                  ) : null}
                </div>
                {item.wcheckRevision ? (
                  <div>
                    <p className="text-xs text-neutral-500">
                      {item.title} ・ {item.wcheckRevision.postTypeLabel}
                      {item.wcheckRevision.scheduledPostDate ? (
                        <>
                          {" ・ 投稿予定: "}
                          <span className="font-medium tabular-nums">{item.wcheckRevision.scheduledPostDate}</span>
                        </>
                      ) : null}
                    </p>
                    <p className="text-xs text-neutral-500">
                      <span className="font-medium tabular-nums">
                        {new Date(item.wcheckRevision.requestedAt).toLocaleString("ja-JP")}
                      </span>{" "}
                      にWチェックから修正が返ってきています
                    </p>
                    {item.wcheckRevision.revisionComment ? (
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-neutral-700">
                        修正内容: {item.wcheckRevision.revisionComment}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-neutral-700">{item.title}</p>
                    {item.meta ? <p className="text-xs text-neutral-500">{item.meta}</p> : null}
                  </>
                )}
              </div>
              <Link
                href={item.href}
                className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]"
              >
                {item.actionLabel}
              </Link>
            </div>
          ))}
          {todayActionItems.length === 0 ? (
            <p className="rounded-2xl bg-white p-4 text-center text-sm text-neutral-400">
              今日やることはありません。
            </p>
          ) : null}
        </div>
      </section>

      {/* 1.5 担当社内タスク（期限超過・今日締切・priority Aは上の「今日やること」側に既出のため、ここでは重複除外済み） */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-neutral-700">
            担当社内タスク（{remainingInternalTasks.length}件）
          </h2>
          <Link
            href="/internal-tasks?scope=mine"
            className="whitespace-nowrap text-xs font-medium text-neutral-500 underline"
          >
            社内タスク一覧を見る
          </Link>
        </div>

        <div className="mt-3 flex flex-col gap-2.5">
          {visibleInternalTasks.map((task) => (
            <InternalTaskCard
              key={task.id}
              task={task}
              clientName={task.client_id ? (clientNameById.get(task.client_id) ?? "不明な顧客") : null}
              clientThumbnailUrl={task.client_id ? (clientThumbnailById.get(task.client_id) ?? null) : null}
            />
          ))}
          {remainingInternalTasks.length === 0 ? (
            <p className="rounded-2xl bg-neutral-50 p-4 text-center text-sm text-neutral-400">
              現在、担当中の社内タスクはありません。
            </p>
          ) : null}
        </div>
      </section>

      {/* 2. 要対応 */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">要対応</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              複数日にわたり滞留している、自分に関係する案件です。
            </p>
          </div>
          <Link href="/reminders" className="whitespace-nowrap text-xs font-medium text-neutral-500 underline">
            催促一覧を見る
          </Link>
        </div>

        <div className="mt-3 flex flex-col gap-2.5">
          {personalInterventions.map((item) => (
            <InterventionCard key={item.key} item={item} />
          ))}

          {personalShortfalls.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-2xl border border-neutral-200 p-3.5">
              <p className="text-xs font-semibold text-neutral-500">前月未達・持越し</p>
              {personalShortfalls.map((row) => {
                const [year, month] = row.sourceMonth.split("-");
                return (
                  <Link
                    key={`${row.clientId}-${row.postType}-${row.sourceMonth}`}
                    href={`/clients/${row.clientId}?tab=schedule`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-2 py-1.5 hover:bg-neutral-50"
                  >
                    <span className="flex flex-wrap items-center gap-1.5 text-sm">
                      <span className="font-semibold text-neutral-900">{row.clientName}</span>
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                        {year}年{Number(month)}月 ・ {POST_TYPE_LABELS[row.postType]}
                      </span>
                      {row.needsReschedule ? (
                        <span className="rounded-full border border-red-300 px-2 py-0.5 text-xs font-semibold text-red-700">
                          再日程設定が必要
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-neutral-500">
                      実績/目標: <span className="font-medium tabular-nums">{row.actual}/{row.total}</span> ／ 未達
                      <span className="font-semibold tabular-nums text-red-600"> {row.shortfall}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : null}

          {needsAttentionCount === 0 ? (
            <p className="rounded-2xl bg-neutral-50 p-4 text-center text-sm text-neutral-400">
              現在、要対応の案件はありません。
            </p>
          ) : null}
        </div>
      </section>

      {/* 3. スケジュール（担当顧客の投稿予定・自分担当の社内タスク締切を月単位で確認） */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">スケジュール</h2>
        <DashboardCalendar
          key={`${displayMonth.year}-${displayMonth.month0}`}
          year={displayMonth.year}
          month0={displayMonth.month0}
          todayIso={todayIsoJST()}
          eventsByDate={calendarEventsByDate}
          prevMonthHref={monthHref(prevMonth)}
          nextMonthHref={monthHref(nextMonth)}
          todayMonthHref={monthHref(thisMonth)}
        />
      </section>

      {/* 4. 担当顧客 */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">
          担当顧客一覧（{dashboard.myClients.length}件）
        </h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dashboard.myClients.map((client) => (
            <div
              key={client.id}
              className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <ClientAvatar thumbnailUrl={client.thumbnail_url} name={client.company_name} size="sm" />
                  <div>
                    <p className="font-semibold text-neutral-900">{client.company_name}</p>
                    <p className="text-xs text-neutral-500">{ASSIGNMENT_TYPE_LABELS[client.assignmentType]}</p>
                  </div>
                </div>
                <StatusBadge
                  status={client.current_status}
                  label={CLIENT_CURRENT_STATUS_LABELS[client.current_status]}
                />
              </div>

              <div>
                <p className="text-xs text-neutral-500">
                  今月: 通常<span className="font-medium tabular-nums text-neutral-700">{client.progress.target}</span>
                  {client.progress.carryover > 0 ? (
                    <>
                      {" + 持越し"}
                      <span className="font-medium tabular-nums text-neutral-700">{client.progress.carryover}</span>
                    </>
                  ) : (
                    ""
                  )}
                  {" = 必要"}
                  <span className="font-medium tabular-nums text-neutral-700">{client.progress.required}</span>本 / 実績
                  <span className="font-medium tabular-nums text-neutral-700">{client.progress.actual}</span>本
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  次にやること: {NEXT_ACTION_BY_STATUS[client.current_status]}
                </p>
              </div>

              <div className="mt-auto flex items-center justify-between gap-2">
                <StatusSelect clientId={client.id} currentStatus={client.current_status} />
                <Link
                  href={`/clients/${client.id}`}
                  className="whitespace-nowrap rounded-full border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-700"
                >
                  詳細を見る
                </Link>
              </div>
            </div>
          ))}
          {dashboard.myClients.length === 0 ? (
            <p className="col-span-full py-4 text-center text-sm text-neutral-400">
              担当している顧客はまだありません。
            </p>
          ) : null}
        </div>
      </section>

      {/* 5. 補助情報 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AlertSection title="新着素材" count={dashboard.newMaterials.length} tone="neutral">
          <ul className="flex flex-col gap-2 text-sm">
            {dashboard.newMaterials.map((m) => (
              <li key={m.id}>
                <Link href={`/clients/${m.client_id}?tab=materials`} className="hover:underline">
                  {clientNameById.get(m.client_id) ?? "不明な顧客"} / {m.title}
                </Link>
                <span className="ml-2 text-xs font-medium tabular-nums text-neutral-500">
                  {new Date(m.received_at).toLocaleDateString("ja-JP")}
                </span>
              </li>
            ))}
            {dashboard.newMaterials.length === 0 ? (
              <li className="text-neutral-400">新着素材はありません。</li>
            ) : null}
          </ul>
        </AlertSection>

        {canSeeUnassignedWarning ? (
          <AlertSection title="未割当タスクの警告" count={dashboard.unassignedTasks.length} tone="warning">
            <TaskList
              tasks={dashboard.unassignedTasks}
              clientNameById={clientNameById}
              emptyText="未割当のタスクはありません。"
            />
          </AlertSection>
        ) : null}
      </div>
    </PageContainer>
  );
}

function InterventionCard({ item }: { item: InterventionItem }) {
  const statusValue = INTERVENTION_STATUS_VALUE[item.issueType];

  return (
    <Link
      href={item.href}
      className={`flex flex-col gap-2 rounded-2xl border-l-4 bg-white p-3.5 shadow-sm hover:bg-neutral-50 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${
        item.level === "urgent" ? "border-l-red-400" : "border-l-amber-300"
      }`}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <ClientAvatar thumbnailUrl={item.clientThumbnailUrl} name={item.clientName} size="xs" />
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-neutral-900">{item.clientName}</span>
            <UrgencyBadge level={item.level} />
            {statusValue ? (
              <StatusBadge status={statusValue} label={INTERVENTION_STATUS_LABEL[statusValue]} />
            ) : (
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600">
                {item.issueType}
              </span>
            )}
          </div>
          <p className="text-sm text-neutral-700">
            {item.nextAction}
            {item.elapsedDays !== null ? (
              <span className="font-medium tabular-nums">（{item.elapsedDays}日経過）</span>
            ) : (
              ""
            )}
          </p>
        </div>
      </div>
      <span className="inline-flex shrink-0 items-center justify-center self-start rounded-full border border-neutral-300 px-3.5 py-1.5 text-xs font-medium text-neutral-700 sm:self-center">
        対応する ›
      </span>
    </Link>
  );
}

function SummaryChip({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "accent" | "urgent" | "warning";
}) {
  const toneClass = {
    accent: "text-[var(--accent-strong)]",
    urgent: "text-red-600",
    warning: "text-amber-600",
  }[tone];

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white px-2 py-2.5 text-center">
      <p className={`text-xl font-bold tabular-nums ${toneClass}`}>{count}</p>
      <p className="mt-0.5 text-[11px] text-neutral-500">{label}</p>
    </div>
  );
}

function AlertSection({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone: "urgent" | "warning" | "wcheck" | "neutral";
  children: ReactNode;
}) {
  const toneClass = {
    urgent: "bg-red-50 text-red-700",
    warning: "bg-amber-50 text-amber-700",
    wcheck: "bg-purple-100 text-purple-700",
    neutral: "bg-neutral-100 text-neutral-600",
  }[tone];

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700">{title}</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneClass}`}>{count}</span>
      </div>
      {children}
    </section>
  );
}

function TaskList({
  tasks,
  clientNameById,
  emptyText,
}: {
  tasks: ProductionTaskRow[];
  clientNameById: Map<string, string>;
  emptyText: string;
}) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {tasks.map((task) => (
        <li key={task.id}>
          <Link href={`/tasks/${task.id}`} className="hover:underline">
            {clientNameById.get(task.client_id) ?? "不明な顧客"} / {task.title}
          </Link>
          {!task.assignee_staff_id ? (
            <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">未割当</span>
          ) : null}
        </li>
      ))}
      {tasks.length === 0 ? <li className="text-neutral-400">{emptyText}</li> : null}
    </ul>
  );
}
