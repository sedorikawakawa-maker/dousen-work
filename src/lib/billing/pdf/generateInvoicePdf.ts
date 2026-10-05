import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";
import { validateInvoiceDocumentSnapshot, type InvoiceDocumentSnapshot } from "./snapshot";
import { assertTextRenderableWithInvoiceFont, registerInvoiceFonts } from "./fonts";
import { InvoiceDocumentPdf } from "./InvoiceDocumentPdf";

// Phase2B: 正式請求書PDF生成エンジン本体。
// - DB(clients/client_billing_profiles/invoice_items/company_profile)へは一切アクセスしない
//   純粋関数。invoice_documents.snapshot相当の固定済みデータだけを受け取る（発行後に元データが
//   変わってもPDF内容が変わらない設計をPDF生成側でも保証する）。
// - Node runtime前提（@react-pdf/renderer/pdfkit/fontkitがfsを使うため、Edge runtimeでは動作しない。
//   このモジュールをEdge route/middlewareから呼ばないこと）。
// - Phase2BではDBへのgeneration_error保存は行わない。失敗時は例外を投げるだけ。

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

  registerInvoiceFonts();
  assertTextRenderableWithInvoiceFont(collectSnapshotText(snapshot));

  const buffer = await renderToBuffer(InvoiceDocumentPdf({ snapshot }));
  return { buffer };
}
