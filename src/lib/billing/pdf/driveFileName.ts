import "server-only";

import type { InvoiceDocumentSnapshot } from "./snapshot";
import { formatJapaneseMonth } from "./format";

// Windows/Driveで問題になりやすい文字（/ \ : * ? " < > |）を安全な文字へ置き換える。
// invoice_numberが一意のため、この関数自体は一意性を保証する必要はない
// （ファイル名の衝突防止はinvoice_number側の責務）。
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|]/g;

export function sanitizeDriveFileNameSegment(segment: string): string {
  return segment.replace(UNSAFE_FILENAME_CHARS, "_").trim();
}

/**
 * {invoice_number}_{請求先会社名}_{YYYY年MM月請求書}.pdf 形式のファイル名を組み立てる。
 * invoice_numberが発行時点で一意に採番されているため、同名上書きは基本的に発生しない
 * （voidして再発行した場合は新しいinvoice_numberになるため、別ファイル名になる）。
 */
export function buildInvoiceDocumentFileName(snapshot: InvoiceDocumentSnapshot): string {
  const recipient = sanitizeDriveFileNameSegment(snapshot.recipient.company_name);
  const monthLabel = sanitizeDriveFileNameSegment(formatJapaneseMonth(snapshot.invoice.billing_month));
  return `${snapshot.invoice.invoice_number}_${recipient}_${monthLabel}請求書.pdf`;
}
