import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { canAccessManagementFeatures } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStaffProgressOverview } from "@/lib/management/staffProgress";

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
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-6 sm:py-8">
      <div>
        <Link href="/management" className="text-sm text-neutral-500">
          ← 管理ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">担当者別進捗</h1>
        <p className="mt-1 text-xs text-neutral-500">
          評価目的ではなく、仕事の偏りや詰まりを把握するための一覧です。
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-neutral-500">
              <th className="px-3 py-2">スタッフ</th>
              <th className="px-3 py-2">主担当</th>
              <th className="px-3 py-2">副担当</th>
              <th className="px-3 py-2">制作待ち</th>
              <th className="px-3 py-2">制作中</th>
              <th className="px-3 py-2">Wチェック待ち</th>
              <th className="px-3 py-2">顧客確認待ち</th>
              <th className="px-3 py-2">投稿待ち</th>
              <th className="px-3 py-2">期限超過</th>
              <th className="px-3 py-2">今週の完了数</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.staffId} className="border-b border-neutral-100">
                <td className="px-3 py-2 font-medium">{row.staffName}</td>
                <td className="px-3 py-2">{row.primaryClientCount}</td>
                <td className="px-3 py-2">{row.secondaryClientCount}</td>
                <td className="px-3 py-2">{row.productionWaitingCount}</td>
                <td className="px-3 py-2">{row.inProductionCount}</td>
                <td className="px-3 py-2">{row.wcheckWaitingCount}</td>
                <td className="px-3 py-2">{row.clientConfirmationWaitingCount}</td>
                <td className="px-3 py-2">{row.postingWaitingCount}</td>
                <td className="px-3 py-2">
                  {row.overdueCount > 0 ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                      {row.overdueCount}
                    </span>
                  ) : (
                    0
                  )}
                </td>
                <td className="px-3 py-2">{row.completedThisWeekCount}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-neutral-400">
                  スタッフが登録されていません。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
