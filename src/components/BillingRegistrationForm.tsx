"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBillingRegistrationAction } from "@/app/(app)/management/billing/actions";

interface ClientOption {
  id: string;
  client_code: string;
  company_name: string;
}

interface LineItemState {
  localId: string;
  subject: string;
  description: string;
  unitPriceExTax: string;
  quantity: string;
}

function newLineItem(): LineItemState {
  return {
    localId: crypto.randomUUID(),
    subject: "",
    description: "",
    unitPriceExTax: "",
    quantity: "1",
  };
}

function subtotalOf(item: LineItemState): number {
  const price = Number(item.unitPriceExTax);
  const qty = Number(item.quantity);
  if (!Number.isFinite(price) || !Number.isFinite(qty)) return 0;
  return Math.round(price * qty * 100) / 100;
}

function yen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

/**
 * /management/billing 上部の「＋ 請求を登録」。スポット/定期の選択と複数摘要（各摘要が
 * それぞれ独立したbilling_ruleになる）に対応する。既存の単一摘要フォームとは異なり
 * クライアントコンポーネントとして構成し、複数摘要の増減・小計計算をブラウザ側で行う。
 * 送信はServer Action（createBillingRegistrationAction）を直接呼び出し、成功時は
 * フォームを閉じてrouter.refresh()で一覧を再取得する（フルページ遷移はしない）。
 */
export function BillingRegistrationForm({
  clients,
  defaultMonth,
}: {
  clients: ClientOption[];
  defaultMonth: string;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [kind, setKind] = useState<"spot" | "recurring">("spot");
  const [clientQuery, setClientQuery] = useState("");
  const [clientId, setClientId] = useState("");
  const [invoiceTitle, setInvoiceTitle] = useState("");
  const [billingMonth, setBillingMonth] = useState(defaultMonth);
  const [revenueMonth, setRevenueMonth] = useState(defaultMonth);
  const [validFrom, setValidFrom] = useState(defaultMonth);
  const [validTo, setValidTo] = useState("");
  const [items, setItems] = useState<LineItemState[]>([newLineItem()]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [, startTransition] = useTransition();

  const q = clientQuery.trim().toLowerCase();
  const selectedClient = clients.find((c) => c.id === clientId);
  const filteredClients = q ? clients.filter((c) => `${c.client_code} ${c.company_name}`.toLowerCase().includes(q)) : clients;
  const optionClients =
    selectedClient && !filteredClients.some((c) => c.id === selectedClient.id)
      ? [selectedClient, ...filteredClients]
      : filteredClients;

  const total = items.reduce((sum, it) => sum + subtotalOf(it), 0);

  function updateItem(localId: string, patch: Partial<LineItemState>) {
    setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [...prev, newLineItem()]);
  }
  function removeItem(localId: string) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.localId !== localId)));
  }

  function resetForm() {
    setKind("spot");
    setClientId("");
    setClientQuery("");
    setInvoiceTitle("");
    setBillingMonth(defaultMonth);
    setRevenueMonth(defaultMonth);
    setValidFrom(defaultMonth);
    setValidTo("");
    setItems([newLineItem()]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setWarningMessage(null);
    setIsSubmitting(true);

    try {
      const result = await createBillingRegistrationAction({
        kind,
        clientId,
        invoiceTitle: invoiceTitle.trim(),
        items: items.map((it) => ({
          subject: it.subject.trim(),
          description: it.description.trim() ? it.description.trim() : null,
          unitPriceExTax: Number(it.unitPriceExTax),
          quantity: Number(it.quantity),
        })),
        billingMonth: kind === "spot" ? billingMonth : undefined,
        revenueMonth: kind === "spot" ? revenueMonth : undefined,
        validFrom: kind === "recurring" ? validFrom : undefined,
        validTo: kind === "recurring" ? validTo || null : undefined,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      setSuccessMessage(kind === "spot" ? "スポット請求を登録しました。" : "定期請求を登録しました。");
      if (result.warning) setWarningMessage(result.warning);
      resetForm();
      setIsOpen(false);
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
      {successMessage ? (
        <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{successMessage}</p>
      ) : null}
      {warningMessage ? (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{warningMessage}</p>
      ) : null}

      {!isOpen ? (
        <button
          type="button"
          onClick={() => {
            setIsOpen(true);
            setSuccessMessage(null);
          }}
          className="text-sm font-semibold text-[var(--accent-strong)]"
        >
          ＋ 請求を登録
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-neutral-700">請求種別</legend>
            <div className="flex gap-4 text-sm text-neutral-700">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="kind"
                  checked={kind === "spot"}
                  onChange={() => setKind("spot")}
                  disabled={isSubmitting}
                />
                スポット
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="kind"
                  checked={kind === "recurring"}
                  onChange={() => setKind("recurring")}
                  disabled={isSubmitting}
                />
                定期
              </label>
            </div>
          </fieldset>

          <label className="text-sm font-medium text-neutral-700">
            顧客名で絞り込み（任意）
            <input
              type="text"
              value={clientQuery}
              onChange={(e) => setClientQuery(e.target.value)}
              disabled={isSubmitting}
              placeholder="会社名・顧客コードで検索"
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
            />
          </label>

          <label className="text-sm font-medium text-neutral-700">
            顧客
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              required
              disabled={isSubmitting}
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
            >
              <option value="" disabled>
                選択してください
              </option>
              {optionClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.client_code} {c.company_name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-medium text-neutral-700">
            件名（請求全体で1つ）
            <input
              type="text"
              value={invoiceTitle}
              onChange={(e) => setInvoiceTitle(e.target.value)}
              required
              disabled={isSubmitting}
              placeholder="例: 9月分 SNS運用・動画制作費"
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
            />
          </label>

          {kind === "spot" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-neutral-700">
                請求月
                <input
                  type="month"
                  value={billingMonth}
                  onChange={(e) => setBillingMonth(e.target.value)}
                  required
                  disabled={isSubmitting}
                  className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
                />
              </label>
              <label className="text-sm font-medium text-neutral-700">
                売上計上月
                <input
                  type="month"
                  value={revenueMonth}
                  onChange={(e) => setRevenueMonth(e.target.value)}
                  required
                  disabled={isSubmitting}
                  className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
                />
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-neutral-700">
                開始月
                <input
                  type="month"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                  required
                  disabled={isSubmitting}
                  className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
                />
              </label>
              <label className="text-sm font-medium text-neutral-700">
                終了月（任意・継続中なら空欄）
                <input
                  type="month"
                  value={validTo}
                  onChange={(e) => setValidTo(e.target.value)}
                  disabled={isSubmitting}
                  className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3.5 py-3 text-base disabled:bg-neutral-50"
                />
              </label>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {items.map((item, index) => (
              <div key={item.localId} className="rounded-xl border border-neutral-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-500">摘要 {index + 1}</span>
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
                    摘要名
                    <input
                      type="text"
                      value={item.subject}
                      onChange={(e) => updateItem(item.localId, { subject: e.target.value })}
                      required
                      disabled={isSubmitting}
                      className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm disabled:bg-neutral-50"
                    />
                  </label>
                  <label className="text-xs font-medium text-neutral-700">
                    説明・備考（任意）
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
                      単価（税抜・円）
                      <input
                        type="number"
                        step="1"
                        min="1"
                        value={item.unitPriceExTax}
                        onChange={(e) => updateItem(item.localId, { unitPriceExTax: e.target.value })}
                        required
                        disabled={isSubmitting}
                        className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm disabled:bg-neutral-50"
                      />
                    </label>
                    <label className="text-xs font-medium text-neutral-700">
                      数量
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={item.quantity}
                        onChange={(e) => updateItem(item.localId, { quantity: e.target.value })}
                        required
                        disabled={isSubmitting}
                        className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm disabled:bg-neutral-50"
                      />
                    </label>
                  </div>
                  <p className="text-right text-xs text-neutral-600">小計: {yen(subtotalOf(item))}</p>
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
            ＋ 摘要を追加
          </button>

          <p className="text-right text-sm font-semibold text-neutral-900">請求合計（税抜）: {yen(total)}</p>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 rounded-full bg-[var(--accent)] px-4 py-3 text-base font-semibold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50"
            >
              {isSubmitting ? "登録中..." : "登録する"}
            </button>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setError(null);
                setIsOpen(false);
              }}
              disabled={isSubmitting}
              className="rounded-full border border-neutral-300 px-4 py-3 text-sm font-medium text-neutral-700"
            >
              キャンセル
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
