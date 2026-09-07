import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/session";
import { canAccessManagementFeatures } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listActiveStaff } from "@/lib/clients/queries";
import {
  listInvoicesForMonth,
  type ManagementInvoiceItemRow,
  type ManagementInvoiceRow,
} from "@/lib/billing/queries";
import { addMonthsIso, currentMonthIsoJst, formatMonthLabel, monthInputToIso } from "@/lib/billing/generate";
import { PageContainer } from "@/components/PageContainer";
import { markInvoicePreparedAction, markInvoiceSentAction } from "./actions";
import { BillingRollingWindowEnsurer } from "./BillingRollingWindowEnsurer";

const INVOICE_STATUS_LABELS: Record<ManagementInvoiceRow["status"], string> = {
  planned: "請求予定",
  prepared: "請求書作成済",
  sent: "送付済み",
};

const BILLING_METHOD_LABELS: Record<string, string> = {
  email: "メール",
  postal: "郵送",
  other: "その他",
};

const STATUS_FILTERS = [
  { key: "all", label: "すべて" },
  { key: "unsent", label: "未送付" },
  { key: "planned", label: "請求予定" },
  { key: "prepared", label: "作成済" },
  { key: "sent", label: "送付済" },
] as const;
type StatusFilterKey = (typeof STATUS_FILTERS)[number]["key"];

function effectiveAmount(item: ManagementInvoiceItemRow): number {
  return item.amount_override ?? item.tax_excluded_amount;
}

function invoiceTotal(invoice: ManagementInvoiceRow): number {
  return invoice.items.filter((i) => i.cancelled_at === null).reduce((sum, i) => sum + effectiveAmount(i), 0);
}

function yen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

function getBillingWarning(invoice: ManagementInvoiceRow): string | null {
  if (invoice.billing_method_snapshot === "email" && !invoice.billing_email_snapshot) {
    return "送付先未設定（メールアドレスが未登録です）";
  }
  if (invoice.billing_method_snapshot === "postal" && !invoice.billing_postal_address_snapshot) {
    return "郵送先未設定です";
  }
  if (!invoice.billing_method_snapshot) {
    return "請求基本情報で送付方法を設定してください";
  }
  return null;
}

export default async function BillingManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; status?: string; q?: string; saved?: string; error?: string }>;
}) {
  const staff = await getCurrentStaff();
  if (!staff) {
    redirect("/login");
  }
  if (!canAccessManagementFeatures(staff.role)) {
    redirect("/");
  }

  const { month, status, q, saved, error } = await searchParams;
  const billingMonthIso = monthInputToIso(month) ?? currentMonthIsoJst();
  const monthQuery = billingMonthIso.slice(0, 7);
  const prevMonthQuery = addMonthsIso(billingMonthIso, -1).slice(0, 7);
  const nextMonthQuery = addMonthsIso(billingMonthIso, 1).slice(0, 7);
  const statusFilter: StatusFilterKey = STATUS_FILTERS.some((f) => f.key === status) ? (status as StatusFilterKey) : "all";
  const nameQuery = (q ?? "").trim();

  const supabase = await createSupabaseServerClient();
  const [invoices, staffOptions] = await Promise.all([
    listInvoicesForMonth(supabase, billingMonthIso),
    listActiveStaff(supabase),
  ]);
  const staffNameById = new Map(staffOptions.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));

  // 月合計は絞り込みの影響を受けず、常にその月全体の値を表示する。
  const totalPlanned = invoices.reduce((sum, inv) => sum + invoiceTotal(inv), 0);
  const totalUnsent = invoices.filter((inv) => inv.status !== "sent").reduce((sum, inv) => sum + invoiceTotal(inv), 0);
  const totalSent = invoices.filter((inv) => inv.status === "sent").reduce((sum, inv) => sum + invoiceTotal(inv), 0);
  const invoiceCount = invoices.length;
  const unsentCount = invoices.filter((inv) => inv.status !== "sent").length;

  const filteredInvoices = invoices.filter((inv) => {
    if (statusFilter === "unsent" && inv.status === "sent") return false;
    if (statusFilter === "planned" && inv.status !== "planned") return false;
    if (statusFilter === "prepared" && inv.status !== "prepared") return false;
    if (statusFilter === "sent" && inv.status !== "sent") return false;
    if (nameQuery && !inv.clientCompanyName.toLowerCase().includes(nameQuery.toLowerCase())) return false;
    return true;
  });

  function buildUrl(overrides: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    params.set("month", monthQuery);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (nameQuery) params.set("q", nameQuery);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    }
    return `/management/billing?${params.toString()}`;
  }

  return (
    <PageContainer variant="wide" className="gap-6 bg-neutral-50 py-6 sm:py-8">
      <BillingRollingWindowEnsurer />

      <div>
        <Link href="/management" className="text-sm text-neutral-500">
          ← 管理ダッシュボードに戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">請求管理</h1>
        <p className="mt-1 text-xs text-neutral-500">
          今月、誰に・何の内容で・いくらの請求書を送る必要があるかを確認できます（すべて税抜表示）。
        </p>
      </div>

      {saved ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">更新しました。</p>
      ) : null}
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="flex items-center justify-center gap-4">
        <Link
          href={buildUrl({ month: prevMonthQuery })}
          className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700"
        >
          ← 前月
        </Link>
        <h2 className="text-lg font-semibold text-neutral-900">{formatMonthLabel(billingMonthIso)}</h2>
        <Link
          href={buildUrl({ month: nextMonthQuery })}
          className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700"
        >
          翌月 →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 text-center">
          <p className="text-lg font-bold tabular-nums text-neutral-900">{yen(totalPlanned)}</p>
          <p className="mt-0.5 text-[11px] text-neutral-500">請求予定総額（税抜）</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 text-center">
          <p className="text-lg font-bold tabular-nums text-amber-600">{yen(totalUnsent)}</p>
          <p className="mt-0.5 text-[11px] text-neutral-500">未送付金額（税抜）</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 text-center">
          <p className="text-lg font-bold tabular-nums text-green-700">{yen(totalSent)}</p>
          <p className="mt-0.5 text-[11px] text-neutral-500">送付済金額（税抜）</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 text-center">
          <p className="text-lg font-bold tabular-nums text-neutral-900">{invoiceCount}</p>
          <p className="mt-0.5 text-[11px] text-neutral-500">請求書件数</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 text-center">
          <p className="text-lg font-bold tabular-nums text-amber-600">{unsentCount}</p>
          <p className="mt-0.5 text-[11px] text-neutral-500">未送付件数</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={buildUrl({ status: f.key === "all" ? undefined : f.key })}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                statusFilter === f.key
                  ? "bg-[var(--accent)] text-white"
                  : "border border-neutral-300 bg-white text-neutral-700"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <form action="/management/billing" method="get" className="flex items-center gap-1.5">
          <input type="hidden" name="month" value={monthQuery} />
          {statusFilter !== "all" ? <input type="hidden" name="status" value={statusFilter} /> : null}
          <input
            type="text"
            name="q"
            defaultValue={nameQuery}
            placeholder="顧客名で検索"
            className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs"
          />
          <button type="submit" className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700">
            検索
          </button>
        </form>
      </div>

      {filteredInvoices.length === 0 ? (
        <p className="rounded-2xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-400">
          {invoices.length === 0
            ? "この月の請求予定はありません。"
            : "条件に一致する請求書がありません。"}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {filteredInvoices.map((invoice) => {
            const activeItems = invoice.items.filter((i) => i.cancelled_at === null);
            const cancelledItems = invoice.items.filter((i) => i.cancelled_at !== null);
            const warning = getBillingWarning(invoice);
            const sentByName = invoice.sent_by_staff_id ? staffNameById.get(invoice.sent_by_staff_id) ?? "不明なスタッフ" : null;

            return (
              <li key={invoice.id} className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-neutral-900">{invoice.clientCompanyName}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          invoice.status === "sent"
                            ? "bg-green-100 text-green-700"
                            : invoice.status === "prepared"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {INVOICE_STATUS_LABELS[invoice.status]}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      請求先: {invoice.billing_company_name_snapshot ?? "—"}
                      {invoice.billing_contact_name_snapshot ? ` ${invoice.billing_contact_name_snapshot}様` : ""}
                    </p>
                    <p className="text-xs text-neutral-500">
                      送付方法: {invoice.billing_method_snapshot ? BILLING_METHOD_LABELS[invoice.billing_method_snapshot] : "未設定"}
                      {invoice.billing_method_snapshot === "email" && invoice.billing_email_snapshot
                        ? ` （${invoice.billing_email_snapshot}）`
                        : invoice.billing_method_snapshot === "postal" && invoice.billing_postal_address_snapshot
                          ? ` （${invoice.billing_postal_address_snapshot}）`
                          : ""}
                    </p>
                  </div>
                  <Link
                    href={`/clients/${invoice.client_id}?tab=billing`}
                    className="whitespace-nowrap text-xs text-[var(--accent-strong)] underline"
                  >
                    顧客詳細・請求設定を見る →
                  </Link>
                </div>

                {warning ? (
                  <p className="mt-2 rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">⚠ {warning}</p>
                ) : null}

                <ul className="mt-3 flex flex-col gap-1.5 border-t border-neutral-100 pt-3 text-sm">
                  {activeItems.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {item.subject}
                        {item.description ? <span className="ml-1.5 text-xs text-neutral-500">{item.description}</span> : null}
                        {item.revenue_month !== item.billing_month ? (
                          <span className="ml-1.5 text-xs text-neutral-400">（売上計上: {formatMonthLabel(item.revenue_month)}）</span>
                        ) : null}
                      </span>
                      <span className="text-xs text-neutral-600 tabular-nums">
                        {item.quantity} × {item.unit_price_ex_tax.toLocaleString("ja-JP")}円 = {yen(effectiveAmount(item))}
                      </span>
                    </li>
                  ))}
                  {cancelledItems.length > 0 ? (
                    <li className="text-xs text-neutral-300 line-through">
                      {cancelledItems.map((i) => i.subject).join("、")}（取消済み・合計に含まれません）
                    </li>
                  ) : null}
                </ul>

                <div className="mt-2 flex items-center justify-between border-t border-neutral-100 pt-2">
                  <span className="text-sm font-semibold text-neutral-900">合計 {yen(invoiceTotal(invoice))}</span>

                  {invoice.status === "sent" ? (
                    <span className="text-xs text-neutral-500">
                      {invoice.sent_at ? new Date(invoice.sent_at).toLocaleString("ja-JP") : ""} {sentByName ? `${sentByName}が送付` : ""}
                    </span>
                  ) : (
                    <div className="flex items-center gap-2">
                      {invoice.status === "planned" ? (
                        <form action={markInvoicePreparedAction}>
                          <input type="hidden" name="invoiceId" value={invoice.id} />
                          <input type="hidden" name="month" value={monthQuery} />
                          <button type="submit" className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700">
                            請求書作成済みにする
                          </button>
                        </form>
                      ) : null}

                      <details>
                        <summary className="cursor-pointer rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white marker:content-none">
                          送付済みにする
                        </summary>
                        <div className="mt-2 max-w-xs rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                          <p>
                            この請求書を送付済みにしますか？送付済みにすると、明細・請求先情報は今後一切変更できなくなります。
                          </p>
                          <form action={markInvoiceSentAction} className="mt-2">
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <input type="hidden" name="month" value={monthQuery} />
                            <button type="submit" className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white">
                              送付済みにする（確定）
                            </button>
                          </form>
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageContainer>
  );
}
