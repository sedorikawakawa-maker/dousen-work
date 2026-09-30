import Link from "next/link";
import { requireAccountingAccess } from "@/lib/accounting/authGuard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listExpenses, type ExpenseListRow } from "@/lib/accounting/queries";
import { PageContainer } from "@/components/PageContainer";
import { cancelExpenseAction } from "./actions";

function currentMonthQuery(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function yen(amount: number | null): string {
  if (amount === null) return "—";
  return `${amount.toLocaleString("ja-JP")}円`;
}

export default async function AccountingExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; q?: string; saved?: string; error?: string; warning?: string }>;
}) {
  await requireAccountingAccess();
  const { month, q, saved, error, warning } = await searchParams;
  const monthQuery = month && /^\d{4}-\d{2}$/.test(month) ? month : currentMonthQuery();
  const nameQuery = (q ?? "").trim();

  const supabase = await createSupabaseServerClient();
  const expenses = await listExpenses(supabase, { month: monthQuery, q: nameQuery || undefined });

  const activeExpenses = expenses.filter((e: ExpenseListRow) => e.status === "confirmed");
  const totalAmount = activeExpenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <PageContainer variant="wide" className="gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/" className="text-sm text-neutral-500">
          ← ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">経費</h1>
        <p className="mt-1 text-xs text-neutral-500">
          書類BOXで確定した経費の一覧です。勘定科目・税区分は候補であり、最終判断は税理士確認前提です。
        </p>
      </div>

      {saved === "confirmed" ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">経費として確定しました。</p>
      ) : saved === "cancelled" ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">経費を取消しました。</p>
      ) : null}
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {warning ? <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{warning}</p> : null}

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input type="month" name="month" defaultValue={monthQuery} className="rounded-full border border-neutral-300 px-3 py-1.5 text-sm" />
        <input
          type="text"
          name="q"
          defaultValue={nameQuery}
          placeholder="取引先で検索"
          className="rounded-full border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <button type="submit" className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700">
          絞り込み
        </button>
      </form>

      <p className="text-sm font-semibold text-neutral-900">この月の経費合計（取消分を除く）: {yen(totalAmount)}</p>

      {expenses.length === 0 ? (
        <p className="rounded-2xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-400">
          該当する経費がありません。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
                <th className="px-3 py-2 font-medium">取引日</th>
                <th className="px-3 py-2 font-medium">取引先</th>
                <th className="px-3 py-2 font-medium">摘要</th>
                <th className="px-3 py-2 font-medium text-right">金額</th>
                <th className="px-3 py-2 font-medium text-right">税額</th>
                <th className="px-3 py-2 font-medium">勘定科目</th>
                <th className="px-3 py-2 font-medium">支払方法</th>
                <th className="px-3 py-2 font-medium">証憑</th>
                <th className="px-3 py-2 font-medium">確定日</th>
                <th className="px-3 py-2 font-medium">状態</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => {
                const isCancelled = expense.status === "cancelled";
                return (
                  <tr key={expense.id} className={`border-b border-neutral-50 last:border-b-0 ${isCancelled ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2 whitespace-nowrap">{expense.transaction_date}</td>
                    <td className="px-3 py-2">{expense.vendor_name}</td>
                    <td className="px-3 py-2 text-neutral-500">{expense.description ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{yen(expense.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{yen(expense.tax_amount)}</td>
                    <td className="px-3 py-2">{expense.account_category_confirmed}</td>
                    <td className="px-3 py-2">{expense.payment_method ?? "—"}</td>
                    <td className="px-3 py-2">
                      {expense.document ? (
                        <a
                          href={expense.document.drive_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[var(--accent-strong)] underline"
                        >
                          あり
                        </a>
                      ) : (
                        <span className="text-xs text-neutral-400">なし（手入力）</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-neutral-500">
                      {new Date(expense.confirmed_at).toLocaleDateString("ja-JP")} ・ {expense.confirmedByName}
                    </td>
                    <td className="px-3 py-2">
                      {isCancelled ? (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-400">取消済み</span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">確定済み</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {!isCancelled ? (
                        <details>
                          <summary className="cursor-pointer text-xs text-red-600 underline marker:content-none">取消</summary>
                          <form action={cancelExpenseAction} className="mt-2 flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-2">
                            <input type="hidden" name="expenseId" value={expense.id} />
                            <input type="hidden" name="month" value={monthQuery} />
                            <input
                              name="cancelReason"
                              type="text"
                              required
                              placeholder="取消理由"
                              className="w-full rounded-md border border-neutral-300 px-2 py-1 text-xs"
                            />
                            <button type="submit" className="self-start rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white">
                              取消する
                            </button>
                          </form>
                        </details>
                      ) : (
                        <span className="text-xs text-neutral-400">理由: {expense.cancel_reason}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  );
}
