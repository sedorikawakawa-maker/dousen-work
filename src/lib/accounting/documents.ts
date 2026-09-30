import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, AccountingDocumentType } from "@/lib/supabase/database.types";
import { hasDuplicateByHash } from "./queries";

type TypedClient = SupabaseClient<Database>;

// Google DriveのファイルIDは可変長の英数字+ "-" "_"（既存production-videos/actions.tsと同じ緩めの検証）。
const DRIVE_FILE_ID_PATTERN = /^[\w-]{10,}$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

export const ACCOUNTING_ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
const DOCUMENT_TYPES: readonly AccountingDocumentType[] = ["receipt", "invoice_received", "other"];

export function isAllowedAccountingMimeType(mimeType: string): boolean {
  return ACCOUNTING_ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase());
}

export function isValidDocumentType(value: unknown): value is AccountingDocumentType {
  return typeof value === "string" && (DOCUMENT_TYPES as readonly string[]).includes(value);
}

/** 'YYYY-MM'形式の現在年月（JST）。書類BOXのDriveフォルダ分けに使う。 */
export function currentYearMonthJst(): string {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface ConfirmAccountingDocumentUploadInput {
  documentType: AccountingDocumentType;
  fileName: string;
  driveFileId: string;
  driveUrl: string;
  mimeType: string;
  fileSizeBytes: number;
  fileHash: string;
}

export interface ConfirmAccountingDocumentUploadResult {
  error: string | null;
  documentId?: string;
  duplicateWarning?: boolean;
}

/**
 * ブラウザ→Google Drive直接アップロード成功後、metadataだけを受け取ってaccounting_documentsへ
 * 登録する（production_videosのconfirmProductionVideoUploadActionと同じ検証方針：
 * ブラウザ申告値は無条件に信用せず、driveFileId/driveUrlの形式・許可mimeType・hash形式を検証する）。
 * 重複検出はfile_hash完全一致のみ（Phase1範囲）。重複していても登録自体は拒否せず、
 * duplicate_warning=trueとして保存するに留める。
 */
export async function confirmAccountingDocumentUpload(
  supabase: TypedClient,
  input: ConfirmAccountingDocumentUploadInput,
  uploadedByStaffId: string,
): Promise<ConfirmAccountingDocumentUploadResult> {
  if (!isValidDocumentType(input.documentType)) {
    return { error: "書類種別の指定が不正です。" };
  }
  const fileName = String(input.fileName ?? "").trim();
  if (!fileName) {
    return { error: "ファイル名が不正です。" };
  }
  if (!DRIVE_FILE_ID_PATTERN.test(input.driveFileId)) {
    return { error: "アップロード結果の検証に失敗しました。時間をおいて再度お試しください。" };
  }
  if (!input.driveUrl.startsWith("https://drive.google.com/")) {
    return { error: "アップロード結果の検証に失敗しました。時間をおいて再度お試しください。" };
  }
  if (!isAllowedAccountingMimeType(input.mimeType)) {
    return { error: "PDF・JPG・PNG形式のみアップロードできます。" };
  }
  if (!Number.isFinite(input.fileSizeBytes) || input.fileSizeBytes <= 0) {
    return { error: "ファイルサイズの取得に失敗しました。" };
  }
  if (!SHA256_HEX_PATTERN.test(input.fileHash)) {
    return { error: "ファイルの検証(hash計算)に失敗しました。時間をおいて再度お試しください。" };
  }

  const duplicateWarning = await hasDuplicateByHash(supabase, input.fileHash);

  const { data, error } = await supabase
    .from("accounting_documents")
    .insert({
      document_type: input.documentType,
      drive_file_id: input.driveFileId,
      drive_url: input.driveUrl,
      file_name: fileName,
      mime_type: input.mimeType,
      file_size_bytes: Math.round(input.fileSizeBytes),
      file_hash: input.fileHash.toLowerCase(),
      uploaded_by_staff_id: uploadedByStaffId,
      duplicate_warning: duplicateWarning,
      ocr_raw_result: null,
      transaction_date_candidate: null,
      vendor_name_candidate: null,
      amount_candidate: null,
      tax_amount_candidate: null,
      tax_rate_candidate: null,
      invoice_number_candidate: null,
      description_candidate: null,
      due_date_candidate: null,
      payment_method_candidate: null,
      account_category_candidate: null,
      tax_category_candidate: null,
      voided_at: null,
      voided_by_staff_id: null,
      void_reason: null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "登録に失敗しました。" };
  }

  return { error: null, documentId: data.id, duplicateWarning };
}

export interface UpdateAccountingDocumentCandidateInput {
  documentType: AccountingDocumentType;
  transactionDate: string | null;
  vendorName: string | null;
  amount: number | null;
  taxAmount: number | null;
  taxRate: number | null;
  invoiceNumber: string | null;
  description: string | null;
  dueDate: string | null;
  paymentMethod: string | null;
  accountCategory: string | null;
  taxCategory: string | null;
}

/**
 * 書類の候補値を編集する（status='uploaded'の間のみ。確定/取消後はDBトリガーで拒否される）。
 * ここで編集する値はAI/OCRが将来自動入力するのと同じ列であり、人間の手入力もこの関数を通る。
 */
export async function updateAccountingDocumentCandidate(
  supabase: TypedClient,
  documentId: string,
  input: UpdateAccountingDocumentCandidateInput,
): Promise<{ error: string | null }> {
  if (!isValidDocumentType(input.documentType)) {
    return { error: "書類種別の指定が不正です。" };
  }

  const { error } = await supabase
    .from("accounting_documents")
    .update({
      document_type: input.documentType,
      transaction_date_candidate: input.transactionDate,
      vendor_name_candidate: input.vendorName,
      amount_candidate: input.amount,
      tax_amount_candidate: input.taxAmount,
      tax_rate_candidate: input.taxRate,
      invoice_number_candidate: input.invoiceNumber,
      description_candidate: input.description,
      due_date_candidate: input.dueDate,
      payment_method_candidate: input.paymentMethod,
      account_category_candidate: input.accountCategory,
      tax_category_candidate: input.taxCategory,
    })
    .eq("id", documentId)
    .eq("status", "uploaded");

  if (error) {
    return { error: "この書類は既に確定・取消済みのため編集できません。" };
  }
  return { error: null };
}

/** 書類の取消（voided）。未確定(status='uploaded')の書類のみ対象。Driveの原本は削除しない。 */
export async function voidAccountingDocument(
  supabase: TypedClient,
  documentId: string,
  reason: string,
  voidedByStaffId: string,
): Promise<{ error: string | null }> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { error: "取消理由を入力してください。" };
  }

  const { data, error } = await supabase
    .from("accounting_documents")
    .update({ status: "voided", voided_at: new Date().toISOString(), voided_by_staff_id: voidedByStaffId, void_reason: trimmedReason })
    .eq("id", documentId)
    .eq("status", "uploaded")
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: "取消に失敗しました。" };
  }
  if (!data) {
    return { error: "この書類は既に確定・取消済みのため取消できません。" };
  }
  return { error: null };
}
