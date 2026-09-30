"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmExpenseBatchFromDocumentAction } from "@/app/(app)/accounting/documents/actions";
import { ACCOUNT_CATEGORY_OPTIONS, TAX_CATEGORY_OPTIONS } from "@/lib/accounting/categories";

interface LineItemState {
  localId: string;
  description: string;
  amount: string;
  taxAmount: string;
  accountCategory: string;
  taxCategory: string;
}

function newLineItem(): LineItemState {
  return {
    localId: crypto.randomUUID(),
    description: "",
    amount: "",
    taxAmount: "",
    accountCategory: "",
    taxCategory: "",
  };
}

function yen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

/**
 * 書類確認画面の「経費として確定」。1書類 : 複数明細(expenses)を正常ケースとして扱う
 * （1枚の証憑に複数の勘定科目・経費区分が含まれるケースに対応）。取引日・取引先・支払方法は
 * 書類単位で1回だけ入力し、金額・摘要・勘定科目・税区分は明細ごとに増減できる
 * （BillingRegistrationFormと同じ複数明細UIパターン）。
 * 書類のamount_candidateと明細合計が異なる場合は、登録は妨げず警告のみ表示する
 * （税・端数・対象外明細等があり得るため自動補正はしない）。
 */
export function AccountingExpenseConfirmForm({
  documentId,
  initialTransactionDate,
  initialVendorName,
  initialPaymentMethod,
  documentAmountCandidate,
}: {
  documentId: string;
  initialTransactionDate: string;
  initialVendorName: string;
  initialPaymentMethod: string;
  documentAmountCandidate: number | null;
}) {
  const router = useRouter();
  const [transactionDate, setTransactionDate] = useState(initialTransactionDate);
  const [vendorName, setVendorName] = useState(initialVendorName);
  const [paymentMethod, setPaymentMethod] = useState(initialPaymentMethod);
  const [items, setItems] = useState<LineItemState[]>([newLineItem()]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateItem(localId: string, patch: Partial<LineItemState>) {
    setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [...prev, newLineItem()]);
  }
  function removeItem(localId: string) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.localId !== localId)));
  }

  const itemsTotal = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
  const hasMismatch =
    documentAmountCandidate !== null && Math.abs(itemsTotal - documentAmountCandidate) > 0.01;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setWarning(null);
    setIsSubmitting(true);

    try {
      const result = await confirmExpenseBatchFromDocumentAction({
        documentId,
        transactionDate,
        vendorName,
        paymentMethod: paymentMethod || null,
        documentAmountCandidate,
        items: items.map((it) => ({
          description: it.description.trim() ? it.description.trim() : null,
          amount: it.amount === "" ? null : Number(it.amount),
          taxAmount: it.taxAmount === "" ? null : Number(it.taxAmount),
          accountCategoryCandidate: it.accountCategory || null,
          accountCategoryConfirmed: it.accountCategory || null,
          taxCategoryCandidate: it.taxCategory || null,
          taxCategoryConfirmed: it.taxCategory || null,
        })),
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.warning) {
        // 警告があっても登録自体は成功しているため、経費一覧へ遷移しつつ内容はクエリで伝える。
        router.push(`/accounting/expenses?saved=confirmed&warning=${encodeURIComponent(result.warning)}`);
        return;
      }
      router.push("/accounting/expenses?saved=confirmed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-neutral-700">経費として確定</h2>
      <p className="rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
        1枚の書類に複数の勘定科目・経費区分が含まれる場合は、明細を追加して分けて登録できます。
        勘定科目・税区分は候補であり、最終的な判断は税理士確認前提です。
      </p>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {warning ? <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{warning}</p> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium text-neutral-700">
          取引日
          <input
            type="date"
            value={transactionDate}
            onChange={(e) => setTransactionDate(e.target.value)}
            required
            disabled={isSubmitting}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          />
        </label>
        <label className="text-sm font-medium text-neutral-700">
          取引先
          <input
            type="text"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            required
            disabled={isSubmitting}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          />
        </label>
        <label className="text-sm font-medium text-neutral-700">
          支払方法（任意）
          <input
            type="text"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            disabled={isSubmitting}
            className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
          />
        </label>
      </div>

      <div className="flex flex-col gap-3">
        {items.map((item, index) => (
          <div key={item.localId} className="rounded-xl border border-neutral-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-500">明細 {index + 1}</span>
              <button
                type="button"
                onClick={() => removeItem(item.localId)}
                disabled={isSubmitting || items.length <= 1}
                className="text-xs text-red-600 underline disabled:cursor-not-allowed disabled:text-neutral-300 disabled:no-underline"
              >
                削除
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-neutral-700">
                摘要（任意）
                <input
                  type="text"
                  value={item.description}
                  onChange={(e) => updateItem(item.localId, { description: e.target.value })}
                  disabled={isSubmitting}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm disabled:bg-neutral-50"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-medium text-neutral-700">
                  金額（円）
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={item.amount}
                    onChange={(e) => updateItem(item.localId, { amount: e.target.value })}
                    required
                    disabled={isSubmitting}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm disabled:bg-neutral-50"
                  />
                </label>
                <label className="text-xs font-medium text-neutral-700">
                  税額（円・任意）
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={item.taxAmount}
                    onChange={(e) => updateItem(item.localId, { taxAmount: e.target.value })}
                    disabled={isSubmitting}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm disabled:bg-neutral-50"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-medium text-neutral-700">
                  勘定科目（候補）
                  <select
                    value={item.accountCategory}
                    onChange={(e) => updateItem(item.localId, { accountCategory: e.target.value })}
                    required
                    disabled={isSubmitting}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm disabled:bg-neutral-50"
                  >
                    <option value="">選択してください</option>
                    {ACCOUNT_CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-medium text-neutral-700">
                  税区分（候補・任意）
                  <select
                    value={item.taxCategory}
                    onChange={(e) => updateItem(item.localId, { taxCategory: e.target.value })}
                    disabled={isSubmitting}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm disabled:bg-neutral-50"
                  >
                    <option value="">選択しない</option>
                    {TAX_CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addItem}
        disabled={isSubmitting}
        className="self-start rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700"
      >
        ＋ 明細を追加
      </button>

      <div className="flex items-center justify-between text-sm">
        <span className="text-neutral-600">明細合計: {yen(itemsTotal)}</span>
        {documentAmountCandidate !== null ? (
          <span className={hasMismatch ? "font-medium text-amber-700" : "text-neutral-400"}>
            書類の合計金額: {yen(documentAmountCandidate)}
            {hasMismatch ? "（一致していません）" : ""}
          </span>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-full bg-[var(--accent)] px-4 py-3 text-base font-semibold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50"
      >
        {isSubmitting ? "確定中..." : "経費として確定"}
      </button>
    </form>
  );
}
