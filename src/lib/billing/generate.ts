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
 *
 * invoice_title（件名）は請求書1件につき1つのため、同じ請求月へ複数回・複数のruleから
 * 摘要が追加され得ることを踏まえて次のルールで扱う（invoiceの件名を黙って上書きしない）:
 *   - invoiceを新規作成する場合: 渡された件名をそのまま設定する。
 *   - 既存invoiceの件名が未設定(null)の場合: 渡された件名で補完する（上書きではなく穴埋め）。
 *   - 既存invoiceに件名が設定済みで、渡された件名と異なる場合: 変更せず「競合」を呼び出し元へ返す
 *     （呼び出し元はこれを見て明細生成をスキップし、分かるメッセージを返す）。
 *   - 渡された件名が同じ、またはnullの場合: 競合なし。
 */
interface InvoiceRef {
  id: string;
  status: Database["public"]["Tables"]["invoices"]["Row"]["status"];
}

interface GetOrCreateInvoiceResult {
  invoice: InvoiceRef;
  titleConflict: boolean;
  conflictingTitle?: string | null;
}

async function getOrCreateInvoice(
  supabase: TypedClient,
  clientId: string,
  billingMonth: string,
  profile: ClientBillingProfileRow | null,
  companyNameFallback: string,
  invoiceTitle: string | null,
): Promise<GetOrCreateInvoiceResult> {
  const { data: existing } = await supabase
    .from("invoices")
    .select("id, status, invoice_title")
    .eq("client_id", clientId)
    .eq("billing_month", billingMonth)
    .maybeSingle();

  if (existing) {
    if (invoiceTitle && existing.invoice_title && existing.invoice_title !== invoiceTitle) {
      return {
        invoice: { id: existing.id, status: existing.status },
        titleConflict: true,
        conflictingTitle: existing.invoice_title,
      };
    }
    if (invoiceTitle && !existing.invoice_title) {
      const { error: fillError } = await supabase
        .from("invoices")
        .update({ invoice_title: invoiceTitle })
        .eq("id", existing.id);
      if (fillError) throw fillError;
    }
    return { invoice: { id: existing.id, status: existing.status }, titleConflict: false };
  }

  const { data: created, error } = await supabase
    .from("invoices")
    .insert({
      client_id: clientId,
      billing_month: billingMonth,
      invoice_title: invoiceTitle,
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
        .select("id, status, invoice_title")
        .eq("client_id", clientId)
        .eq("billing_month", billingMonth)
        .single();
      if (raceExisting) {
        if (invoiceTitle && raceExisting.invoice_title && raceExisting.invoice_title !== invoiceTitle) {
          return {
            invoice: { id: raceExisting.id, status: raceExisting.status },
            titleConflict: true,
            conflictingTitle: raceExisting.invoice_title,
          };
        }
        return { invoice: { id: raceExisting.id, status: raceExisting.status }, titleConflict: false };
      }
    }
    throw error;
  }
  return { invoice: created, titleConflict: false };
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
export interface RecurringGenerationSummary {
  insertedCount: number;
  /** 件名の競合により明細生成をスキップした月（'YYYY-MM-01'）の一覧。rule自体は保存されたまま。 */
  titleConflictMonths: string[];
}

export async function generateInvoiceItemsForRecurringRule(
  supabase: TypedClient,
  rule: BillingRuleRow,
): Promise<RecurringGenerationSummary> {
  const empty: RecurringGenerationSummary = { insertedCount: 0, titleConflictMonths: [] };
  if (rule.billing_type !== "recurring" || !rule.is_active || !rule.valid_from) return empty;

  const { profile, clientRow } = await getClientBillingContext(supabase, rule.client_id);
  if (!clientRow) return empty;
  if (profile && profile.invoice_required === false) return empty;

  const contractEndMonthIso = clientRow.contract_end_date ? truncateToMonthIso(clientRow.contract_end_date) : null;

  let insertedCount = 0;
  const titleConflictMonths: string[] = [];
  for (const { year, month0 } of rollingWindowMonths()) {
    const billingMonth = monthToIso(year, month0);
    if (billingMonth < rule.valid_from) continue;
    if (rule.valid_to && billingMonth > rule.valid_to) continue;
    if (contractEndMonthIso && billingMonth > contractEndMonthIso) continue;

    const revenueMonth = addMonthsIso(billingMonth, rule.revenue_month_offset_months);
    const { invoice, titleConflict } = await getOrCreateInvoice(
      supabase,
      rule.client_id,
      billingMonth,
      profile,
      clientRow.company_name,
      rule.invoice_title,
    );
    if (titleConflict) {
      titleConflictMonths.push(billingMonth);
      continue;
    }
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
  return { insertedCount, titleConflictMonths };
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
    const summary = await generateInvoiceItemsForRecurringRule(supabase, rule);
    itemsGenerated += summary.insertedCount;
  }
  return { rulesProcessed: rules.length, itemsGenerated };
}

export interface OneTimeGenerationResult {
  skipped: boolean;
  reason?: "invoice_required_false" | "client_not_found" | "after_contract_end" | "invoice_locked" | "title_conflict";
  conflictingTitle?: string | null;
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

  const { invoice, titleConflict, conflictingTitle } = await getOrCreateInvoice(
    supabase,
    rule.client_id,
    rule.one_time_billing_month,
    profile,
    clientRow.company_name,
    rule.invoice_title,
  );
  if (titleConflict) {
    return { skipped: true, reason: "title_conflict", conflictingTitle };
  }
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
  /** 省略時は旧ruleの件名をそのまま引き継ぐ（「何も指定しなければ現在の件名を継承」）。 */
  invoiceTitle?: string | null;
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
      invoice_title: newValues.invoiceTitle !== undefined ? newValues.invoiceTitle : oldRule.invoice_title,
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

// ---------------------------------------------------------------------------
// スポット請求（one_time）の新規登録。クライアント詳細画面と/management/billingの
// どちらから登録しても、同じbilling_rule/invoice/invoice_item生成経路（このファイルの
// createOneTimeBillingRule）だけを通す。activity_logsはbilling_rules/invoice_itemsの
// 既存トリガーが自動記録するため、呼び出し元での重複記録は不要。
// ---------------------------------------------------------------------------

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

export interface OneTimeBillingFormFields {
  clientId: string;
  /** 請求書全体の件名（invoices.invoice_title / billing_rules.invoice_title）。摘要(subject)とは別概念。 */
  invoiceTitle: string;
  subject: string;
  description: string | null;
  quantity: number;
  unitPriceExTax: number;
  billingMonthIso: string;
  revenueMonthIso: string;
  notes: string | null;
}

export interface ParseOneTimeBillingFormDataOptions {
  /** falseの場合、売上計上月が未入力なら請求月と同じ扱いにする（クライアント詳細画面の既存仕様）。 */
  requireRevenueMonth?: boolean;
  /**
   * trueの場合、金額(単価)が0円ちょうども不正とする。falseの場合は既存のクライアント詳細画面と
   * 同じ「0円以上」を許容する（既存スポット請求登録の挙動を変えないためのデフォルト）。
   */
  disallowZeroAmount?: boolean;
}

/**
 * スポット請求登録フォームの共通バリデーション。クライアント詳細画面・/management/billingの
 * 両方のServer Actionから呼び出し、入力チェックの実装を1本化する。
 */
export function parseOneTimeBillingFormData(
  formData: FormData,
  clientId: string,
  options: ParseOneTimeBillingFormDataOptions = {},
): { fields: OneTimeBillingFormFields | null; error: string | null } {
  if (!clientId) {
    return { fields: null, error: "顧客を選択してください。" };
  }

  const invoiceTitle = String(formData.get("invoiceTitle") ?? "").trim();
  if (!invoiceTitle) {
    return { fields: null, error: "件名を入力してください。" };
  }

  const subject = String(formData.get("subject") ?? "").trim();
  if (!subject) {
    return { fields: null, error: "摘要を入力してください。" };
  }

  const quantity = Number(formData.get("quantity") ?? "1");
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { fields: null, error: "数量は0より大きい数値で入力してください。" };
  }

  const unitPriceExTax = Number(formData.get("unitPriceExTax") ?? "");
  if (!Number.isFinite(unitPriceExTax) || unitPriceExTax < 0 || (options.disallowZeroAmount && unitPriceExTax === 0)) {
    return {
      fields: null,
      error: options.disallowZeroAmount
        ? "金額は0円より大きい数値で入力してください。"
        : "単価は0以上の数値で入力してください。",
    };
  }

  const billingMonthIso = monthInputToIso(formData.get("billingMonth") as string | null);
  if (!billingMonthIso) {
    return { fields: null, error: "請求月を入力してください。" };
  }

  const revenueMonthRaw = emptyToNull(formData.get("revenueMonth") as string | null);
  const revenueMonthIso = revenueMonthRaw ? monthInputToIso(revenueMonthRaw) : null;
  if (revenueMonthRaw && !revenueMonthIso) {
    return { fields: null, error: "売上計上月の形式が不正です。" };
  }
  if (options.requireRevenueMonth && !revenueMonthIso) {
    return { fields: null, error: "売上計上月を入力してください。" };
  }

  return {
    fields: {
      clientId,
      invoiceTitle,
      subject,
      description: emptyToNull(formData.get("description") as string | null),
      quantity,
      unitPriceExTax,
      billingMonthIso,
      revenueMonthIso: revenueMonthIso ?? billingMonthIso,
      notes: emptyToNull(formData.get("notes") as string | null),
    },
    error: null,
  };
}

export interface CreateOneTimeBillingRuleResult {
  error: string | null;
  ruleId?: string;
}

/**
 * スポット請求（one_time billing_rule）の新規作成＋即時のinvoice/invoice_item生成。
 * INSERT自体はこの関数だけが行う（呼び出し元でbilling_rulesへの重複INSERT実装をしない）。
 *
 * 件名(invoice_title)が同じ請求月の既存invoiceと競合する場合（既に別の件名が設定済み）は、
 * 「登録を止めてエラーを返す」仕様（黙って上書きしない）のため、直前に作成したrule自体を
 * 既存のcancel_one_time_billing_rule RPCで自動取消してから失敗として返す
 * （ruleId無しのerrorとして返すことで、呼び出し元executeBillingRegistrationの既存の
 * 「ruleIdが無ければ失敗」判定にそのまま乗せる。新しい分岐を追加しない）。
 */
export async function createOneTimeBillingRule(
  supabase: TypedClient,
  input: OneTimeBillingFormFields,
  createdByStaffId: string,
): Promise<CreateOneTimeBillingRuleResult> {
  const { data: newRule, error } = await supabase
    .from("billing_rules")
    .insert({
      client_id: input.clientId,
      billing_type: "one_time",
      subject: input.subject,
      description: input.description,
      invoice_title: input.invoiceTitle,
      quantity: input.quantity,
      unit_price_ex_tax: input.unitPriceExTax,
      notes: input.notes,
      revenue_month_offset_months: 0,
      valid_from: null,
      valid_to: null,
      one_time_billing_month: input.billingMonthIso,
      one_time_revenue_month: input.revenueMonthIso,
      is_active: true,
      created_by_staff_id: createdByStaffId,
    })
    .select("*")
    .single();

  if (error || !newRule) {
    return { error: error?.message ?? "登録に失敗しました" };
  }

  const result = await generateInvoiceItemForOneTimeRule(supabase, newRule);
  if (result.skipped) {
    if (result.reason === "title_conflict") {
      await supabase.rpc("cancel_one_time_billing_rule", {
        p_billing_rule_id: newRule.id,
        p_reason: "請求月の件名競合のため自動取消",
      });
      return {
        error: `この請求月には既に別の件名（${result.conflictingTitle}）が設定されているため登録できません。`,
      };
    }
    const reasonMessage =
      result.reason === "invoice_required_false"
        ? "この顧客は請求書送付不要のため、明細は生成されませんでした（設定は保存済みです）。"
        : result.reason === "after_contract_end"
          ? "契約終了予定日より後の月のため、明細は生成されませんでした（設定は保存済みです）。"
          : result.reason === "invoice_locked"
            ? "対象月の請求書は既に作成済み/送付済みのため、明細は生成されませんでした（設定は保存済みです）。"
            : "明細の生成に失敗しました（設定は保存済みです）。";
    return { error: reasonMessage, ruleId: newRule.id };
  }

  return { error: null, ruleId: newRule.id };
}

// ---------------------------------------------------------------------------
// 定期請求（recurring）の新規登録。クライアント詳細画面の既存フォームと
// /management/billingの複数摘要登録フォームの両方が、この関数だけを通す。
// ---------------------------------------------------------------------------

export interface RecurringBillingFormFields {
  clientId: string;
  /** 請求書全体の件名（invoices.invoice_title / billing_rules.invoice_title）。摘要(subject)とは別概念。
   * 将来ローリング窓で生成されるinvoiceへも、このruleに保存された値がそのまま引き継がれる。 */
  invoiceTitle: string;
  subject: string;
  description: string | null;
  quantity: number;
  unitPriceExTax: number;
  validFromIso: string;
  validToIso: string | null;
  revenueMonthOffsetMonths: number;
  notes: string | null;
}

export interface CreateRecurringBillingRuleResult {
  error: string | null;
  ruleId?: string;
  /** ruleは保存されたが、一部の月で件名競合により明細生成がスキップされた場合の警告（致命的ではない）。 */
  warning?: string;
}

/**
 * 定期請求（recurring billing_rule）の新規作成＋現在月+2か月ローリング窓分の即時生成。
 * INSERT自体はこの関数だけが行う（既存clients/[id]のcreateRecurringBillingRuleActionも
 * この関数を呼ぶだけにし、重複INSERT実装を持たない）。
 *
 * 件名競合はスポットと異なりrule自体を取消さない（1つのruleが複数月のinvoiceに関わるため、
 * ある月だけ競合してもrule全体を無効化するのは過剰）。競合した月は明細生成のみスキップし、
 * 警告としてwarningへ返す（既存の他のskip理由と同じ「ruleは保存済み」の扱い）。
 */
export async function createRecurringBillingRule(
  supabase: TypedClient,
  input: RecurringBillingFormFields,
  createdByStaffId: string,
): Promise<CreateRecurringBillingRuleResult> {
  const { data: newRule, error } = await supabase
    .from("billing_rules")
    .insert({
      client_id: input.clientId,
      billing_type: "recurring",
      subject: input.subject,
      description: input.description,
      invoice_title: input.invoiceTitle,
      quantity: input.quantity,
      unit_price_ex_tax: input.unitPriceExTax,
      notes: input.notes,
      valid_from: input.validFromIso,
      valid_to: input.validToIso,
      revenue_month_offset_months: input.revenueMonthOffsetMonths,
      one_time_billing_month: null,
      one_time_revenue_month: null,
      is_active: true,
      created_by_staff_id: createdByStaffId,
    })
    .select("*")
    .single();

  if (error || !newRule) {
    return { error: error?.message ?? "登録に失敗しました" };
  }

  const summary = await generateInvoiceItemsForRecurringRule(supabase, newRule);
  const warning =
    summary.titleConflictMonths.length > 0
      ? `一部の月（${summary.titleConflictMonths.map((m) => formatMonthLabel(m)).join("、")}）には既に別の件名が設定されているため、その月の明細は生成されませんでした（設定は保存済みです）。`
      : undefined;

  return { error: null, ruleId: newRule.id, warning };
}

// ---------------------------------------------------------------------------
// /management/billing の「＋ 請求を登録」：スポット/定期・複数摘要を1フォームで登録する。
// 生成ロジック自体は上のcreateOneTimeBillingRule / createRecurringBillingRuleを
// 摘要ごとに繰り返し呼ぶだけで、新しい生成処理は作らない。
// 途中の摘要でDB書き込み自体が失敗した場合は、既存のcancel_one_time_billing_rule /
// deactivateRecurringBillingRule（いずれも既存の「取消して履歴を残す」機構）を使って
// それまでに作成済みの摘要を自動的に取消し、半端な状態が見えないようにする
// （新規RPC・新規migrationは追加せず、既存の取消経路だけで補償する）。
// ---------------------------------------------------------------------------

export interface BillingLineItemInput {
  subject: string;
  description: string | null;
  quantity: number;
  unitPriceExTax: number;
}

export type BillingRegistrationKind = "spot" | "recurring";

export interface BillingRegistrationInput {
  kind: BillingRegistrationKind;
  clientId: string;
  /** 請求全体で1つの件名（invoices.invoice_title / billing_rules.invoice_title）。摘要とは別概念。 */
  invoiceTitle: string;
  items: BillingLineItemInput[];
  /** kind==='spot'の場合必須（'YYYY-MM'）。 */
  billingMonth?: string | null;
  revenueMonth?: string | null;
  /** kind==='recurring'の場合必須（'YYYY-MM'）。 */
  validFrom?: string | null;
  validTo?: string | null;
}

interface ValidatedBillingRegistration {
  kind: BillingRegistrationKind;
  clientId: string;
  invoiceTitle: string;
  items: BillingLineItemInput[];
  billingMonthIso: string;
  revenueMonthIso: string;
  validFromIso: string;
  validToIso: string | null;
}

/**
 * /management/billingの複数摘要登録フォームの入力チェック。既存の単一摘要フォーム
 * （parseOneTimeBillingFormData / createRecurringBillingRuleAction）と同じ判定基準
 * （数量>0、単価>0円、月の形式）を、摘要が複数ある場合にもすべて適用する。
 */
export function validateBillingRegistrationInput(
  input: BillingRegistrationInput,
): { data: ValidatedBillingRegistration | null; error: string | null } {
  if (!input.clientId) {
    return { data: null, error: "顧客を選択してください。" };
  }
  const invoiceTitle = (input.invoiceTitle ?? "").trim();
  if (!invoiceTitle) {
    return { data: null, error: "件名を入力してください。" };
  }
  if (!input.items || input.items.length === 0) {
    return { data: null, error: "摘要を1件以上入力してください。" };
  }

  for (let i = 0; i < input.items.length; i += 1) {
    const item = input.items[i];
    const label = `摘要${i + 1}`;
    if (!item.subject || !item.subject.trim()) {
      return { data: null, error: `${label}: 摘要名を入力してください。` };
    }
    if (!Number.isFinite(item.unitPriceExTax)) {
      return { data: null, error: `${label}: 単価を入力してください。` };
    }
    if (item.unitPriceExTax <= 0) {
      return { data: null, error: `${label}: 単価は0円より大きい数値で入力してください。` };
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      return { data: null, error: `${label}: 数量は0より大きい数値で入力してください。` };
    }
  }

  if (input.kind === "spot") {
    const billingMonthIso = monthInputToIso(input.billingMonth);
    if (!billingMonthIso) {
      return { data: null, error: "請求月を入力してください。" };
    }
    const revenueMonthIso = monthInputToIso(input.revenueMonth);
    if (!revenueMonthIso) {
      return { data: null, error: "売上計上月を入力してください。" };
    }
    return {
      data: {
        kind: "spot",
        clientId: input.clientId,
        invoiceTitle,
        items: input.items,
        billingMonthIso,
        revenueMonthIso,
        validFromIso: "",
        validToIso: null,
      },
      error: null,
    };
  }

  const validFromIso = monthInputToIso(input.validFrom);
  if (!validFromIso) {
    return { data: null, error: "開始月を入力してください。" };
  }
  const validToRaw = input.validTo ?? null;
  const validToIso = validToRaw ? monthInputToIso(validToRaw) : null;
  if (validToRaw && !validToIso) {
    return { data: null, error: "終了月の形式が不正です。" };
  }
  if (validToIso && validToIso < validFromIso) {
    return { data: null, error: "終了月は開始月以降にしてください。" };
  }

  return {
    data: {
      kind: "recurring",
      clientId: input.clientId,
      invoiceTitle,
      items: input.items,
      billingMonthIso: "",
      revenueMonthIso: "",
      validFromIso,
      validToIso,
    },
    error: null,
  };
}

/** 補償ロールバック：作成済みone_time billing_rulesを、既存の取消RPCで自動取消する。 */
async function rollbackCreatedOneTimeRules(supabase: TypedClient, ruleIds: string[]): Promise<void> {
  for (const ruleId of ruleIds) {
    await supabase.rpc("cancel_one_time_billing_rule", {
      p_billing_rule_id: ruleId,
      p_reason: "複数摘要登録の一部が失敗したため自動取消",
    });
  }
}

/** 補償ロールバック：作成済みrecurring billing_rulesを、既存の停止処理で自動停止する。 */
async function rollbackCreatedRecurringRules(supabase: TypedClient, ruleIds: string[]): Promise<void> {
  for (const ruleId of ruleIds) {
    await deactivateRecurringBillingRule(supabase, ruleId);
  }
}

export interface BillingRegistrationResult {
  error: string | null;
  createdRuleIds: string[];
  itemCount: number;
  /** 致命的ではないが伝えるべき警告（例: 定期の一部月で件名競合により明細生成をスキップ）。 */
  warning?: string;
}

/**
 * バリデーション済みの複数摘要登録を実行する。摘要ごとにcreateOneTimeBillingRule /
 * createRecurringBillingRuleを順に呼び出す（同じ請求月のスポットは既存のfind-or-create
 * invoiceにより自動的に同じinvoiceへまとまる）。
 * 途中の摘要でbilling_rule自体のINSERTが失敗した場合、または件名競合によりスポットの
 * 明細生成が拒否された場合（createOneTimeBillingRule側で該当ruleは自動取消済み）は、
 * それまでの成功分も取消してエラーを返す（invoice_required=false等の従来からある
 * 「明細生成のみskip」は引き続き失敗扱いにしない）。
 */
export async function executeBillingRegistration(
  supabase: TypedClient,
  data: ValidatedBillingRegistration,
  createdByStaffId: string,
): Promise<BillingRegistrationResult> {
  const createdRuleIds: string[] = [];
  let warning: string | undefined;

  for (const item of data.items) {
    if (data.kind === "spot") {
      const result = await createOneTimeBillingRule(
        supabase,
        {
          clientId: data.clientId,
          invoiceTitle: data.invoiceTitle,
          subject: item.subject,
          description: item.description,
          quantity: item.quantity,
          unitPriceExTax: item.unitPriceExTax,
          billingMonthIso: data.billingMonthIso,
          revenueMonthIso: data.revenueMonthIso,
          notes: null,
        },
        createdByStaffId,
      );
      if (result.ruleId) {
        createdRuleIds.push(result.ruleId);
      } else {
        await rollbackCreatedOneTimeRules(supabase, createdRuleIds);
        return { error: result.error ?? "登録に失敗しました", createdRuleIds: [], itemCount: 0 };
      }
    } else {
      const result = await createRecurringBillingRule(
        supabase,
        {
          clientId: data.clientId,
          invoiceTitle: data.invoiceTitle,
          subject: item.subject,
          description: item.description,
          quantity: item.quantity,
          unitPriceExTax: item.unitPriceExTax,
          validFromIso: data.validFromIso,
          validToIso: data.validToIso,
          revenueMonthOffsetMonths: 0,
          notes: null,
        },
        createdByStaffId,
      );
      if (result.ruleId) {
        createdRuleIds.push(result.ruleId);
        if (result.warning) warning = result.warning;
      } else {
        await rollbackCreatedRecurringRules(supabase, createdRuleIds);
        return { error: result.error ?? "登録に失敗しました", createdRuleIds: [], itemCount: 0 };
      }
    }
  }

  return { error: null, createdRuleIds, itemCount: data.items.length, warning };
}
