import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;
export type InvoiceDocumentRow = Database["public"]["Tables"]["invoice_documents"]["Row"];

/**
 * JST（UTC+9固定）での「今日」の日付('YYYY-MM-DD')。
 * 発行日(issue_date)はDBサーバー側のcurrent_date(UTC)に委ねず、呼び出し側(アプリ層)で
 * JSTの「今日」を解決してRPCへ渡す（currentMonthIsoJstと同じ考え方。UTC日付のまま
 * 渡すと日本時間の深夜〜朝にかけて日付が1日ずれるため）。
 */
export function todayIsoJst(): string {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = jstNow.getUTCFullYear();
  const m = String(jstNow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jstNow.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface BeginInvoiceDocumentIssueResult {
  error: string | null;
  invoiceDocumentId?: string;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
}

/**
 * 正式請求書の発行を開始する（PDF生成・Drive保存はまだ行わない。Phase2C以降で追加）。
 * 権限確認・行ロック・採番・snapshot生成等はすべてbegin_invoice_document_issue RPC内の
 * 1トランザクションで完結するため、ここでは結果を薄くラップするだけにする
 * （Phase1のconfirmExpenseBatchと同じ方針）。
 */
export async function beginInvoiceDocumentIssue(
  supabase: TypedClient,
  invoiceId: string,
  issueDateIso: string,
): Promise<BeginInvoiceDocumentIssueResult> {
  const { data, error } = await supabase.rpc("begin_invoice_document_issue", {
    p_invoice_id: invoiceId,
    p_issue_date: issueDateIso,
  });

  if (error || !data) {
    return { error: error?.message ?? "請求書の発行開始に失敗しました。" };
  }

  return {
    error: null,
    invoiceDocumentId: data.invoice_document_id,
    invoiceNumber: data.invoice_number,
    issueDate: data.issue_date,
    dueDate: data.due_date,
  };
}

/** 発行準備済み/発行済みのinvoice_documentを取消する（物理DELETEはしない。番号は再利用されない）。 */
export async function voidInvoiceDocument(
  supabase: TypedClient,
  invoiceDocumentId: string,
  reason: string,
): Promise<{ error: string | null }> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { error: "取消理由を入力してください。" };
  }

  const { error } = await supabase.rpc("void_invoice_document", {
    p_invoice_document_id: invoiceDocumentId,
    p_reason: trimmedReason,
  });

  if (error) return { error: error.message };
  return { error: null };
}

/** invoiceに紐づく有効な(voidされていない)invoice_documentを1件取得する。無ければnull。 */
export async function getActiveInvoiceDocument(
  supabase: TypedClient,
  invoiceId: string,
): Promise<InvoiceDocumentRow | null> {
  const { data, error } = await supabase
    .from("invoice_documents")
    .select("*")
    .eq("invoice_id", invoiceId)
    .is("voided_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** invoiceに紐づくinvoice_documentの履歴（void済みも含む）を発行日時降順で取得する。 */
export async function listInvoiceDocumentsForInvoice(
  supabase: TypedClient,
  invoiceId: string,
): Promise<InvoiceDocumentRow[]> {
  const { data, error } = await supabase
    .from("invoice_documents")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("issued_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
