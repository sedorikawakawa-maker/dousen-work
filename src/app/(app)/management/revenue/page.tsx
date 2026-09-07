import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { canAccessManagementFeatures } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRevenueDashboardData } from "@/lib/billing/queries";
import { addMonthsIso, currentMonthIsoJst, formatMonthLabel, monthInputToIso } from "@/lib/billing/generate";
import { PageContainer } from "@/components/PageContainer";
import { BillingRollingWindowEnsurer } from "@/components/BillingRollingWindowEnsurer";

function yen(amount: number): string {
  return `${Math.round(amount).toLocaleString("ja-JP")}円`;
}

export default async function RevenueManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }
  if (!canAccessManagementFeatures(staff.role)) {
    redirect("/");
  }

  const { month } = await searchParams;
  const targetMonthIso = monthInputToIso(month) ?? currentMonthIsoJst();
  const monthQuery = targetMonthIso.slice(0, 7);
  const prevMonthQuery = addMonthsIso(targetMonthIso, -1).slice(0, 7);
  const nextMonthQuery = addMonthsIso(targetMonthIso, 1).slice(0, 7);

  const supabase = await createSupabaseServerClient();
  const data = await getRevenueDashboardData(supabase, targetMonthIso);
  const { totals, monthlyTrend, clientBreakdown } = data;

  const kpiCards: { label: string; value: number; tone: "main" | "sub" | "warning" | "success" }[] = [
    { label: "今月売上（税抜）", value: totals.thisMonthRevenue, tone: "main" },
    { label: "定期売上", value: totals.recurringRevenue, tone: "sub" },
    { label: "スポット売上", value: totals.oneTimeRevenue, tone: "sub" },
    { label: "その他売上", value: totals.otherRevenue, tone: "sub" },
    { label: "今月請求予定額", value: totals.billingPlanned, tone: "sub" },
    { label: "未送付額", value: totals.unsent, tone: "warning" },
    { label: "送付済額", value: totals.sent, tone: "success" },
    { label: "来月予定売上", value: totals.nextMonthRevenue, tone: "sub" },
  ];
  const toneClass = {
    main: "text-neutral-900",
    sub: "text-neutral-700",
    warning: "text-amber-600",
    success: "text-green-700",
  } as const;

  return (
    <PageContainer variant="wide" className="gap-6 bg-neutral-50 py-6 sm:py-8">
      <BillingRollingWindowEnsurer />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/management" className="text-sm text-neutral-500">
            ← 管理ダッシュボードに戻る
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-neutral-900">売上管理</h1>
          <p className="mt-1 text-xs text-neutral-500">
            発生した売上・請求の状況を月単位で確認できます（すべて税抜表示）。
          </p>
        </div>
        <Link
          href={`/management/billing?month=${monthQuery}`}
          className="whitespace-nowrap rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-700"
        >
          請求管理を見る →
        </Link>
      </div>

      <div className="flex items-center justify-center gap-4">
        <Link
          href={`/management/revenue?month=${prevMonthQuery}`}
          className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700"
        >
          ← 前月
        </Link>
        <h2 className="text-lg font-semibold text-neutral-900">{formatMonthLabel(targetMonthIso)}</h2>
        <Link
          href={`/management/revenue?month=${nextMonthQuery}`}
          className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700"
        >
          翌月 →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {kpiCards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-neutral-200 bg-white px-3 py-3 text-center">
            <p className={`text-xl font-bold tabular-nums ${toneClass[card.tone]}`}>{yen(card.value)}</p>
            <p className="mt-0.5 text-[11px] text-neutral-500">{card.label}</p>
          </div>
        ))}
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">月別推移（{formatMonthLabel(monthlyTrend[0].monthIso)}〜{formatMonthLabel(targetMonthIso)}）</h2>
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
                <th className="px-4 py-2 font-medium">月</th>
                <th className="px-4 py-2 font-medium text-right">売上合計</th>
                <th className="px-4 py-2 font-medium text-right">定期</th>
                <th className="px-4 py-2 font-medium text-right">スポット</th>
                <th className="px-4 py-2 font-medium text-right">その他</th>
              </tr>
            </thead>
            <tbody>
              {monthlyTrend.map((row) => (
                <tr
                  key={row.monthIso}
                  className={`border-b border-neutral-50 last:border-b-0 ${
                    row.monthIso === targetMonthIso ? "bg-[var(--accent-soft-bg)]" : ""
                  }`}
                >
                  <td className="px-4 py-2 font-medium text-neutral-900">{formatMonthLabel(row.monthIso)}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-neutral-900">{yen(row.total)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-neutral-600">{yen(row.recurring)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-neutral-600">{yen(row.oneTime)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-neutral-600">{yen(row.other)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">顧客別売上（{formatMonthLabel(targetMonthIso)}）</h2>
        {clientBreakdown.length === 0 ? (
          <p className="rounded-2xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-400">
            この月の売上データはありません。
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
                  <th className="px-4 py-2 font-medium">顧客名</th>
                  <th className="px-4 py-2 font-medium text-right">定期</th>
                  <th className="px-4 py-2 font-medium text-right">スポット</th>
                  <th className="px-4 py-2 font-medium text-right">その他</th>
                  <th className="px-4 py-2 font-medium text-right">合計</th>
                </tr>
              </thead>
              <tbody>
                {clientBreakdown.map((row) => (
                  <tr key={row.clientId} className="border-b border-neutral-50 last:border-b-0">
                    <td className="px-4 py-2">
                      <Link href={`/clients/${row.clientId}?tab=billing`} className="text-[var(--accent-strong)] underline">
                        {row.companyName}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-600">{yen(row.recurring)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-600">{yen(row.oneTime)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-neutral-600">{yen(row.other)}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-neutral-900">{yen(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageContainer>
  );
}
