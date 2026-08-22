import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { canAccessManagementFeatures } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getManagementOverview } from "@/lib/management/queries";
import { POST_TYPE_LABELS } from "@/lib/clients/labels";

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

  const kpiCards: { label: string; value: number | string; tone: "urgent" | "warning" | "neutral" }[] = [
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
    urgent: "bg-red-100 text-red-700",
    warning: "bg-yellow-100 text-yellow-800",
    neutral: "bg-neutral-100 text-neutral-600",
  } as const;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-6 sm:py-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-neutral-500">
            ← ダッシュボードに戻る
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-neutral-900">管理ダッシュボード</h1>
        </div>
        <Link
          href="/management/staff-progress"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700"
        >
          担当者別進捗を見る →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpiCards.map((card) => (
          <div key={card.label} className="rounded-lg border border-neutral-200 bg-white p-4">
            <p className="text-xs text-neutral-500">{card.label}</p>
            <p
              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-lg font-semibold ${
                typeof card.value === "number" ? toneClass[card.tone] : "text-neutral-400"
              }`}
            >
              {card.value}
            </p>
          </div>
        ))}
      </div>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">要介入一覧</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500">
                <th className="px-2 py-1">顧客</th>
                <th className="px-2 py-1">主担当</th>
                <th className="px-2 py-1">問題の種類</th>
                <th className="px-2 py-1">経過日数</th>
                <th className="px-2 py-1">次に必要なアクション</th>
                <th className="px-2 py-1">導線</th>
              </tr>
            </thead>
            <tbody>
              {overview.interventions.map((item) => (
                <tr key={item.key} className="border-b border-neutral-100">
                  <td className="px-2 py-1">{item.clientName}</td>
                  <td className="px-2 py-1">{item.primaryStaffName ?? "未設定"}</td>
                  <td className="px-2 py-1">
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                      {item.issueType}
                    </span>
                  </td>
                  <td className="px-2 py-1">{item.elapsedDays !== null ? `${item.elapsedDays}日` : "—"}</td>
                  <td className="px-2 py-1">{item.nextAction}</td>
                  <td className="px-2 py-1">
                    <Link href={item.href} className="underline">
                      開く
                    </Link>
                  </td>
                </tr>
              ))}
              {overview.interventions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-neutral-400">
                    現在、介入が必要な案件はありません。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">前月未達・持越し</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500">
                <th className="px-2 py-1">顧客</th>
                <th className="px-2 py-1">月</th>
                <th className="px-2 py-1">投稿種別</th>
                <th className="px-2 py-1">実績/目標</th>
                <th className="px-2 py-1">未達</th>
                <th className="px-2 py-1">状態</th>
              </tr>
            </thead>
            <tbody>
              {overview.pastMonthShortfalls.map((row) => {
                const [year, month] = row.sourceMonth.split("-");
                return (
                  <tr
                    key={`${row.clientId}-${row.postType}-${row.sourceMonth}`}
                    className="border-b border-neutral-100"
                  >
                    <td className="px-2 py-1">
                      <Link href={`/clients/${row.clientId}?tab=schedule`} className="underline">
                        {row.clientName}
                      </Link>
                    </td>
                    <td className="px-2 py-1">
                      {year}年{Number(month)}月
                    </td>
                    <td className="px-2 py-1">{POST_TYPE_LABELS[row.postType]}</td>
                    <td className="px-2 py-1">
                      {row.actual}/{row.total}
                    </td>
                    <td className="px-2 py-1 font-medium text-red-700">{row.shortfall}</td>
                    <td className="px-2 py-1">
                      {row.needsReschedule ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                          再日程設定が必要
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-400">日程設定済み</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {overview.pastMonthShortfalls.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-neutral-400">
                    前月以前の未達・持越しはありません。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
