import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// 経費確定は「1書類(document) : 複数明細(expenses)」を正常ケースとして扱う。
// 1枚の領収書・仕入先請求書に複数の勘定科目・経費区分が含まれるケース
// （例: 広告宣伝費30,000円 + 外注費50,000円）に対応するため、取引日・取引先・
// 支払方法は書類単位で1回だけ入力し、金額・摘要・勘定科目・税区分は明細ごとに持つ。
// ---------------------------------------------------------------------------

export interface ExpenseLineItemInput {
  description: string | null;
  amount: number | null;
  taxAmount: number | null;
  accountCategoryCandidate: string | null;
  accountCategoryConfirmed: string | null;
  taxCategoryCandidate: string | null;
  taxCategoryConfirmed: string | null;
}

export interface ExpenseBatchConfirmInput {
  /** nullの場合は証憑なしの手入力経費（銀行手数料等）。将来の入力画面向けに関数としては対応済み。 */
  documentId: string | null;
  transactionDate: string | null;
  vendorName: string | null;
  paymentMethod: string | null;
  /** 突合参考値。書類側のamount_candidateと明細合計が異なる場合に警告するためだけに使う。 */
  documentAmountCandidate?: number | null;
  items: ExpenseLineItemInput[];
}

export interface ValidatedExpenseLineItem {
  description: string | null;
  amount: number;
  taxAmount: number | null;
  accountCategoryCandidate: string | null;
  accountCategoryConfirmed: string;
  taxCategoryCandidate: string | null;
  taxCategoryConfirmed: string | null;
}

export interface ValidatedExpenseBatchConfirmInput {
  documentId: string | null;
  transactionDate: string;
  vendorName: string;
  paymentMethod: string | null;
  documentAmountCandidate: number | null;
  items: ValidatedExpenseLineItem[];
}

/**
 * 経費確定（複数明細）の入力チェック。必須: 取引日・取引先・明細1件以上、
 * 各明細の金額・勘定科目(確定)。税額・摘要・支払方法等はnullable(Phase1)。
 */
export function validateExpenseBatchConfirmInput(
  input: ExpenseBatchConfirmInput,
): { data: ValidatedExpenseBatchConfirmInput | null; error: string | null } {
  const transactionDate = (input.transactionDate ?? "").trim();
  if (!transactionDate || !DATE_PATTERN.test(transactionDate)) {
    return { data: null, error: "取引日を入力してください。" };
  }
  const vendorName = (input.vendorName ?? "").trim();
  if (!vendorName) {
    return { data: null, error: "取引先を入力してください。" };
  }
  if (!input.items || input.items.length === 0) {
    return { data: null, error: "経費明細を1件以上入力してください。" };
  }

  const validatedItems: ValidatedExpenseLineItem[] = [];
  for (let i = 0; i < input.items.length; i += 1) {
    const item = input.items[i];
    const label = `明細${i + 1}`;
    if (item.amount === null || !Number.isFinite(item.amount) || item.amount < 0) {
      return { data: null, error: `${label}: 金額を正しく入力してください。` };
    }
    if (item.taxAmount !== null && (!Number.isFinite(item.taxAmount) || item.taxAmount < 0)) {
      return { data: null, error: `${label}: 税額を正しく入力してください。` };
    }
    const accountCategoryConfirmed = (item.accountCategoryConfirmed ?? "").trim();
    if (!accountCategoryConfirmed) {
      return { data: null, error: `${label}: 勘定科目を選択してください。` };
    }

    validatedItems.push({
      description: (item.description ?? "").trim() || null,
      amount: item.amount,
      taxAmount: item.taxAmount,
      accountCategoryCandidate: item.accountCategoryCandidate,
      accountCategoryConfirmed,
      taxCategoryCandidate: item.taxCategoryCandidate,
      taxCategoryConfirmed: (item.taxCategoryConfirmed ?? "").trim() || null,
    });
  }

  return {
    data: {
      documentId: input.documentId,
      transactionDate,
      vendorName,
      paymentMethod: (input.paymentMethod ?? "").trim() || null,
      documentAmountCandidate: input.documentAmountCandidate ?? null,
      items: validatedItems,
    },
    error: null,
  };
}

export interface ConfirmExpenseBatchResult {
  error: string | null;
  expenseIds?: string[];
  /** 致命的ではないが伝えるべき警告（書類合計と明細合計の不一致等）。登録自体は妨げない。 */
  warning?: string;
}

/**
 * 経費確定（複数明細）の実処理。既存のmark_invoice_sent/cancel_invoice_item等と同じ
 * security invoker RPC（confirm_accounting_document_expenses）を1回呼ぶだけにし、
 * 個別のUPDATE/INSERTをここから直接行わない。document状態確認・行ロック・明細検証・
 * expenses一括作成・document確定・金額突合はすべてRPC内の1トランザクションで完結するため、
 * 「documentはconfirmedになったがexpensesが0件」のような中途半端な状態は発生し得ない
 * （RPC内で例外が起きれば呼び出し全体がロールバックされる）。
 */
export async function confirmExpenseBatch(
  supabase: TypedClient,
  input: ValidatedExpenseBatchConfirmInput,
): Promise<ConfirmExpenseBatchResult> {
  const { data, error } = await supabase.rpc("confirm_accounting_document_expenses", {
    p_document_id: input.documentId,
    p_transaction_date: input.transactionDate,
    p_vendor_name: input.vendorName,
    p_payment_method: input.paymentMethod,
    p_items: input.items.map((item) => ({
      description: item.description,
      amount: item.amount,
      tax_amount: item.taxAmount,
      account_category_candidate: item.accountCategoryCandidate,
      account_category_confirmed: item.accountCategoryConfirmed,
      tax_category_candidate: item.taxCategoryCandidate,
      tax_category_confirmed: item.taxCategoryConfirmed,
    })),
  });

  if (error || !data) {
    return { error: error?.message ?? "経費の確定に失敗しました。" };
  }

  return { error: null, expenseIds: data.expense_ids, warning: data.warning ?? undefined };
}

/** 経費取消。物理DELETEはせず、cancelled_at/cancel_reasonで履歴を残す。 */
export async function cancelExpense(
  supabase: TypedClient,
  expenseId: string,
  reason: string,
  cancelledByStaffId: string,
): Promise<{ error: string | null }> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { error: "取消理由を入力してください。" };
  }

  const { data, error } = await supabase
    .from("expenses")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by_staff_id: cancelledByStaffId, cancel_reason: trimmedReason })
    .eq("id", expenseId)
    .is("cancelled_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: "取消に失敗しました。" };
  }
  if (!data) {
    return { error: "この経費は既に取消済みです。" };
  }
  return { error: null };
}
