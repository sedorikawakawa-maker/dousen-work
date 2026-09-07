import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

export async function getClientBillingProfile(supabase: TypedClient, clientId: string) {
  const { data, error } = await supabase
    .from("client_billing_profiles")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** 定期請求設定の一覧（billing_type='recurring'のみ）。金額変更は行を上書きせず、
 * valid_to/valid_fromで期間を分けた複数行として並ぶ想定。 */
export async function listRecurringBillingRulesForClient(supabase: TypedClient, clientId: string) {
  const { data, error } = await supabase
    .from("billing_rules")
    .select("*")
    .eq("client_id", clientId)
    .eq("billing_type", "recurring")
    .order("valid_from", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export interface UpcomingInvoiceItemRow {
  id: string;
  billing_month: string;
  revenue_month: string;
  subject: string;
  description: string | null;
  quantity: number;
  unit_price_ex_tax: number;
  tax_excluded_amount: number;
  amount_override: number | null;
  notes: string | null;
  invoices: { status: string } | null;
}

/** 今月以降（過去分は除く）の生成済みinvoice_itemsの簡易一覧。取消済みは含めない。 */
export async function listUpcomingInvoiceItemsForClient(
  supabase: TypedClient,
  clientId: string,
): Promise<UpcomingInvoiceItemRow[]> {
  const currentMonthIso = new Date().toISOString().slice(0, 7) + "-01";

  const { data, error } = await supabase
    .from("invoice_items")
    .select(
      "id, billing_month, revenue_month, subject, description, quantity, unit_price_ex_tax, tax_excluded_amount, amount_override, notes, invoices(status)",
    )
    .eq("client_id", clientId)
    .is("cancelled_at", null)
    .gte("billing_month", currentMonthIso)
    .order("billing_month", { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as UpcomingInvoiceItemRow[];
}
