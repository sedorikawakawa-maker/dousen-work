import { requireBillingAccess } from "@/lib/billing/authGuard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  BILLING_ITEM_CATEGORY_LABELS,
  buildBillingExportRows,
  filterInvoicesByClientName,
  filterInvoicesByStatus,
  listInvoicesForMonth,
  sumActiveInvoiceAmount,
  type BillingStatusFilterKey,
} from "@/lib/billing/queries";
import { currentMonthIsoJst, formatMonthLabel, monthInputToIso } from "@/lib/billing/generate";
import { PrintButton } from "@/components/PrintButton";

const STATUS_FILTER_KEYS: BillingStatusFilterKey[] = ["all", "unsent", "planned", "prepared", "sent"];

function yen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

/**
 * /management/billing のPDF出力（=ブラウザの印刷機能でPDF保存する社内管理資料）。
 * 巨大な日本語フォントファイルをGitへ追加する等の実装は避け、ブラウザ自身のフォント
 * レンダリングに委ねる（Netlify Functions側でのフォント埋め込み・ヘッドレスブラウザ実行が
 * 一切不要になり、追加依存も増えない）。
 * データ取得・絞り込み・金額計算は/management/billing本体・CSV出力とまったく同じ
 * queries.tsの関数を使い、画面表示と数字が食い違わないようにする。
 */
export default async function BillingPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; status?: string; q?: string }>;
}) {
  await requireBillingAccess();

  const { month, status, q } = await searchParams;
  const billingMonthIso = monthInputToIso(month) ?? currentMonthIsoJst();
  const statusFilter: BillingStatusFilterKey = STATUS_FILTER_KEYS.includes(status as BillingStatusFilterKey)
    ? (status as BillingStatusFilterKey)
    : "all";
  const nameQuery = (q ?? "").trim();

  const supabase = await createSupabaseServerClient();
  const invoices = filterInvoicesByClientName(
    filterInvoicesByStatus(await listInvoicesForMonth(supabase, billingMonthIso), statusFilter),
    nameQuery,
  );
  const rows = buildBillingExportRows(invoices);
  const total = sumActiveInvoiceAmount(invoices);
  const generatedAt = new Date().toLocaleString("ja-JP");

  return (
    <div className="p-6">
      <style>{`
        @page { size: A4 landscape; margin: 12mm; }
        @media print {
          thead { display: table-header-group; }
          tr { page-break-inside: avoid; }
        }
      `}</style>

      <div className="print:hidden mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-4">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">請求一覧（印刷用）</h1>
          <p className="mt-1 text-xs text-neutral-500">
            下の「PDF出力（印刷）」を押すと印刷ダイアログが開きます。PDFとして保存する場合は、印刷ダイアログの送信先（プリンター）を「PDFに保存」に切り替えてください。
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="mb-3">
        <h2 className="text-base font-semibold text-neutral-900">請求一覧</h2>
        <p className="text-sm text-neutral-600">対象請求月: {formatMonthLabel(billingMonthIso)}</p>
        <p className="text-xs text-neutral-500">出力日時: {generatedAt}</p>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-400 text-left">
            <th className="py-1 pr-3">顧客名</th>
            <th className="py-1 pr-3">件名 / 摘要</th>
            <th className="py-1 pr-3">種別</th>
            <th className="py-1 pr-3">売上月</th>
            <th className="py-1 pr-3 text-right">税抜金額</th>
            <th className="py-1 pr-3">状態</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-neutral-200">
              <td className="py-1 pr-3">{row.clientCompanyName}</td>
              <td className="py-1 pr-3">
                <div className="text-xs text-neutral-500">{row.invoiceTitle ?? "（件名未設定）"}</div>
                <div>{row.subject}</div>
              </td>
              <td className="py-1 pr-3">{BILLING_ITEM_CATEGORY_LABELS[row.category]}</td>
              <td className="py-1 pr-3">{formatMonthLabel(row.revenueMonth)}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{yen(row.amount)}</td>
              <td className="py-1 pr-3">{row.statusLabel}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-4 text-center text-neutral-400">
                対象データがありません。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <p className="mt-3 text-right text-sm font-semibold text-neutral-900">一覧合計金額: {yen(total)}</p>
    </div>
  );
}
