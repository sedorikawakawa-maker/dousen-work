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

export interface ManagementInvoiceItemRow {
  id: string;
  billing_rule_id: string | null;
  billing_month: string;
  revenue_month: string;
  subject: string;
  description: string | null;
  quantity: number;
  unit_price_ex_tax: number;
  tax_excluded_amount: number;
  amount_override: number | null;
  notes: string | null;
  cancelled_at: string | null;
}

export interface ManagementInvoiceRow {
  id: string;
  client_id: string;
  clientCompanyName: string;
  billing_month: string;
  status: "planned" | "prepared" | "sent";
  billing_company_name_snapshot: string | null;
  billing_contact_name_snapshot: string | null;
  billing_email_snapshot: string | null;
  billing_cc_email_snapshot: string | null;
  billing_method_snapshot: string | null;
  billing_postal_address_snapshot: string | null;
  sent_at: string | null;
  sent_by_staff_id: string | null;
  notes: string | null;
  items: ManagementInvoiceItemRow[];
}

/**
 * /management/billing 向け：対象月の全顧客分のinvoice+invoice_itemsを取得する。
 * clientsテーブルは直接SELECT不可のため、顧客名だけclients_viewから別途取得して結合する
 * （PostgRESTのembedはFKを持つ実テーブル基準のため、viewへは効かせられない）。
 */
export async function listInvoicesForMonth(
  supabase: TypedClient,
  billingMonthIso: string,
): Promise<ManagementInvoiceRow[]> {
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("*, invoice_items(*)")
    .eq("billing_month", billingMonthIso);
  if (error) throw error;

  const rows = (invoices ?? []) as unknown as (Database["public"]["Tables"]["invoices"]["Row"] & {
    invoice_items: ManagementInvoiceItemRow[];
  })[];

  const clientIds = [...new Set(rows.map((r) => r.client_id))];
  const { data: clients } =
    clientIds.length > 0
      ? await supabase.from("clients_view").select("id, company_name").in("id", clientIds)
      : { data: [] as { id: string; company_name: string }[] };
  const nameById = new Map((clients ?? []).map((c) => [c.id, c.company_name]));

  return rows
    .map((r) => ({
      id: r.id,
      client_id: r.client_id,
      clientCompanyName: nameById.get(r.client_id) ?? "不明な顧客",
      billing_month: r.billing_month,
      status: r.status,
      billing_company_name_snapshot: r.billing_company_name_snapshot,
      billing_contact_name_snapshot: r.billing_contact_name_snapshot,
      billing_email_snapshot: r.billing_email_snapshot,
      billing_cc_email_snapshot: r.billing_cc_email_snapshot,
      billing_method_snapshot: r.billing_method_snapshot,
      billing_postal_address_snapshot: r.billing_postal_address_snapshot,
      sent_at: r.sent_at,
      sent_by_staff_id: r.sent_by_staff_id,
      notes: r.notes,
      items: r.invoice_items ?? [],
    }))
    .sort((a, b) => a.clientCompanyName.localeCompare(b.clientCompanyName, "ja"));
}
