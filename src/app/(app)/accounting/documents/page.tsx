import Link from "next/link";
import { requireAccountingAccess } from "@/lib/accounting/authGuard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listAccountingDocuments, type AccountingDocumentListRow } from "@/lib/accounting/queries";
import { PageContainer } from "@/components/PageContainer";
import { AccountingDocumentUploadForm } from "@/components/AccountingDocumentUploadForm";

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  receipt: "レシート・領収書",
  invoice_received: "仕入先請求書",
  other: "その他",
};

const STATUS_LABELS: Record<string, string> = {
  uploaded: "未確認",
  confirmed: "確定済み",
  rejected: "却下",
  voided: "取消済み",
};

function statusBadgeClass(status: string): string {
  if (status === "confirmed") return "bg-green-100 text-green-700";
  if (status === "voided" || status === "rejected") return "bg-neutral-100 text-neutral-400";
  return "bg-amber-100 text-amber-700";
}

function yen(amount: number | null): string {
  if (amount === null) return "—";
  return `${amount.toLocaleString("ja-JP")}円`;
}

export default async function AccountingDocumentsPage() {
  await requireAccountingAccess();
  const supabase = await createSupabaseServerClient();
  const documents = await listAccountingDocuments(supabase);
  const unconfirmedCount = documents.filter((d) => d.status === "uploaded").length;

  return (
    <PageContainer variant="wide" className="gap-6 bg-neutral-50 py-6 sm:py-8">
      <div>
        <Link href="/" className="text-sm text-neutral-500">
          ← ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">書類BOX</h1>
        <p className="mt-1 text-xs text-neutral-500">
          レシート・領収書・請求書などをアップロードし、内容を確認してから経費として確定します。
          最終的な会計・税務判断は税理士確認前提です。
        </p>
      </div>

      <AccountingDocumentUploadForm />

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700">書類一覧</h2>
        {unconfirmedCount > 0 ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
            未確認 {unconfirmedCount}件
          </span>
        ) : null}
      </div>

      {documents.length === 0 ? (
        <p className="rounded-2xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-400">
          まだ書類がアップロードされていません。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {documents.map((doc: AccountingDocumentListRow) => (
            <li key={doc.id}>
              <Link
                href={`/accounting/documents/${doc.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-neutral-200 bg-white p-4 hover:bg-neutral-50"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-neutral-900">
                      {doc.vendor_name_candidate ?? "（取引先未入力）"}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${statusBadgeClass(doc.status)}`}>
                      {STATUS_LABELS[doc.status] ?? doc.status}
                    </span>
                    {doc.duplicate_warning ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        ⚠ 重複の可能性
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">
                    {DOCUMENT_TYPE_LABELS[doc.document_type] ?? doc.document_type} ・ {doc.file_name} ・ 取引日:{" "}
                    {doc.transaction_date_candidate ?? "未入力"}
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    アップロード: {new Date(doc.uploaded_at).toLocaleString("ja-JP")} ・ {doc.uploadedByName}
                  </p>
                </div>
                <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-neutral-900">
                  {yen(doc.amount_candidate)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
