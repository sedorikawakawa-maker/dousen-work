import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccountingAccess } from "@/lib/accounting/authGuard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAccountingDocumentById } from "@/lib/accounting/queries";
import { PageContainer } from "@/components/PageContainer";
import { AccountingExpenseConfirmForm } from "@/components/AccountingExpenseConfirmForm";
import { updateAccountingDocumentAction, voidAccountingDocumentAction } from "../actions";
import { ACCOUNT_CATEGORY_OPTIONS, TAX_CATEGORY_OPTIONS } from "@/lib/accounting/categories";

const DOCUMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "receipt", label: "レシート・領収書" },
  { value: "invoice_received", label: "仕入先請求書" },
  { value: "other", label: "その他" },
];

const STATUS_LABELS: Record<string, string> = {
  uploaded: "未確認",
  confirmed: "確定済み",
  rejected: "却下",
  voided: "取消済み",
};

export default async function AccountingDocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAccountingAccess();
  const { id } = await params;
  const { saved, error } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const document = await getAccountingDocumentById(supabase, id);
  if (!document) {
    notFound();
  }

  const isEditable = document.status === "uploaded";

  return (
    <PageContainer variant="narrow" className="gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/accounting/documents" className="text-sm text-neutral-500">
          ← 書類BOXに戻る
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-neutral-900">書類の確認</h1>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
            {STATUS_LABELS[document.status] ?? document.status}
          </span>
          {document.duplicate_warning ? (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              ⚠ このファイルは既に登録されている可能性があります（重複警告）
            </span>
          ) : null}
        </div>
      </div>

      {saved ? <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">保存しました。</p> : null}
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">原本</h2>
        <a
          href={document.drive_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[var(--accent-strong)] underline"
        >
          {document.file_name} をGoogle Driveで開く →
        </a>
        <p className="mt-1 text-xs text-neutral-400">
          アップロード: {new Date(document.uploaded_at).toLocaleString("ja-JP")} ・ {document.uploadedByName}
        </p>
      </div>

      {document.status === "voided" ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5 text-sm text-neutral-600">
          <p>この書類は取消済みです。</p>
          <p className="mt-1 text-xs text-neutral-400">
            取消理由: {document.void_reason} ・ {document.voidedByName} ・{" "}
            {document.voided_at ? new Date(document.voided_at).toLocaleString("ja-JP") : ""}
          </p>
        </div>
      ) : null}

      <form
        action={updateAccountingDocumentAction}
        className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5"
      >
        <input type="hidden" name="documentId" value={document.id} />

        <p className="rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
          以下は入力内容の候補です。金額・勘定科目・税区分を含め、最終的な会計・税務上の判断は税理士確認前提としてください。
        </p>

        <label className="text-sm font-medium text-neutral-700">
          書類種別
          <select
            name="documentType"
            defaultValue={document.document_type}
            disabled={!isEditable}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          >
            {DOCUMENT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-neutral-700">
            取引日
            <input
              name="transactionDate"
              type="date"
              defaultValue={document.transaction_date_candidate ?? ""}
              disabled={!isEditable}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
            />
          </label>
          <label className="text-sm font-medium text-neutral-700">
            取引先
            <input
              name="vendorName"
              type="text"
              defaultValue={document.vendor_name_candidate ?? ""}
              disabled={!isEditable}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-neutral-700">
            合計金額（円）
            <input
              name="amount"
              type="number"
              step="1"
              min="0"
              defaultValue={document.amount_candidate ?? ""}
              disabled={!isEditable}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
            />
          </label>
          <label className="text-sm font-medium text-neutral-700">
            税額（円・任意）
            <input
              name="taxAmount"
              type="number"
              step="1"
              min="0"
              defaultValue={document.tax_amount_candidate ?? ""}
              disabled={!isEditable}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-neutral-700">
            税率（%・任意）
            <input
              name="taxRate"
              type="number"
              step="0.1"
              min="0"
              defaultValue={document.tax_rate_candidate ?? ""}
              disabled={!isEditable}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
            />
          </label>
          <label className="text-sm font-medium text-neutral-700">
            請求書番号（任意）
            <input
              name="invoiceNumber"
              type="text"
              defaultValue={document.invoice_number_candidate ?? ""}
              disabled={!isEditable}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
            />
          </label>
        </div>

        <label className="text-sm font-medium text-neutral-700">
          摘要（任意）
          <input
            name="description"
            type="text"
            defaultValue={document.description_candidate ?? ""}
            disabled={!isEditable}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-neutral-700">
            支払期限（任意）
            <input
              name="dueDate"
              type="date"
              defaultValue={document.due_date_candidate ?? ""}
              disabled={!isEditable}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
            />
          </label>
          <label className="text-sm font-medium text-neutral-700">
            支払方法（任意）
            <input
              name="paymentMethod"
              type="text"
              defaultValue={document.payment_method_candidate ?? ""}
              disabled={!isEditable}
              placeholder="例: クレジットカード・現金・銀行振込"
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-neutral-700">
            勘定科目（候補・税理士確認前提）
            <select
              name="accountCategory"
              defaultValue={document.account_category_candidate ?? ""}
              disabled={!isEditable}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
            >
              <option value="">選択しない</option>
              {ACCOUNT_CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-neutral-700">
            税区分（候補・税理士確認前提）
            <select
              name="taxCategory"
              defaultValue={document.tax_category_candidate ?? ""}
              disabled={!isEditable}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
            >
              <option value="">選択しない</option>
              {TAX_CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isEditable ? (
          <button
            type="submit"
            className="w-full rounded-full border border-neutral-300 px-4 py-3 text-sm font-semibold text-neutral-700 sm:w-auto"
          >
            内容を保存
          </button>
        ) : null}
      </form>

      {isEditable ? (
        <AccountingExpenseConfirmForm
          documentId={document.id}
          initialTransactionDate={document.transaction_date_candidate ?? ""}
          initialVendorName={document.vendor_name_candidate ?? ""}
          initialPaymentMethod={document.payment_method_candidate ?? ""}
          documentAmountCandidate={document.amount_candidate}
        />
      ) : null}

      {isEditable ? (
        <details className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <summary className="cursor-pointer text-sm font-medium text-red-700">この書類を取消す</summary>
          <form action={voidAccountingDocumentAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="documentId" value={document.id} />
            <label className="text-xs font-medium text-neutral-700">
              取消理由（必須）
              <input
                name="voidReason"
                type="text"
                required
                className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm"
              />
            </label>
            <button
              type="submit"
              className="self-start rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white"
            >
              取消する（確定）
            </button>
          </form>
        </details>
      ) : null}
    </PageContainer>
  );
}
