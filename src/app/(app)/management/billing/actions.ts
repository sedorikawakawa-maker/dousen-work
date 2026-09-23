"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/authGuard";
import {
  ensureBillingRollingWindowForAllClients,
  executeBillingRegistration,
  validateBillingRegistrationInput,
  type BillingRegistrationInput,
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

export interface BillingRegistrationActionResult {
  error: string | null;
  itemCount?: number;
  warning?: string;
}

/**
 * /management/billing 上部の「＋ 請求を登録」フォームからの登録（スポット/定期・複数摘要対応）。
 * クライアント詳細画面と同じ共通処理（@/lib/billing/generateのexecuteBillingRegistration経由で
 * createOneTimeBillingRule / createRecurringBillingRule）を使い、生成経路を1本化する。
 * フォームがクライアントコンポーネントのため、FormDataではなく構造化オブジェクトを直接受け取り、
 * redirectではなく結果オブジェクトを返す（呼び出し側でrouter.refresh()して一覧を更新する）。
 * 権限チェックはrequireBillingAccess()（UIを隠すだけでなくAction側でも必ず検証）。
 */
export async function createBillingRegistrationAction(
  input: BillingRegistrationInput,
): Promise<BillingRegistrationActionResult> {
  const staff = await requireBillingAccess();
  const supabase = await createSupabaseServerClient();

  if (input.clientId) {
    const { data: client } = await supabase.from("clients_view").select("id").eq("id", input.clientId).maybeSingle();
    if (!client) {
      return { error: "顧客が見つかりません。" };
    }
  }

  const { data, error: validationError } = validateBillingRegistrationInput(input);
  if (validationError || !data) {
    return { error: validationError ?? "入力内容を確認してください。" };
  }

  const result = await executeBillingRegistration(supabase, data, staff.id);
  if (result.error) {
    return { error: result.error };
  }
  return { error: null, itemCount: result.itemCount, warning: result.warning };
}

/**
 * /management/billing の一覧からスポット請求を直接取消する（既存のcancel_one_time_billing_rule
 * RPCをそのまま利用。クライアント詳細画面のcancelOneTimeBillingRuleActionと同じRPC・同じ取消モデル）。
 */
export async function cancelOneTimeBillingRuleFromManagementAction(formData: FormData) {
  await requireBillingAccess();
  const month = String(formData.get("month") ?? "").trim();
  const ruleId = String(formData.get("ruleId") ?? "").trim();
  const reason = String(formData.get("cancelReason") ?? "").trim();
  const supabase = await createSupabaseServerClient();

  if (!reason) {
    redirect(billingManagementUrl({ month, error: "取消理由を入力してください" }));
  }

  const { error } = await supabase.rpc("cancel_one_time_billing_rule", {
    p_billing_rule_id: ruleId,
    p_reason: reason,
  });

  redirect(billingManagementUrl(error ? { month, error: error.message } : { month, saved: "cancelled" }));
}
