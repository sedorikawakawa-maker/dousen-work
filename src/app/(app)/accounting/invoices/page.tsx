import Link from "next/link";
import { requireAccountingAccess } from "@/lib/accounting/authGuard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  addMonthsIso,
  currentMonthIsoJst,
  formatMonthLabel,
  monthInputToIso,
} from "@/lib/billing/generate";
import {
  BILLING_ITEM_STATUS_LABELS,
  effectiveInvoiceItemAmount,
  filterInvoicesByClientName,
  type ManagementInvoiceRow,
} from "@/lib/billing/queries";
import { listInvoicesWithDocumentsForMonth, type InvoiceListRow } from "@/lib/billing/invoiceList";
import { getCompanyProfile, isCompanyProfileReadyForInvoiceIssue } from "@/lib/billing/companyProfile";
import { PageContainer } from "@/components/PageContainer";
import { SubmitButton } from "@/components/SubmitButton";
import {
  issueInvoiceDocumentAction,
  retryInvoiceDocumentGenerationAction,
  setInvoiceItemTaxRateAction,
  voidInvoiceDocumentFromInvoicesAction,
} from "./actions";
import { INVOICE_ITEM_TAX_RATE_OPTIONS } from "@/lib/billing/invoiceItemTaxRate";
import { SENDING_ENABLED } from "@/lib/billing/invoiceSendingFeatureFlag";

type InvoiceDocumentStatus = "issuing" | "generated" | "voided";

const DOCUMENT_STATUS_LABELS: Record<InvoiceDocumentStatus, string> = {
  issuing: "発行処理中",
  generated: "発行済み",
  voided: "取消済み",
};

const DOCUMENT_STATUS_FILTERS = [
  { key: "all", label: "すべて" },
  { key: "none", label: "未発行" },
  { key: "issuing", label: "発行処理中/失敗" },
  { key: "generated", label: "発行済み" },
  { key: "voided", label: "取消済みのみ" },
] as const;
type DocumentStatusFilterKey = (typeof DOCUMENT_STATUS_FILTERS)[number]["key"];

const STATUS_FILTERS = [
  { key: "all", label: "すべて" },
  { key: "planned", label: "請求予定" },
  { key: "prepared", label: "作成済" },
  { key: "sent", label: "送付済" },
] as const;
type StatusFilterKey = (typeof STATUS_FILTERS)[number]["key"];

function yen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

function revenueMonthLabel(row: InvoiceListRow): string {
  if (row.revenueMonths.kind === "single") return formatMonthLabel(row.revenueMonths.month);
  if (row.revenueMonths.kind === "multiple") return "複数月";
  return "—";
}

function documentStatusFilterMatches(row: InvoiceListRow, filter: DocumentStatusFilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "none") return row.activeDocument === null;
  if (filter === "voided") return row.activeDocument === null && row.documentHistory.length > 0;
  return row.activeDocument?.status === filter;
}

export default async function AccountingInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string;
    status?: string;
    docStatus?: string;
    q?: string;
    saved?: string;
    error?: string;
  }>;
}) {
  await requireAccountingAccess();
  const { month, status, docStatus, q, saved, error } = await searchParams;

  const billingMonthIso = monthInputToIso(month) ?? currentMonthIsoJst();
  const monthQuery = billingMonthIso.slice(0, 7);
  const prevMonthQuery = addMonthsIso(billingMonthIso, -1).slice(0, 7);
  const nextMonthQuery = addMonthsIso(billingMonthIso, 1).slice(0, 7);
  const statusFilter: StatusFilterKey = STATUS_FILTERS.some((f) => f.key === status) ? (status as StatusFilterKey) : "all";
  const documentStatusFilter: DocumentStatusFilterKey = DOCUMENT_STATUS_FILTERS.some((f) => f.key === docStatus)
    ? (docStatus as DocumentStatusFilterKey)
    : "all";
  const nameQuery = (q ?? "").trim();

  const supabase = await createSupabaseServerClient();
  const [rows, companyProfile] = await Promise.all([
    listInvoicesWithDocumentsForMonth(supabase, billingMonthIso),
    getCompanyProfile(supabase),
  ]);
  const companyProfileReady = isCompanyProfileReadyForInvoiceIssue(companyProfile);

  const byStatus = statusFilter === "all" ? rows : rows.filter((r) => r.invoice.status === statusFilter);
  const byDocStatus = byStatus.filter((r) => documentStatusFilterMatches(r, documentStatusFilter));
  const filteredRows: InvoiceListRow[] = nameQuery
    ? (filterInvoicesByClientName(byDocStatus.map((r) => r.invoice), nameQuery) as ManagementInvoiceRow[]).map(
        (invoice) => byDocStatus.find((r) => r.invoice.id === invoice.id)!,
      )
    : byDocStatus;

  function buildUrl(overrides: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    params.set("month", monthQuery);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (documentStatusFilter !== "all") params.set("docStatus", documentStatusFilter);
    if (nameQuery) params.set("q", nameQuery);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }
    return `/accounting/invoices?${params.toString()}`;
  }

  return (
    <PageContainer variant="wide" className="gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/" className="text-sm text-neutral-500">
          ← ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">請求書</h1>
        <p className="mt-1 text-xs text-neutral-500">
          正式な請求書PDFの発行・Drive保存・送付管理を行います（税抜表示）。
        </p>
      </div>

      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
        現在、正式な消費税額・税込請求額の計算ルールは未設定です。税理士確認後に正式送付運用を開始してください。
      </p>

      {!companyProfileReady ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          自社請求情報（会社名・住所・振込先等）が未設定のため、請求書を発行できません。
          <Link href="/accounting/settings" className="ml-1 underline">
            自社請求情報を設定する →
          </Link>
        </p>
      ) : null}

      {saved === "issued" ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">請求書PDFを発行しました。</p>
      ) : saved === "voided" ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">発行を取消しました。</p>
      ) : saved === "sent" ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">送付済みにしました。</p>
      ) : saved === "tax_rate_set" ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">税率を設定しました。</p>
      ) : null}
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="flex items-center justify-center gap-4">
        <Link href={buildUrl({ month: prevMonthQuery })} className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700">
          ← 前月
        </Link>
        <h2 className="text-lg font-semibold text-neutral-900">{formatMonthLabel(billingMonthIso)}</h2>
        <Link href={buildUrl({ month: nextMonthQuery })} className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700">
          翌月 →
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={buildUrl({ status: f.key === "all" ? undefined : f.key })}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                statusFilter === f.key ? "bg-[var(--accent)] text-white" : "border border-neutral-300 bg-white text-neutral-700"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DOCUMENT_STATUS_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={buildUrl({ docStatus: f.key === "all" ? undefined : f.key })}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                documentStatusFilter === f.key ? "bg-neutral-800 text-white" : "border border-neutral-300 bg-white text-neutral-700"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <form action="/accounting/invoices" method="get" className="flex items-center gap-1.5">
          <input type="hidden" name="month" value={monthQuery} />
          {statusFilter !== "all" ? <input type="hidden" name="status" value={statusFilter} /> : null}
          {documentStatusFilter !== "all" ? <input type="hidden" name="docStatus" value={documentStatusFilter} /> : null}
          <input type="text" name="q" defaultValue={nameQuery} placeholder="顧客名で検索" className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs" />
          <button type="submit" className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700">
            検索
          </button>
        </form>
      </div>

      {filteredRows.length === 0 ? (
        <p className="rounded-2xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-400">
          条件に一致する請求書がありません。
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {filteredRows.map((row) => (
            <InvoiceRow key={row.invoice.id} row={row} monthQuery={monthQuery} companyProfileReady={companyProfileReady} />
          ))}
        </ul>
      )}
    </PageContainer>
  );
}

function InvoiceRow({
  row,
  monthQuery,
  companyProfileReady,
}: {
  row: InvoiceListRow;
  monthQuery: string;
  companyProfileReady: boolean;
}) {
  const { invoice, totalAmount, missingTaxRate, activeDocument, documentHistory } = row;
  const activeItems = invoice.items.filter((i) => i.cancelled_at === null);
  const itemsNeedingTaxRate = activeItems.filter((i) => i.tax_rate === null);
  const canIssue = invoice.status === "planned" && activeDocument === null;
  const canRetry = activeDocument?.status === "issuing" && activeDocument.generation_error !== null;
  const canVoid = activeDocument?.status === "generated" || (activeDocument?.status === "issuing" && !canRetry);
  const canMarkSent = invoice.status === "prepared" && activeDocument?.status === "generated";

  return (
    <li className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-neutral-900">{invoice.clientCompanyName}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                invoice.status === "sent" ? "bg-green-100 text-green-700" : invoice.status === "prepared" ? "bg-amber-100 text-amber-700" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {BILLING_ITEM_STATUS_LABELS[invoice.status]}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                activeDocument?.status === "generated"
                  ? "bg-blue-100 text-blue-700"
                  : activeDocument?.status === "issuing"
                    ? activeDocument.generation_error
                      ? "bg-red-100 text-red-700"
                      : "bg-neutral-100 text-neutral-600"
                    : "bg-neutral-100 text-neutral-400"
              }`}
            >
              {activeDocument ? (activeDocument.status === "issuing" && activeDocument.generation_error ? "発行に失敗しました" : DOCUMENT_STATUS_LABELS[activeDocument.status]) : "未発行"}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-neutral-700">件名: {invoice.invoiceTitle ?? <span className="text-neutral-400">（件名未設定）</span>}</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            請求月: {formatMonthLabel(invoice.billing_month)} / 売上月: {revenueMonthLabel(row)}
          </p>
        </div>
        <span className="whitespace-nowrap text-sm font-semibold text-neutral-900">合計 {yen(totalAmount)}</span>
      </div>

      {missingTaxRate ? (
        <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="font-medium">⚠ 税率が未設定の明細があります。発行前に設定してください。</p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {itemsNeedingTaxRate.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2">
                <span>{item.subject}（{yen(effectiveInvoiceItemAmount(item))}）</span>
                <form action={setInvoiceItemTaxRateAction} className="flex items-center gap-1.5">
                  <input type="hidden" name="invoiceItemId" value={item.id} />
                  <input type="hidden" name="month" value={monthQuery} />
                  <select name="taxRate" defaultValue="" required className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs">
                    <option value="" disabled>
                      税率を選択
                    </option>
                    {INVOICE_ITEM_TAX_RATE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <SubmitButton pendingText="設定中..." className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white">
                    確定
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {activeDocument?.status === "generated" ? (
        <div className="mt-2 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
          <p>
            請求書番号: <span className="font-medium tabular-nums">{activeDocument.invoice_number}</span>
            {" / "}発行日: {activeDocument.issue_date} / 支払期限: {activeDocument.due_date}
          </p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
        {canIssue ? (
          <form action={issueInvoiceDocumentAction}>
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <input type="hidden" name="month" value={monthQuery} />
            <SubmitButton
              pendingText="発行中..."
              disabled={!companyProfileReady}
              className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
            >
              請求書を発行
            </SubmitButton>
          </form>
        ) : null}

        {canRetry ? (
          <form action={retryInvoiceDocumentGenerationAction}>
            <input type="hidden" name="invoiceDocumentId" value={activeDocument!.id} />
            <input type="hidden" name="month" value={monthQuery} />
            <SubmitButton pendingText="再試行中..." className="rounded-full bg-amber-600 px-3 py-1.5 text-xs font-medium text-white">
              再試行
            </SubmitButton>
          </form>
        ) : null}

        {activeDocument?.status === "generated" ? (
          <>
            <a href={activeDocument.drive_url ?? "#"} target="_blank" rel="noreferrer" className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700">
              PDFを見る
            </a>
            <a href={activeDocument.drive_url ?? "#"} target="_blank" rel="noreferrer" className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700">
              Driveを開く
            </a>
          </>
        ) : null}

        {canMarkSent && SENDING_ENABLED ? (
          <details>
            <summary className="cursor-pointer rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white marker:content-none">送付済みにする</summary>
            <div className="mt-2 max-w-xs rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <p>この請求書を送付済みにしますか？送付済みにすると今後一切変更できなくなります。</p>
            </div>
          </details>
        ) : canMarkSent && !SENDING_ENABLED ? (
          <span className="rounded-full border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-500">
            送付済みにする（税額・税込請求額の計算ルール確定後に利用できます）
          </span>
        ) : null}

        {canVoid ? (
          <details>
            <summary className="cursor-pointer rounded-full border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 marker:content-none">発行取消</summary>
            <form action={voidInvoiceDocumentFromInvoicesAction} className="mt-2 flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3">
              <input type="hidden" name="invoiceDocumentId" value={activeDocument!.id} />
              <input type="hidden" name="month" value={monthQuery} />
              <label className="text-xs font-medium text-neutral-700">
                取消理由（必須）
                <input name="voidReason" type="text" required className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm" />
              </label>
              <SubmitButton pendingText="取消中..." className="self-start rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white">
                取消する（確定）
              </SubmitButton>
            </form>
          </details>
        ) : null}

        {documentHistory.length > 0 || activeDocument ? (
          <details className="ml-auto">
            <summary className="cursor-pointer text-xs text-neutral-500 underline marker:content-none">発行履歴を見る</summary>
            <ul className="mt-2 flex flex-col gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
              {[...(activeDocument ? [activeDocument] : []), ...documentHistory].map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center gap-2 border-b border-neutral-200 pb-1.5 last:border-0 last:pb-0">
                  <span className="font-medium tabular-nums">{doc.invoice_number}</span>
                  <span>{doc.status === "voided" ? "取消済み" : DOCUMENT_STATUS_LABELS[doc.status as InvoiceDocumentStatus]}</span>
                  <span>発行日: {doc.issue_date}</span>
                  {doc.void_reason ? <span className="text-red-600">取消理由: {doc.void_reason}</span> : null}
                  {doc.drive_url ? (
                    <a href={doc.drive_url} target="_blank" rel="noreferrer" className="text-[var(--accent-strong)] underline">
                      PDF
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </li>
  );
}
