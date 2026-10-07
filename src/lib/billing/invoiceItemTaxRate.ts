import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

// invoice_itemsは作成後immutable設計（tax_rateもPhase2Aでenforce_invoice_items_cancel_only_update
// トリガーの対象に含めたため、直接UPDATEできない）。そのため「人間が税率を選択して確定する」操作は、
// Phase2D hardeningで追加したset_invoice_item_tax_rate RPC（旧明細の取消＋新明細の作成を
// 1トランザクションで原子的に行う）を1回呼ぶだけで実現する。cancel_invoice_item RPCと直接INSERTの
// 2リクエストに分けていた以前の実装は廃止した（途中失敗時に半端な状態が残る可能性があったため）。
// 税率そのものは常に人間が選択した値のみを使い、システムが自動判定しない。

export const INVOICE_ITEM_TAX_RATE_OPTIONS = [
  { value: 0.1, label: "10%" },
  { value: 0.08, label: "8%" },
  { value: 0, label: "0%（非課税/対象外）" },
] as const;

export function isValidInvoiceItemTaxRate(value: number): boolean {
  return INVOICE_ITEM_TAX_RATE_OPTIONS.some((option) => option.value === value);
}

export interface SetInvoiceItemTaxRateResult {
  error: string | null;
  newInvoiceItemId?: string;
}

/**
 * set_invoice_item_tax_rate RPCを1回呼ぶだけ（UI層でのcancel+insertの組み立ては行わない）。
 * RPC内で、権限確認・行ロック・未取消確認・invoice状態確認（planned かつ generatedな
 * 有効発行データが無いこと）・旧明細の取消・新明細の作成までが1トランザクションで原子的に
 * 実行される。途中で失敗した場合は旧明細も取消されず、新明細も作られない。
 */
export async function setInvoiceItemTaxRate(
  supabase: TypedClient,
  invoiceItemId: string,
  taxRate: number,
  taxCategory: string | null = null,
): Promise<SetInvoiceItemTaxRateResult> {
  if (!isValidInvoiceItemTaxRate(taxRate)) {
    return { error: "税率の指定が不正です。" };
  }

  const { data, error } = await supabase.rpc("set_invoice_item_tax_rate", {
    p_invoice_item_id: invoiceItemId,
    p_tax_rate: taxRate,
    p_tax_category: taxCategory,
  });

  if (error) return { error: error.message };
  return { error: null, newInvoiceItemId: data ?? undefined };
}
