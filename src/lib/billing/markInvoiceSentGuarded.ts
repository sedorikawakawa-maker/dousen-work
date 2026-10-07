import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

// 既存のmark_invoice_sent RPC自体は「PDF未発行でもsentにできる」ギャップを持つが、
// 今回はmigration/DB仕様変更が禁止されているため、RPC本体は変更しない。
// 代わりに、/accounting/invoicesの正式なUI導線（このServer Action経由の呼び出し）だけで
// 「invoice.status='prepared' かつ 有効なinvoice_documentがstatus='generated'」を確認した
// 上でRPCを呼ぶ。DBレベルの完全な防御（RPC自体へのガード追加）は別Phaseの改善候補として
// 別途報告する。

export interface MarkInvoiceSentGuardedResult {
  error: string | null;
}

export async function markInvoiceSentGuarded(
  supabase: TypedClient,
  invoiceId: string,
): Promise<MarkInvoiceSentGuardedResult> {
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invoiceError) return { error: invoiceError.message };
  if (!invoice) return { error: "対象の請求書が見つかりません。" };
  if (invoice.status !== "prepared") {
    return { error: "この請求書は「送付済み」にできる状態ではありません（請求書作成済みの状態である必要があります）。" };
  }

  const { data: activeDocument, error: documentError } = await supabase
    .from("invoice_documents")
    .select("status")
    .eq("invoice_id", invoiceId)
    .is("voided_at", null)
    .maybeSingle();
  if (documentError) return { error: documentError.message };
  if (!activeDocument || activeDocument.status !== "generated") {
    return { error: "正式な請求書PDFが発行済み（generated）の状態でなければ送付済みにできません。" };
  }

  const { error: rpcError } = await supabase.rpc("mark_invoice_sent", { p_invoice_id: invoiceId });
  if (rpcError) return { error: rpcError.message };
  return { error: null };
}
