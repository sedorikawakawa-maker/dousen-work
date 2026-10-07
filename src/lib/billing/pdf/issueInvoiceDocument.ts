import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { DriveService } from "@/lib/drive/DriveService";
import { generateInvoicePdf } from "./generateInvoicePdf";
import { validateInvoiceDocumentSnapshot } from "./snapshot";
import { buildInvoiceDocumentFileName } from "./driveFileName";
import { toSafeGenerationErrorMessage } from "./errors";

type TypedClient = SupabaseClient<Database>;

// Phase2C: 「発行開始(issuing, Phase2A)」と「PDF生成+Drive保存+generated確定」を分離した
// 後半部分。DBとGoogle Driveは同一トランザクションにできないため、以下の順序を厳守する。
//   1. begin_invoice_document_generation_attempt（DB側ロック取得 + snapshot取得）
//   2. generateInvoicePdf（snapshotのみを使用。DBへは一切アクセスしない）
//   3. Drive upload
//   4. complete_invoice_document_generation（DB側でgenerated + invoices prepared を1トランザクションで確定）
// 2-4のいずれかで失敗した場合は mark_invoice_document_generation_failed でissuingのまま
// generation_errorだけを記録し、次回の再試行に同じinvoice_number/snapshotを使い回す
// （新しい番号は採番しない）。

export interface GenerateAndStoreInvoiceDocumentPdfResult {
  error: string | null;
  driveFileId?: string;
  driveUrl?: string;
}

/**
 * Node runtime専用（generateInvoicePdf/DriveServiceともにfsを使うため）。
 * Edge runtimeのRoute/Middlewareから呼び出さないこと。
 */
export async function generateAndStoreInvoiceDocumentPdf(
  supabase: TypedClient,
  driveService: DriveService,
  invoiceDocumentId: string,
): Promise<GenerateAndStoreInvoiceDocumentPdfResult> {
  // 1. DB側の生成ロックを取得し、snapshotとclient_idを受け取る。
  const { data: attempt, error: beginError } = await supabase.rpc("begin_invoice_document_generation_attempt", {
    p_invoice_document_id: invoiceDocumentId,
  });
  if (beginError || !attempt) {
    return { error: beginError?.message ?? "PDF生成の開始に失敗しました。" };
  }

  const { data: snapshot, error: snapshotError } = validateInvoiceDocumentSnapshot(attempt.snapshot);
  if (snapshotError || !snapshot) {
    const message = `snapshotの形式が不正です: ${snapshotError}`;
    await supabase.rpc("mark_invoice_document_generation_failed", {
      p_invoice_document_id: invoiceDocumentId,
      p_error_message: message,
    });
    return { error: message };
  }

  // 2. PDF生成（snapshotのみを使用。DBへは一切アクセスしない）。
  let buffer: Buffer;
  try {
    const result = await generateInvoicePdf(snapshot);
    buffer = result.buffer;
  } catch (err) {
    const message = toSafeGenerationErrorMessage(err);
    await supabase.rpc("mark_invoice_document_generation_failed", {
      p_invoice_document_id: invoiceDocumentId,
      p_error_message: message,
    });
    return { error: message };
  }

  // 3. Drive upload（{顧客フォルダ}/請求書/{発行年}/ へ、ファイル名はinvoice_number起点でsanitize済み）。
  const year = snapshot.invoice.issue_date.slice(0, 4);
  let driveFileId: string;
  let driveUrl: string;
  try {
    const folder = await driveService.resolveInvoiceDocumentFolder({ clientId: attempt.client_id, year });
    const fileName = buildInvoiceDocumentFileName(snapshot);
    // Buffer<ArrayBufferLike>はDOM libのBlobPart(ArrayBufferView<ArrayBuffer>)と型上噛み合わないため、
    // 単体のArrayBufferへ明示的に変換する（実行時の挙動は変わらない）。
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const file = new File([arrayBuffer], fileName, { type: "application/pdf" });
    const uploadResult = await driveService.uploadFileToResolvedFolder({ file, folderId: folder.folderId });
    driveFileId = uploadResult.driveFileId;
    driveUrl = uploadResult.driveUrl;
  } catch (err) {
    // アップロード自体が失敗した場合、Google Drive APIからdriveFileIdを受け取れていないため、
    // 後始末対象となる孤立ファイルの有無をここでは特定できない（ベストエフォート削除の対象外）。
    const message = toSafeGenerationErrorMessage(err);
    await supabase.rpc("mark_invoice_document_generation_failed", {
      p_invoice_document_id: invoiceDocumentId,
      p_error_message: message,
    });
    return { error: message };
  }

  // 4. DB側の確定（generated + invoices prepared を1トランザクションで）。
  const { error: completeError } = await supabase.rpc("complete_invoice_document_generation", {
    p_invoice_document_id: invoiceDocumentId,
    p_drive_file_id: driveFileId,
    p_drive_url: driveUrl,
  });

  if (completeError) {
    // DB確定が失敗したまま、Drive上にだけ「正式発行済みPDF」が残る状態を極力作らない
    // （ベストエフォート削除。削除自体が失敗した場合もgeneration_errorへ両方の内容を残す）。
    let message = completeError.message;
    try {
      await driveService.deleteFile(driveFileId);
    } catch (cleanupErr) {
      message = `${completeError.message}（Driveファイルの自動削除にも失敗しました: ${toSafeGenerationErrorMessage(
        cleanupErr,
      )}, driveFileId=${driveFileId}）`;
    }
    await supabase.rpc("mark_invoice_document_generation_failed", {
      p_invoice_document_id: invoiceDocumentId,
      p_error_message: message,
    });
    return { error: message };
  }

  return { error: null, driveFileId, driveUrl };
}
