import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { canAccessManagementFeatures } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getManagementOverview, selectManagementInterventions } from "@/lib/interventions/queries";
import { POST_TYPE_LABELS } from "@/lib/clients/labels";
import { PageContainer } from "@/components/PageContainer";

export default async function ManagementDashboardPage() {
  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }
  if (!canAccessManagementFeatures(staff.role)) {
    redirect("/");
  }

  const supabase = await createSupabaseServerClient();
  const overview = await getManagementOverview(supabase);
  const interventions = selectManagementInterventions(overview);

  const kpiCards: { label: string; value: number; tone: "urgent" | "warning" | "neutral" }[] = [
    { label: "素材待ち14日以上", value: overview.kpis.materialWaiting14, tone: "urgent" },
    { label: "顧客確認待ち14日以上", value: overview.kpis.clientConfirmationWaiting14, tone: "urgent" },
    { label: "Wチェック待ち", value: overview.kpis.wcheckWaiting, tone: "warning" },
    { label: "今日/期限超過タスク", value: overview.kpis.dueOrOverdueTasks, tone: "warning" },
    { label: "未割当タスク", value: overview.kpis.unassignedTasks, tone: "urgent" },
    { label: "前月未達・持越し", value: overview.kpis.pastMonthShortfallGroups, tone: "warning" },
    { label: "外注進行中", value: overview.kpis.outsourcingInProgress, tone: "neutral" },
    { label: "外注納期超過", value: overview.kpis.outsourcingOverdue, tone: "urgent" },
    { label: "外注納品済み未確認", value: overview.kpis.outsourcingDeliveredUnconfirmed, tone: "warning" },
    { label: "社内タスク期限超過", value: overview.kpis.overdueInternalTasks, tone: "urgent" },
  ];

  const toneClass = {
    urgent: "text-red-600",
    warning: "text-amber-600",
    neutral: "text-neutral-600",
  } as const;

  return (
    <PageContainer className="gap-6 bg-neutral-50 py-6 sm:py-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-neutral-500">
            ← ダッシュボードに戻る
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-neutral-900">管理ダッシュボード</h1>
        </div>
        <Link
          href="/management/staff-progress"
          className="whitespace-nowrap rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-700"
        >
          担当者別進捗を見る →
        </Link>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">今どこに介入すべきか（KPI）</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {kpiCards.map((card) => (
            <div key={card.label} className="rounded-2xl border border-neutral-200 bg-white px-2 py-2.5 text-center">
              <p className={`text-xl font-bold tabular-nums ${toneClass[card.tone]}`}>{card.value}</p>
              <p className="mt-0.5 text-[11px] text-neutral-500">{card.label}</p>
            </div>
          ))}
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">要介入一覧</h2>
        <div className="rounded-2xl border border-neutral-200 bg-white">
          {interventions.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-400">現在、介入が必要な案件はありません。</p>
          ) : (
            <div className="flex flex-col divide-y divide-neutral-100">
              {interventions.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className="flex flex-col gap-1.5 p-4 hover:bg-neutral-50 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-neutral-900">{item.clientName}</span>
                      <span className="rounded-full border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700">
                        {item.issueType}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">
                      主担当: {item.primaryStaffName ?? "未設定"}
                      {item.elapsedDays !== null ? (
                        <>
                          {" ／ 経過"}
                          <span className="font-medium tabular-nums">{item.elapsedDays}</span>日
                        </>
                      ) : (
                        ""
                      )}{" "}
                      ／ 次のアクション: {item.nextAction}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 sm:self-center">
                    開く ›
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">前月未達・持越し</h2>
        <div className="rounded-2xl border border-neutral-200 bg-white">
          {overview.pastMonthShortfalls.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-400">前月以前の未達・持越しはありません。</p>
          ) : (
            <div className="flex flex-col divide-y divide-neutral-100">
              {overview.pastMonthShortfalls.map((row) => {
                const [year, month] = row.sourceMonth.split("-");
                return (
                  <Link
                    key={`${row.clientId}-${row.postType}-${row.sourceMonth}`}
                    href={`/clients/${row.clientId}?tab=schedule`}
                    className="flex flex-col gap-1.5 p-4 hover:bg-neutral-50 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-neutral-900">{row.clientName}</span>
                        <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600">
                          {year}年{Number(month)}月 ・ {POST_TYPE_LABELS[row.postType]}
                        </span>
                        {row.needsReschedule ? (
                          <span className="rounded-full border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700">
                            再日程設定が必要
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-neutral-500">
                        実績/目標: <span className="font-medium tabular-nums">{row.actual}/{row.total}</span> ／ 未達
                        <span className="font-semibold tabular-nums text-red-600"> {row.shortfall}</span>
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </PageContainer>
  );
}
