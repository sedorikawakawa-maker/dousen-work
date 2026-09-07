"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/authGuard";
import { ensureBillingRollingWindowForAllClients } from "@/lib/billing/generate";

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
