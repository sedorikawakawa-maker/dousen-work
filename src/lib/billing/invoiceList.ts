import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { effectiveInvoiceItemAmount, listInvoicesForMonth, type ManagementInvoiceRow } from "@/lib/billing/queries";

type TypedClient = SupabaseClient<Database>;
export type InvoiceDocumentRow = Database["public"]["Tables"]["invoice_documents"]["Row"];

/** 既存effectiveInvoiceItemAmountの単純合算（取消済みは除外）。新しい金額計算ロジックは作らない。 */
export function invoiceTotalAmount(invoice: ManagementInvoiceRow): number {
  return invoice.items.filter((item) => item.cancelled_at === null).reduce((sum, item) => sum + effectiveInvoiceItemAmount(item), 0);
}

export type RevenueMonthSummary = { kind: "single"; month: string } | { kind: "multiple" } | { kind: "none" };

/**
 * invoiceにrevenue_month列は無い（明細ごとに異なり得る）ため、DBへ新しい列を追加せず
 * 表示側でまとめる。有効な明細が全て同一revenue_monthなら単一月、複数混在なら"複数月"、
 * 有効な明細が無ければ"none"を返す。
 */
export function summarizeRevenueMonths(invoice: ManagementInvoiceRow): RevenueMonthSummary {
  const activeMonths = [...new Set(invoice.items.filter((item) => item.cancelled_at === null).map((item) => item.revenue_month))];
  if (activeMonths.length === 0) return { kind: "none" };
  if (activeMonths.length === 1) return { kind: "single", month: activeMonths[0] };
  return { kind: "multiple" };
}

/** 有効な明細のうち、tax_rateが未設定のものが1件でもあるか（発行前チェックのUI表示用）。 */
export function hasMissingTaxRate(invoice: ManagementInvoiceRow): boolean {
  return invoice.items.some((item) => item.cancelled_at === null && item.tax_rate === null);
}

export interface InvoiceListRow {
  invoice: ManagementInvoiceRow;
  totalAmount: number;
  revenueMonths: RevenueMonthSummary;
  missingTaxRate: boolean;
  /** voidされていない発行データ（最大1件。Phase2Aの部分UNIQUE indexにより保証される）。 */
  activeDocument: InvoiceDocumentRow | null;
  /** activeDocument以外（void済み等）。issued_at降順。 */
  documentHistory: InvoiceDocumentRow[];
}

/**
 * /accounting/invoices向け。既存listInvoicesForMonth（clients/invoice_items/billing_rulesを
 * 1回のクエリで取得済み）の結果へ、invoice_documentsをinvoice_idのIN一括取得で結合する
 * （invoiceごとの個別queryによるN+1を避ける）。
 */
export async function listInvoicesWithDocumentsForMonth(
  supabase: TypedClient,
  billingMonthIso: string,
): Promise<InvoiceListRow[]> {
  const invoices = await listInvoicesForMonth(supabase, billingMonthIso);
  if (invoices.length === 0) return [];

  const invoiceIds = invoices.map((invoice) => invoice.id);
  const { data: documents, error } = await supabase
    .from("invoice_documents")
    .select("*")
    .in("invoice_id", invoiceIds)
    .order("issued_at", { ascending: false });
  if (error) throw error;

  const documentsByInvoiceId = new Map<string, InvoiceDocumentRow[]>();
  for (const doc of documents ?? []) {
    const list = documentsByInvoiceId.get(doc.invoice_id) ?? [];
    list.push(doc);
    documentsByInvoiceId.set(doc.invoice_id, list);
  }

  return invoices.map((invoice) => {
    const docs = documentsByInvoiceId.get(invoice.id) ?? [];
    const activeDocument = docs.find((doc) => doc.voided_at === null) ?? null;
    const documentHistory = docs.filter((doc) => doc.id !== activeDocument?.id);
    return {
      invoice,
      totalAmount: invoiceTotalAmount(invoice),
      revenueMonths: summarizeRevenueMonths(invoice),
      missingTaxRate: hasMissingTaxRate(invoice),
      activeDocument,
      documentHistory,
    };
  });
}
