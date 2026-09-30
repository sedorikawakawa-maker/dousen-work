"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccountingAccess } from "@/lib/accounting/authGuard";
import { cancelExpense } from "@/lib/accounting/expenses";

function expensesUrl(params: Record<string, string> = {}): string {
  const search = new URLSearchParams(params).toString();
  return search ? `/accounting/expenses?${search}` : "/accounting/expenses";
}

/** 経費取消。物理DELETEはせず、cancelled_at/cancel_reasonで履歴を残す（既存の取消モデルと同じ）。 */
export async function cancelExpenseAction(formData: FormData) {
  const staff = await requireAccountingAccess();
  const supabase = await createSupabaseServerClient();

  const expenseId = String(formData.get("expenseId") ?? "").trim();
  const reason = String(formData.get("cancelReason") ?? "");
  const month = String(formData.get("month") ?? "").trim();

  const result = await cancelExpense(supabase, expenseId, reason, staff.id);

  redirect(
    expensesUrl({
      ...(month ? { month } : {}),
      ...(result.error ? { error: result.error } : { saved: "cancelled" }),
    }),
  );
}
