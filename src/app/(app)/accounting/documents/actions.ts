"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccountingAccess } from "@/lib/accounting/authGuard";
import { getDriveService } from "@/lib/drive/DriveService";
import { validateBrowserOrigin } from "@/lib/http/origin";
import {
  confirmAccountingDocumentUpload,
  currentYearMonthJst,
  isAllowedAccountingMimeType,
  isValidDocumentType,
  updateAccountingDocumentCandidate,
  voidAccountingDocument,
  type ConfirmAccountingDocumentUploadResult,
} from "@/lib/accounting/documents";
import {
  confirmExpenseBatch,
  validateExpenseBatchConfirmInput,
  type ExpenseBatchConfirmInput,
} from "@/lib/accounting/expenses";
import type { AccountingDocumentType } from "@/lib/supabase/database.types";

function documentsUrl(params: Record<string, string> = {}): string {
  const search = new URLSearchParams(params).toString();
  return search ? `/accounting/documents?${search}` : "/accounting/documents";
}

function documentDetailUrl(id: string, params: Record<string, string> = {}): string {
  const search = new URLSearchParams(params).toString();
  return search ? `/accounting/documents/${id}?${search}` : `/accounting/documents/${id}`;
}

// ---------------------------------------------------------------------------
// ブラウザ→Google Drive直接アップロード方式（既存material/production-videos/outsourcingと
// 同じ2段階パターン: ①ここでresumable upload sessionを発行 → ②ブラウザが直接Driveへ
// PUT → ③confirmAccountingDocumentUploadActionでmetadataだけをDBへ登録）。
// ファイル本文はNetlify Functionsのリクエストボディへ一切通さない。
// ---------------------------------------------------------------------------

export interface CreateAccountingDocumentUploadSessionInput {
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
}

export interface CreateAccountingDocumentUploadSessionResult {
  error: string | null;
  sessionUrl?: string;
}

/**
 * 経理書類BOX専用フォルダ({root}/_経理/書類BOX/{YYYY-MM}/)を解決し、resumable upload
 * sessionを1件発行する。access token等の秘密情報は戻り値に一切含めない。
 */
export async function createAccountingDocumentUploadSessionAction(
  input: CreateAccountingDocumentUploadSessionInput,
  browserOrigin?: string,
): Promise<CreateAccountingDocumentUploadSessionResult> {
  await requireAccountingAccess();

  const fileName = String(input.fileName ?? "").trim();
  if (!fileName) {
    return { error: "ファイルを選択してください。" };
  }
  const mimeType = String(input.mimeType ?? "application/octet-stream");
  if (!isAllowedAccountingMimeType(mimeType)) {
    return { error: "PDF・JPG・PNG形式のみアップロードできます。" };
  }

  try {
    const validatedOrigin = await validateBrowserOrigin(browserOrigin);
    const drive = await getDriveService();
    const folder = await drive.resolveAccountingDocumentFolder({ yearMonth: currentYearMonthJst() });
    const { sessionUrl } = await drive.createResumableUploadSession({
      folderId: folder.folderId,
      file: { name: fileName, mimeType, sizeBytes: Number(input.fileSizeBytes) || 0 },
      origin: validatedOrigin,
    });
    return { error: null, sessionUrl };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Google Driveとの接続に失敗しました。時間をおいて再度お試しください。",
    };
  }
}

export interface ConfirmAccountingDocumentUploadActionInput {
  documentType: string;
  fileName: string;
  driveFileId: string;
  driveUrl: string;
  mimeType: string;
  fileSizeBytes: number;
  fileHash: string;
}

/**
 * アップロード成功後、小さいmetadataだけを受け取ってaccounting_documentsへ登録する。
 * 失敗時（DB登録エラー等）は、既存パターン同様にDrive側のファイルをベストエフォートで
 * 削除する（孤立ファイル防止）。
 */
export async function confirmAccountingDocumentUploadAction(
  input: ConfirmAccountingDocumentUploadActionInput,
): Promise<ConfirmAccountingDocumentUploadResult> {
  const staff = await requireAccountingAccess();
  const supabase = await createSupabaseServerClient();

  if (!isValidDocumentType(input.documentType)) {
    return { error: "書類種別を選択してください。" };
  }

  const result = await confirmAccountingDocumentUpload(
    supabase,
    {
      documentType: input.documentType as AccountingDocumentType,
      fileName: input.fileName,
      driveFileId: input.driveFileId,
      driveUrl: input.driveUrl,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileSizeBytes,
      fileHash: input.fileHash,
    },
    staff.id,
  );

  if (result.error && !result.documentId) {
    // DB登録自体に失敗した場合のみ、孤立したDriveファイルをベストエフォートで後始末する。
    try {
      const drive = await getDriveService();
      await drive.deleteFile(input.driveFileId);
    } catch {
      // ベストエフォートのため無視する。
    }
  }

  return result;
}

/** 書類の候補値（取引日・取引先・金額等）を編集する。status='uploaded'の間のみ有効。 */
export async function updateAccountingDocumentAction(formData: FormData) {
  await requireAccountingAccess();
  const supabase = await createSupabaseServerClient();
  const documentId = String(formData.get("documentId") ?? "").trim();

  const documentType = String(formData.get("documentType") ?? "");
  if (!isValidDocumentType(documentType)) {
    redirect(documentDetailUrl(documentId, { error: "書類種別を選択してください。" }));
  }

  function emptyToNull(value: FormDataEntryValue | null): string | null {
    const text = String(value ?? "").trim();
    return text === "" ? null : text;
  }
  function emptyToNumber(value: FormDataEntryValue | null): number | null {
    const text = String(value ?? "").trim();
    if (text === "") return null;
    const num = Number(text);
    return Number.isFinite(num) ? num : null;
  }

  const result = await updateAccountingDocumentCandidate(supabase, documentId, {
    documentType: documentType as AccountingDocumentType,
    transactionDate: emptyToNull(formData.get("transactionDate")),
    vendorName: emptyToNull(formData.get("vendorName")),
    amount: emptyToNumber(formData.get("amount")),
    taxAmount: emptyToNumber(formData.get("taxAmount")),
    taxRate: emptyToNumber(formData.get("taxRate")),
    invoiceNumber: emptyToNull(formData.get("invoiceNumber")),
    description: emptyToNull(formData.get("description")),
    dueDate: emptyToNull(formData.get("dueDate")),
    paymentMethod: emptyToNull(formData.get("paymentMethod")),
    accountCategory: emptyToNull(formData.get("accountCategory")),
    taxCategory: emptyToNull(formData.get("taxCategory")),
  });

  redirect(documentDetailUrl(documentId, result.error ? { error: result.error } : { saved: "1" }));
}

/** 書類の取消（voided）。未確定の書類のみ対象。 */
export async function voidAccountingDocumentAction(formData: FormData) {
  const staff = await requireAccountingAccess();
  const supabase = await createSupabaseServerClient();
  const documentId = String(formData.get("documentId") ?? "").trim();
  const reason = String(formData.get("voidReason") ?? "");

  const result = await voidAccountingDocument(supabase, documentId, reason, staff.id);

  if (result.error) {
    redirect(documentDetailUrl(documentId, { error: result.error }));
  }
  redirect(documentsUrl({ saved: "voided" }));
}

export interface ConfirmExpenseBatchActionResult {
  error: string | null;
  expenseIds?: string[];
  warning?: string;
}

/**
 * 書類確認画面の「経費として確定」。1書類:複数明細(expenses)を許可するため、
 * フォームがクライアントコンポーネント(AccountingExpenseConfirmForm)から構造化
 * オブジェクトを直接受け取る（BillingRegistrationFormと同じ方式）。redirectではなく
 * 結果オブジェクトを返し、成功時はクライアント側でrouter.push()して経費一覧へ遷移する。
 */
export async function confirmExpenseBatchFromDocumentAction(
  input: ExpenseBatchConfirmInput,
): Promise<ConfirmExpenseBatchActionResult> {
  // ページ/Action層でもfinance権限を確認する（UIを隠すだけにしない）。実際の確定処理は
  // RPC側でもcan_view_finance()/current_staff_id()を再確認するため二重防御になる。
  await requireAccountingAccess();
  const supabase = await createSupabaseServerClient();

  const { data, error: validationError } = validateExpenseBatchConfirmInput(input);
  if (validationError || !data) {
    return { error: validationError ?? "入力内容を確認してください。" };
  }

  const result = await confirmExpenseBatch(supabase, data);
  if (result.error) {
    return { error: result.error };
  }
  return { error: null, expenseIds: result.expenseIds, warning: result.warning };
}
