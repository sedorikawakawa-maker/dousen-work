import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { canAccessManagementFeatures } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStaffProgressOverview } from "@/lib/management/staffProgress";
import { PageContainer } from "@/components/PageContainer";

export default async function StaffProgressPage() {
  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }
  if (!canAccessManagementFeatures(staff.role)) {
    redirect("/");
  }

  const supabase = await createSupabaseServerClient();
  const rows = await getStaffProgressOverview(supabase);

  return (
    <PageContainer variant="wide" className="gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/management" className="text-sm text-neutral-500">
          ← 管理ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">担当者別進捗</h1>
        <p className="mt-1 text-xs text-neutral-500">
          評価目的ではなく、仕事の偏りや詰まりを把握するための一覧です。
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-neutral-200 bg-white py-10 text-center text-sm text-neutral-400">
          スタッフが登録されていません。
        </p>
      ) : (
        <>
          {/* PC: 一覧性重視の比較テーブル */}
          <div className="hidden overflow-x-auto rounded-2xl border border-neutral-200 bg-white md:block">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-xs text-neutral-400">
                  <th className="px-4 py-3 font-medium">スタッフ</th>
                  <th className="px-4 py-3 font-medium">主担当</th>
                  <th className="px-4 py-3 font-medium">副担当</th>
                  <th className="px-4 py-3 font-medium">制作待ち</th>
                  <th className="px-4 py-3 font-medium">制作中</th>
                  <th className="px-4 py-3 font-medium">Wチェック待ち</th>
                  <th className="px-4 py-3 font-medium">顧客確認待ち</th>
                  <th className="px-4 py-3 font-medium">投稿待ち</th>
                  <th className="px-4 py-3 font-medium">期限超過</th>
                  <th className="px-4 py-3 font-medium">今週の完了数</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {rows.map((row) => (
                  <tr key={row.staffId} className="border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50">
                    <td className="px-4 py-3 font-semibold text-neutral-900">{row.staffName}</td>
                    <td className="px-4 py-3">{row.primaryClientCount}</td>
                    <td className="px-4 py-3">{row.secondaryClientCount}</td>
                    <td className="px-4 py-3">{row.productionWaitingCount}</td>
                    <td className="px-4 py-3">{row.inProductionCount}</td>
                    <td className="px-4 py-3">{row.wcheckWaitingCount}</td>
                    <td className="px-4 py-3">{row.clientConfirmationWaitingCount}</td>
                    <td className="px-4 py-3">{row.postingWaitingCount}</td>
                    <td className="px-4 py-3">
                      {row.overdueCount > 0 ? (
                        <span className="rounded-full border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700">
                          {row.overdueCount}
                        </span>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="px-4 py-3">{row.completedThisWeekCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* スマホ: カード表示 */}
          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => (
              <div key={row.staffId} className="rounded-2xl border border-neutral-200 bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-neutral-900">{row.staffName}</span>
                  {row.overdueCount > 0 ? (
                    <span className="rounded-full border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700">
                      期限超過 {row.overdueCount}
                    </span>
                  ) : null}
                </div>
                <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-neutral-600 tabular-nums">
                  <div>主担当: {row.primaryClientCount}</div>
                  <div>副担当: {row.secondaryClientCount}</div>
                  <div>制作待ち: {row.productionWaitingCount}</div>
                  <div>制作中: {row.inProductionCount}</div>
                  <div>Wチェック待ち: {row.wcheckWaitingCount}</div>
                  <div>顧客確認待ち: {row.clientConfirmationWaitingCount}</div>
                  <div>投稿待ち: {row.postingWaitingCount}</div>
                  <div>今週の完了数: {row.completedThisWeekCount}</div>
                </dl>
              </div>
            ))}
          </div>
        </>
      )}
    </PageContainer>
  );
}
