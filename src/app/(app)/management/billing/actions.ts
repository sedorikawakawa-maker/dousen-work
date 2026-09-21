"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/authGuard";
import {
  createOneTimeBillingRule,
  ensureBillingRollingWindowForAllClients,
  parseOneTimeBillingFormData,
} from "@/lib/billing/generate";

function billingManagementUrl(params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString();
  return `/management/billing?${search}`;
}

/** planned -> prepared のみ許可（sent -> preparedや逆方向はDBトリガーでも二重に禁止される）。 */
export async function markInvoicePreparedAction(formData: FormData) {
  await requireBillingAccess();
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  const month = String(formData.get("month") ?? "").trim();
  const supabase = await createSupabaseServerClient();

  const { data: invoice } = await supabase.from("invoices").select("id, status").eq("id", invoiceId).maybeSingle();
  if (!invoice) {
    redirect(billingManagementUrl({ month, error: "対象の請求書が見つかりません。" }));
  }
  if (invoice.status !== "planned") {
    redirect(billingManagementUrl({ month, error: "請求予定の請求書のみ作成済みにできます。" }));
  }

  const { error } = await supabase.from("invoices").update({ status: "prepared" }).eq("id", invoiceId);
  redirect(billingManagementUrl(error ? { month, error: error.message } : { month, saved: "1" }));
}

/**
 * planned/prepared -> sent。既存Phase 1のmark_invoice_sent RPCをそのまま利用する
 * （actorはRPC内部でcurrent_staff_id()から解決されるため、staff idはここから渡さない）。
 */
export async function markInvoiceSentAction(formData: FormData) {
  await requireBillingAccess();
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  const month = String(formData.get("month") ?? "").trim();
  const supabase = await createSupabaseServerClient();

  const { data: invoice } = await supabase.from("invoices").select("id, status").eq("id", invoiceId).maybeSingle();
  if (!invoice) {
    redirect(billingManagementUrl({ month, error: "対象の請求書が見つかりません。" }));
  }
  if (invoice.status === "sent") {
    redirect(billingManagementUrl({ month, error: "既に送付済みです。" }));
  }

  const { error } = await supabase.rpc("mark_invoice_sent", { p_invoice_id: invoiceId });
  redirect(billingManagementUrl(error ? { month, error: error.message } : { month, saved: "1" }));
}

/**
 * 現在月+2か月のローリング窓の不足分を全クライアント分まとめて補完する。
 * ページ表示時にClient Componentから1回だけ呼ばれる想定（フォーム送信ではなく直接呼び出し
 * のため、ここではredirectしない。冪等なので何度呼ばれても重複生成しない）。
 */
export async function ensureBillingRollingWindowAction(): Promise<{ rulesProcessed: number; itemsGenerated: number }> {
  await requireBillingAccess();
  const supabase = await createSupabaseServerClient();
  return ensureBillingRollingWindowForAllClients(supabase);
}

/**
 * /management/billing 上部の「＋ 請求を登録」フォームからのスポット請求登録。
 * クライアント詳細画面のcreateOneTimeBillingRuleActionと同じ共通処理
 * （@/lib/billing/generateのparseOneTimeBillingFormData / createOneTimeBillingRule）を使い、
 * billing_rule/invoice/invoice_item/activity_logsの生成経路を1本化する。
 * 権限チェックはrequireBillingAccess()（UIを隠すだけでなくAction側でも必ず検証）。
 */
export async function createOneTimeBillingRuleFromManagementAction(formData: FormData) {
  const staff = await requireBillingAccess();
  const month = String(formData.get("month") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "").trim();
  const supabase = await createSupabaseServerClient();

  if (clientId) {
    const { data: client } = await supabase.from("clients_view").select("id").eq("id", clientId).maybeSingle();
    if (!client) {
      redirect(billingManagementUrl({ month, error: "顧客が見つかりません。" }));
    }
  }

  const { fields, error: validationError } = parseOneTimeBillingFormData(formData, clientId, {
    requireRevenueMonth: true,
    disallowZeroAmount: true,
  });
  if (validationError || !fields) {
    redirect(billingManagementUrl({ month, error: validationError ?? "入力内容を確認してください。" }));
  }

  const result = await createOneTimeBillingRule(supabase, fields, staff.id);
  redirect(
    billingManagementUrl(
      result.error ? { month, error: result.error } : { month, saved: "created" },
    ),
  );
}
