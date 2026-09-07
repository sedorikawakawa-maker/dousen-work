import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { rollingWindowMonths } from "@/lib/scheduling/generate";

type TypedClient = SupabaseClient<Database>;
type BillingRuleRow = Database["public"]["Tables"]["billing_rules"]["Row"];
type ClientBillingProfileRow = Database["public"]["Tables"]["client_billing_profiles"]["Row"];

/** 'YYYY-MM' や 'YYYY-MM-DD' の先頭7文字から、月初日('YYYY-MM-01')を作る。 */
export function truncateToMonthIso(dateIso: string): string {
  return dateIso.slice(0, 7) + "-01";
}

/** <input type="month">の値('YYYY-MM')を、DB保存用の月初日('YYYY-MM-01')へ変換する。不正な形式はnull。 */
export function monthInputToIso(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(text)) return null;
  return `${text}-01`;
}

function monthToIso(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}-01`;
}

/** JST（UTC+9固定）での「現在月」の月初日。/management/billingの初期表示月に使う。 */
export function currentMonthIsoJst(): string {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return monthToIso(jstNow.getUTCFullYear(), jstNow.getUTCMonth());
}

/** 'YYYY-MM-DD'（月初日）を'YYYY年M月'として表示する。日はユーザーに意識させない。 */
export function formatMonthLabel(monthIso: string | null): string {
  if (!monthIso) return "未設定";
  const [y, m] = monthIso.split("-");
  return `${y}年${Number(m)}月`;
}

/** 月初日文字列に対して、タイムゾーンに依存しない整数演算だけで月を加減する。 */
export function addMonthsIso(monthIso: string, delta: number): string {
  const [y, m] = monthIso.split("-").map(Number);
  const totalMonths = y * 12 + (m - 1) + delta;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth0 = ((totalMonths % 12) + 12) % 12;
  return `${newYear}-${String(newMonth0 + 1).padStart(2, "0")}-01`;
}

/** quantity(numeric、小数もあり得る) × unit_price_ex_taxを、浮動小数の誤差を丸めて計算する。 */
export function computeTaxExcludedAmount(quantity: number, unitPriceExTax: number): number {
  return Math.round(quantity * unitPriceExTax * 100) / 100;
}

/** revenue_month_offset_monthsの技術名を画面へ出さないための表示ラベル。候補は-1/0/1のみ。 */
export const REVENUE_MONTH_OFFSET_OPTIONS = [
  { value: -1, label: "1か月前" },
  { value: 0, label: "請求月と同じ" },
  { value: 1, label: "1か月後" },
] as const;

async function getClientBillingContext(supabase: TypedClient, clientId: string) {
  const [{ data: profile }, { data: clientRow }] = await Promise.all([
    supabase.from("client_billing_profiles").select("*").eq("client_id", clientId).maybeSingle(),
    supabase.from("clients_view").select("company_name, contract_end_date").eq("id", clientId).maybeSingle(),
  ]);
  return { profile, clientRow };
}

/**
 * client_id + billing_monthで1件のinvoiceを取得し、無ければclient_billing_profilesの
 * 請求先情報をスナップショットして新規作成する（find-or-create、resolveClientFolder等と同じ思想）。
 */
interface InvoiceRef {
  id: string;
  status: Database["public"]["Tables"]["invoices"]["Row"]["status"];
}

async function getOrCreateInvoice(
  supabase: TypedClient,
  clientId: string,
  billingMonth: string,
  profile: ClientBillingProfileRow | null,
  companyNameFallback: string,
): Promise<InvoiceRef> {
  const { data: existing } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("client_id", clientId)
    .eq("billing_month", billingMonth)
    .maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("invoices")
    .insert({
      client_id: clientId,
      billing_month: billingMonth,
      billing_company_name_snapshot: profile?.billing_company_name ?? companyNameFallback,
      billing_contact_name_snapshot: profile?.billing_contact_name ?? null,
      billing_email_snapshot: profile?.billing_email ?? null,
      billing_cc_email_snapshot: profile?.billing_cc_email ?? null,
      billing_method_snapshot: profile?.billing_method ?? null,
      billing_postal_address_snapshot: profile?.billing_postal_address ?? null,
      notes: null,
      sent_at: null,
      sent_by_staff_id: null,
    })
    .select("id, status")
    .single();

  if (error) {
    if (error.code === "23505") {
      // 競合で他の呼び出しが先に作成した場合、それを再取得して使う。
      const { data: raceExisting } = await supabase
        .from("invoices")
        .select("id, status")
        .eq("client_id", clientId)
        .eq("billing_month", billingMonth)
        .single();
      if (raceExisting) return raceExisting;
    }
    throw error;
  }
  return created;
}

async function insertInvoiceItemIfMissing(
  supabase: TypedClient,
  input: {
    invoice: InvoiceRef;
    clientId: string;
    billingRuleId: string;
    billingMonth: string;
    revenueMonth: string;
    subject: string;
    description: string | null;
    quantity: number;
    unitPriceExTax: number;
    notes: string | null;
  },
): Promise<boolean> {
  // prepared/sentのinvoiceには、既存invoice_itemsだけでなく新規追加も一切行わない
  // （自動生成・rule変更処理が確定済み請求書を静かに変えてしまうことを防ぐ）。
  if (input.invoice.status !== "planned") return false;

  const { data: existing } = await supabase
    .from("invoice_items")
    .select("id")
    .eq("billing_rule_id", input.billingRuleId)
    .eq("billing_month", input.billingMonth)
    .is("cancelled_at", null)
    .maybeSingle();
  if (existing) return false;

  const { error } = await supabase.from("invoice_items").insert({
    invoice_id: input.invoice.id,
    client_id: input.clientId,
    billing_rule_id: input.billingRuleId,
    billing_month: input.billingMonth,
    revenue_month: input.revenueMonth,
    subject: input.subject,
    description: input.description,
    quantity: input.quantity,
    unit_price_ex_tax: input.unitPriceExTax,
    tax_excluded_amount: computeTaxExcludedAmount(input.quantity, input.unitPriceExTax),
    amount_override: null,
    notes: input.notes,
    cancelled_at: null,
    cancelled_by_staff_id: null,
    cancel_reason: null,
  });

  if (error) {
    if (error.code === "23505") return false;
    throw error;
  }
  return true;
}

/**
 * recurring ruleについて、現在月+2か月先までのローリング窓で不足しているinvoice/invoice_itemsを
 * 生成する（posting_schedule_rules -> production_tasksのgenerateTasksForRuleと同じ「不足分だけ
 * 生成」方式。DB側のunique制約が二重生成の最終防衛線）。
 * is_active=false、client.invoice_required=false、valid_from/valid_to/contract_end_dateの
 * 範囲外の月はスキップする。
 */
export async function generateInvoiceItemsForRecurringRule(
  supabase: TypedClient,
  rule: BillingRuleRow,
): Promise<number> {
  if (rule.billing_type !== "recurring" || !rule.is_active || !rule.valid_from) return 0;

  const { profile, clientRow } = await getClientBillingContext(supabase, rule.client_id);
  if (!clientRow) return 0;
  if (profile && profile.invoice_required === false) return 0;

  const contractEndMonthIso = clientRow.contract_end_date ? truncateToMonthIso(clientRow.contract_end_date) : null;

  let insertedCount = 0;
  for (const { year, month0 } of rollingWindowMonths()) {
    const billingMonth = monthToIso(year, month0);
    if (billingMonth < rule.valid_from) continue;
    if (rule.valid_to && billingMonth > rule.valid_to) continue;
    if (contractEndMonthIso && billingMonth > contractEndMonthIso) continue;

    const revenueMonth = addMonthsIso(billingMonth, rule.revenue_month_offset_months);
    const invoice = await getOrCreateInvoice(supabase, rule.client_id, billingMonth, profile, clientRow.company_name);
    const inserted = await insertInvoiceItemIfMissing(supabase, {
      invoice,
      clientId: rule.client_id,
      billingRuleId: rule.id,
      billingMonth,
      revenueMonth,
      subject: rule.subject,
      description: rule.description,
      quantity: rule.quantity,
      unitPriceExTax: rule.unit_price_ex_tax,
      notes: rule.notes,
    });
    if (inserted) insertedCount += 1;
  }
  return insertedCount;
}

/**
 * 全クライアントの有効な定期ruleについて、現在月+2か月のローリング窓の不足分だけを
 * まとめて補完する（/management/billing表示時に1回だけ呼ばれる想定）。
 * 呼び出し対象はis_active=trueのrecurring ruleのみ。invoice_required=false・
 * valid_from/valid_to範囲外・contract_end_date超過・prepared/sent invoiceは
 * generateInvoiceItemsForRecurringRule内部のガードでそれぞれスキップされる。
 */
export async function ensureBillingRollingWindowForAllClients(
  supabase: TypedClient,
): Promise<{ rulesProcessed: number; itemsGenerated: number }> {
  const { data: rules, error } = await supabase
    .from("billing_rules")
    .select("*")
    .eq("billing_type", "recurring")
    .eq("is_active", true);
  if (error) throw error;
  if (!rules || rules.length === 0) return { rulesProcessed: 0, itemsGenerated: 0 };

  let itemsGenerated = 0;
  for (const rule of rules) {
    itemsGenerated += await generateInvoiceItemsForRecurringRule(supabase, rule);
  }
  return { rulesProcessed: rules.length, itemsGenerated };
}

export interface OneTimeGenerationResult {
  skipped: boolean;
  reason?: "invoice_required_false" | "client_not_found" | "after_contract_end" | "invoice_locked";
}

/**
 * one_time ruleは現在月+2か月のローリング窓に制限せず、指定された請求月をその場で即時生成する。
 */
export async function generateInvoiceItemForOneTimeRule(
  supabase: TypedClient,
  rule: BillingRuleRow,
): Promise<OneTimeGenerationResult> {
  if (rule.billing_type !== "one_time" || !rule.one_time_billing_month || !rule.one_time_revenue_month) {
    return { skipped: true };
  }

  const { profile, clientRow } = await getClientBillingContext(supabase, rule.client_id);
  if (!clientRow) return { skipped: true, reason: "client_not_found" };
  if (profile && profile.invoice_required === false) return { skipped: true, reason: "invoice_required_false" };

  const contractEndMonthIso = clientRow.contract_end_date ? truncateToMonthIso(clientRow.contract_end_date) : null;
  if (contractEndMonthIso && rule.one_time_billing_month > contractEndMonthIso) {
    return { skipped: true, reason: "after_contract_end" };
  }

  const invoice = await getOrCreateInvoice(
    supabase,
    rule.client_id,
    rule.one_time_billing_month,
    profile,
    clientRow.company_name,
  );
  if (invoice.status !== "planned") {
    return { skipped: true, reason: "invoice_locked" };
  }
  await insertInvoiceItemIfMissing(supabase, {
    invoice,
    clientId: rule.client_id,
    billingRuleId: rule.id,
    billingMonth: rule.one_time_billing_month,
    revenueMonth: rule.one_time_revenue_month,
    subject: rule.subject,
    description: rule.description,
    quantity: rule.quantity,
    unitPriceExTax: rule.unit_price_ex_tax,
    notes: rule.notes,
  });

  return { skipped: false };
}

/**
 * 指定ruleの、fromMonthIso以降・未取消・invoice.status='planned'のinvoice_itemsのIDだけを
 * 安全に抽出する（sent/preparedのinvoiceに属するものは対象外。過去実績には一切触れない）。
 */
async function findCancellableInvoiceItemIds(
  supabase: TypedClient,
  ruleId: string,
  fromMonthIso: string,
): Promise<string[]> {
  const { data: items } = await supabase
    .from("invoice_items")
    .select("id, invoice_id")
    .eq("billing_rule_id", ruleId)
    .is("cancelled_at", null)
    .gte("billing_month", fromMonthIso);
  if (!items || items.length === 0) return [];

  const invoiceIds = [...new Set(items.map((i) => i.invoice_id))];
  const { data: invoices } = await supabase.from("invoices").select("id, status").in("id", invoiceIds);
  const plannedInvoiceIds = new Set((invoices ?? []).filter((inv) => inv.status === "planned").map((inv) => inv.id));

  return items.filter((i) => plannedInvoiceIds.has(i.invoice_id)).map((i) => i.id);
}

/**
 * 対象のinvoice_itemsを、既存のcancel_invoice_item RPC（Phase 1実装、actorはRPC内部で
 * current_staff_id()から解決される）で1件ずつ取消する。DELETEは一切行わない。
 */
async function cancelInvoiceItems(supabase: TypedClient, itemIds: string[], reason: string): Promise<void> {
  for (const itemId of itemIds) {
    await supabase.rpc("cancel_invoice_item", { p_invoice_item_id: itemId, p_reason: reason });
  }
}

export interface RecurringRuleInput {
  subject: string;
  description: string | null;
  quantity: number;
  unitPriceExTax: number;
  notes: string | null;
}

/**
 * 「この月から内容を変更」操作の実体。既存ruleを上書きせず、
 *  1. 旧ruleのvalid_toを変更開始月の前月末（=前月の月初日）に設定して終了させる
 *  2. 新ruleを変更開始月からvalid_from、新しい内容で作成する
 *  3. 旧rule由来・変更開始月以降・planned状態のinvoice_itemsだけを取消する
 *  4. 新ruleから該当月分を再生成する
 * を行う。過去に生成済みのinvoice_items、および既にprepared/sentのinvoiceには一切触れない。
 */
export async function splitAndReplaceRecurringBillingRule(
  supabase: TypedClient,
  oldRule: BillingRuleRow,
  changeFromMonthIso: string,
  newValues: RecurringRuleInput,
  createdByStaffId: string,
): Promise<{ error: string | null }> {
  const oldValidTo = addMonthsIso(changeFromMonthIso, -1);

  const { error: closeError } = await supabase
    .from("billing_rules")
    .update({ valid_to: oldValidTo })
    .eq("id", oldRule.id);
  if (closeError) return { error: closeError.message };

  const { data: newRule, error: insertError } = await supabase
    .from("billing_rules")
    .insert({
      client_id: oldRule.client_id,
      billing_type: "recurring",
      subject: newValues.subject,
      description: newValues.description,
      quantity: newValues.quantity,
      unit_price_ex_tax: newValues.unitPriceExTax,
      notes: newValues.notes,
      valid_from: changeFromMonthIso,
      valid_to: null,
      one_time_billing_month: null,
      one_time_revenue_month: null,
      revenue_month_offset_months: oldRule.revenue_month_offset_months,
      is_active: true,
      created_by_staff_id: createdByStaffId,
    })
    .select("*")
    .single();
  if (insertError || !newRule) return { error: insertError?.message ?? "変更後ルールの作成に失敗しました" };

  const cancellableIds = await findCancellableInvoiceItemIds(supabase, oldRule.id, changeFromMonthIso);
  if (cancellableIds.length > 0) {
    await cancelInvoiceItems(supabase, cancellableIds, "請求内容の変更に伴う再生成のため取消");
  }

  await generateInvoiceItemsForRecurringRule(supabase, newRule);

  return { error: null };
}

/**
 * ルール停止。is_active=falseにし、今日の月以降・未取消・planned状態のinvoice_itemsだけを
 * 取消する（過去実績・prepared/sentには一切触れない）。
 */
export async function deactivateRecurringBillingRule(
  supabase: TypedClient,
  ruleId: string,
): Promise<{ error: string | null }> {
  const { data: rule, error: fetchError } = await supabase
    .from("billing_rules")
    .select("valid_from")
    .eq("id", ruleId)
    .single();
  if (fetchError || !rule) return { error: fetchError?.message ?? "対象の請求設定が見つかりません" };

  const now = new Date();
  const currentMonthIso = monthToIso(now.getUTCFullYear(), now.getUTCMonth());
  // valid_toはvalid_from以上でなければならない(billing_rules_valid_range制約)。
  // 開始した当月中（またはvalid_fromが未来）に停止した場合は前月末にできないため、
  // その場合はvalid_from自体を終了月とする（is_active=falseが生成を止める本体のガードのため、
  // この場合のvalid_toの厳密な値そのものに実害はない）。
  const desiredValidTo = addMonthsIso(currentMonthIso, -1);
  const newValidTo = rule.valid_from && desiredValidTo < rule.valid_from ? rule.valid_from : desiredValidTo;

  const { error } = await supabase
    .from("billing_rules")
    .update({ is_active: false, valid_to: newValidTo })
    .eq("id", ruleId);
  if (error) return { error: error.message };

  const cancellableIds = await findCancellableInvoiceItemIds(supabase, ruleId, currentMonthIso);
  if (cancellableIds.length > 0) {
    await cancelInvoiceItems(supabase, cancellableIds, "請求設定の停止に伴う取消");
  }

  return { error: null };
}
