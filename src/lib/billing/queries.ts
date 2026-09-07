import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingType, Database } from "@/lib/supabase/database.types";
import { addMonthsIso } from "@/lib/billing/generate";

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

// ---------------------------------------------------------------------------
// /management/revenue 向け
// ---------------------------------------------------------------------------

export interface RevenueItemRow {
  id: string;
  client_id: string;
  billing_rule_id: string | null;
  billing_month: string;
  revenue_month: string;
  quantity: number;
  unit_price_ex_tax: number;
  tax_excluded_amount: number;
  amount_override: number | null;
}

/**
 * revenue_month基準で範囲内（両端含む）の有効な（cancelled_at is null）invoice_itemsを
 * まとめて1回取得する。売上KPI・月別推移・顧客別売上はすべてこの結果を再利用し、
 * それぞれ別々にDBへ問い合わせない。
 */
export async function listInvoiceItemsByRevenueMonthRange(
  supabase: TypedClient,
  fromMonthIso: string,
  toMonthIso: string,
): Promise<RevenueItemRow[]> {
  const { data, error } = await supabase
    .from("invoice_items")
    .select("id, client_id, billing_rule_id, billing_month, revenue_month, quantity, unit_price_ex_tax, tax_excluded_amount, amount_override")
    .is("cancelled_at", null)
    .gte("revenue_month", fromMonthIso)
    .lte("revenue_month", toMonthIso);
  if (error) throw error;
  return data ?? [];
}

export interface BillingMonthItemRow {
  id: string;
  quantity: number;
  unit_price_ex_tax: number;
  tax_excluded_amount: number;
  amount_override: number | null;
  invoices: { status: Database["public"]["Tables"]["invoices"]["Row"]["status"] } | null;
}

/**
 * billing_month基準で対象月のみの有効なinvoice_itemsを取得する（invoice.statusを含む）。
 * 今月請求予定額・未送付額・送付済額はrevenue_month基準の範囲取得とは別軸のため、
 * 専用に1回だけ取得する（revenue_monthが範囲外に飛ぶone_timeの遠未来請求もここでは対象月の
 * billing_monthさえ一致すれば正しく含まれる）。
 */
export async function listInvoiceItemsByBillingMonth(
  supabase: TypedClient,
  billingMonthIso: string,
): Promise<BillingMonthItemRow[]> {
  const { data, error } = await supabase
    .from("invoice_items")
    .select("id, quantity, unit_price_ex_tax, tax_excluded_amount, amount_override, invoices(status)")
    .is("cancelled_at", null)
    .eq("billing_month", billingMonthIso);
  if (error) throw error;
  return (data ?? []) as unknown as BillingMonthItemRow[];
}

/** billing_rule_idの集合から、billing_typeだけをバッチで引く（顧客別/月別分類のための補助）。 */
async function getBillingTypesByRuleIds(supabase: TypedClient, ruleIds: string[]): Promise<Map<string, BillingType>> {
  if (ruleIds.length === 0) return new Map();
  const { data, error } = await supabase.from("billing_rules").select("id, billing_type").in("id", ruleIds);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.id, r.billing_type]));
}

/** invoice_itemsの正式金額。Phase 4と同じ定義（amount_override優先、なければtax_excluded_amount）を売上集計でも統一して使う。 */
function effectiveRevenueAmount(item: { amount_override: number | null; tax_excluded_amount: number }): number {
  return item.amount_override ?? item.tax_excluded_amount;
}

export interface RevenueMonthlyTrendRow {
  monthIso: string;
  total: number;
  recurring: number;
  oneTime: number;
  other: number;
}

export interface RevenueClientBreakdownRow {
  clientId: string;
  companyName: string;
  recurring: number;
  oneTime: number;
  other: number;
  total: number;
}

export interface RevenueDashboardData {
  targetMonthIso: string;
  totals: {
    thisMonthRevenue: number;
    recurringRevenue: number;
    oneTimeRevenue: number;
    otherRevenue: number;
    billingPlanned: number;
    unsent: number;
    sent: number;
    nextMonthRevenue: number;
  };
  monthlyTrend: RevenueMonthlyTrendRow[];
  clientBreakdown: RevenueClientBreakdownRow[];
}

/**
 * /management/revenue 向けの集計データを1回で組み立てる。
 * DB取得は「revenue_month範囲（対象月-5か月〜対象月+1か月）」と「billing_month=対象月」の
 * 2回＋関連マスタのバッチ取得のみで、KPI・月別推移・顧客別売上のすべてをJS側で計算する。
 */
export async function getRevenueDashboardData(
  supabase: TypedClient,
  targetMonthIso: string,
): Promise<RevenueDashboardData> {
  const rangeFrom = addMonthsIso(targetMonthIso, -5);
  const rangeTo = addMonthsIso(targetMonthIso, 1);
  const nextMonthIso = addMonthsIso(targetMonthIso, 1);

  const [revenueItems, billingMonthItems] = await Promise.all([
    listInvoiceItemsByRevenueMonthRange(supabase, rangeFrom, rangeTo),
    listInvoiceItemsByBillingMonth(supabase, targetMonthIso),
  ]);

  const ruleIds = [...new Set(revenueItems.map((i) => i.billing_rule_id).filter((id): id is string => id !== null))];
  const billingTypeByRuleId = await getBillingTypesByRuleIds(supabase, ruleIds);

  function categoryOf(item: RevenueItemRow): "recurring" | "one_time" | "other" {
    if (!item.billing_rule_id) return "other";
    const billingType = billingTypeByRuleId.get(item.billing_rule_id);
    if (billingType === "recurring") return "recurring";
    if (billingType === "one_time") return "one_time";
    return "other";
  }

  const thisMonthItems = revenueItems.filter((i) => i.revenue_month === targetMonthIso);
  const nextMonthRevenue = revenueItems
    .filter((i) => i.revenue_month === nextMonthIso)
    .reduce((sum, i) => sum + effectiveRevenueAmount(i), 0);

  let recurringRevenue = 0;
  let oneTimeRevenue = 0;
  let otherRevenue = 0;
  for (const item of thisMonthItems) {
    const amount = effectiveRevenueAmount(item);
    const category = categoryOf(item);
    if (category === "recurring") recurringRevenue += amount;
    else if (category === "one_time") oneTimeRevenue += amount;
    else otherRevenue += amount;
  }

  const billingPlanned = billingMonthItems.reduce((sum, i) => sum + effectiveRevenueAmount(i), 0);
  const unsent = billingMonthItems
    .filter((i) => i.invoices?.status !== "sent")
    .reduce((sum, i) => sum + effectiveRevenueAmount(i), 0);
  const sent = billingMonthItems
    .filter((i) => i.invoices?.status === "sent")
    .reduce((sum, i) => sum + effectiveRevenueAmount(i), 0);

  const trendMonths: string[] = [];
  for (let offset = -5; offset <= 0; offset += 1) {
    trendMonths.push(addMonthsIso(targetMonthIso, offset));
  }
  const monthlyTrend: RevenueMonthlyTrendRow[] = trendMonths.map((monthIso) => {
    const items = revenueItems.filter((i) => i.revenue_month === monthIso);
    let recurring = 0;
    let oneTime = 0;
    let other = 0;
    for (const item of items) {
      const amount = effectiveRevenueAmount(item);
      const category = categoryOf(item);
      if (category === "recurring") recurring += amount;
      else if (category === "one_time") oneTime += amount;
      else other += amount;
    }
    return { monthIso, total: recurring + oneTime + other, recurring, oneTime, other };
  });

  const clientIds = [...new Set(thisMonthItems.map((i) => i.client_id))];
  const { data: clients } =
    clientIds.length > 0
      ? await supabase.from("clients_view").select("id, company_name").in("id", clientIds)
      : { data: [] as { id: string; company_name: string }[] };
  const nameById = new Map((clients ?? []).map((c) => [c.id, c.company_name]));

  const byClient = new Map<string, { recurring: number; oneTime: number; other: number }>();
  for (const item of thisMonthItems) {
    const entry = byClient.get(item.client_id) ?? { recurring: 0, oneTime: 0, other: 0 };
    const amount = effectiveRevenueAmount(item);
    const category = categoryOf(item);
    if (category === "recurring") entry.recurring += amount;
    else if (category === "one_time") entry.oneTime += amount;
    else entry.other += amount;
    byClient.set(item.client_id, entry);
  }
  const clientBreakdown: RevenueClientBreakdownRow[] = [...byClient.entries()]
    .map(([clientId, v]) => ({
      clientId,
      companyName: nameById.get(clientId) ?? "不明な顧客",
      recurring: v.recurring,
      oneTime: v.oneTime,
      other: v.other,
      total: v.recurring + v.oneTime + v.other,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    targetMonthIso,
    totals: {
      thisMonthRevenue: recurringRevenue + oneTimeRevenue + otherRevenue,
      recurringRevenue,
      oneTimeRevenue,
      otherRevenue,
      billingPlanned,
      unsent,
      sent,
      nextMonthRevenue,
    },
    monthlyTrend,
    clientBreakdown,
  };
}
