import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";
import { validateInvoiceDocumentSnapshot, type InvoiceDocumentSnapshot } from "./snapshot";
import { assertTextRenderableWithInvoiceFont, registerInvoiceFonts } from "./fonts";
import { InvoiceDocumentPdf } from "./InvoiceDocumentPdf";
import { calculateInvoiceTaxSummary, type TaxableInvoiceItem } from "@/lib/billing/invoiceTaxSummary";

// Phase2B: 正式請求書PDF生成エンジン本体。
// - DB(clients/client_billing_profiles/invoice_items/company_profile)へは一切アクセスしない
//   純粋関数。invoice_documents.snapshot相当の固定済みデータだけを受け取る（発行後に元データが
//   変わってもPDF内容が変わらない設計をPDF生成側でも保証する）。
// - Node runtime前提（@react-pdf/renderer/pdfkit/fontkitがfsを使うため、Edge runtimeでは動作しない。
//   このモジュールをEdge route/middlewareから呼ばないこと）。
// - Phase2BではDBへのgeneration_error保存は行わない。失敗時は例外を投げるだけ。
// - 消費税額・税込請求額（2026-10-07決定、freee準拠）は、snapshot.itemsだけからこの関数内で
//   純粋計算する（calculateInvoiceTaxSummary）。DBへは一切再アクセスしない。発行後に元の
//   invoice_itemsが変わっても、同じsnapshotから常に同じ税額が再現される。

/** snapshot.itemsはcancelled_at/amount_overrideを持たない（Phase2A発行RPCの時点で既に
 * 未取消の明細だけへ絞り込み済みのスナップショットのため）。そのため
 * cancelled_at: null・amount_override: nullを明示して渡し、effectiveInvoiceItemAmountが
 * そのままtax_excluded_amountを使うようにする（新しい金額ロジックを作らない）。 */
function toTaxableItems(items: InvoiceDocumentSnapshot["items"]): TaxableInvoiceItem[] {
  return items.map((item) => ({
    cancelled_at: null,
    tax_rate: item.tax_rate,
    amount_override: null,
    tax_excluded_amount: item.tax_excluded_amount,
  }));
}

export interface GenerateInvoicePdfResult {
  buffer: Buffer;
}

function collectSnapshotText(snapshot: InvoiceDocumentSnapshot): string {
  const parts: string[] = [
    "請求書",
    snapshot.issuer.company_name,
    snapshot.issuer.address,
    snapshot.issuer.bank_name,
    snapshot.issuer.branch_name,
    snapshot.issuer.account_type,
    snapshot.issuer.account_holder_name,
    snapshot.recipient.company_name,
    snapshot.recipient.department ?? "",
    snapshot.recipient.contact_name ?? "",
    snapshot.recipient.address,
    snapshot.invoice.invoice_title ?? "",
  ];
  for (const item of snapshot.items) {
    parts.push(item.subject, item.description ?? "");
  }
  return parts.join("\n");
}

/**
 * invoice_documents.snapshotと同じ構造のデータから、正式請求書PDFをBufferとして生成する。
 * 入力が不正な場合、またはフォントに存在しない文字が含まれる場合は例外を投げる
 * （黙って文字化けPDFを生成しない）。
 */
export async function generateInvoicePdf(snapshotInput: unknown): Promise<GenerateInvoicePdfResult> {
  const { data: snapshot, error } = validateInvoiceDocumentSnapshot(snapshotInput);
  if (error || !snapshot) {
    throw new Error(`invoice_documents.snapshotの形式が不正です: ${error}`);
  }

  // tax_rateが未設定の明細が含まれる場合はcalculateInvoiceTaxSummaryが例外を投げる
  // （黙って0%扱いにしない。begin_invoice_document_issue RPC側の防御と二重に効く）。
  const taxSummary = calculateInvoiceTaxSummary(toTaxableItems(snapshot.items));

  registerInvoiceFonts();
  assertTextRenderableWithInvoiceFont(collectSnapshotText(snapshot));

  const buffer = await renderToBuffer(InvoiceDocumentPdf({ snapshot, taxSummary }));
  return { buffer };
}
