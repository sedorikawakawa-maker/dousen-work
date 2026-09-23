import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/authGuard";
import {
  BILLING_ITEM_CATEGORY_LABELS,
  buildBillingExportRows,
  filterInvoicesByClientName,
  filterInvoicesByStatus,
  listInvoicesForMonth,
  type BillingStatusFilterKey,
} from "@/lib/billing/queries";
import { currentMonthIsoJst, formatMonthLabel, monthInputToIso } from "@/lib/billing/generate";

const STATUS_FILTER_KEYS: BillingStatusFilterKey[] = ["all", "unsent", "planned", "prepared", "sent"];

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * /management/billing の一覧をCSVで出力する。画面と同じ絞り込み（月・status・顧客名検索）を
 * クエリパラメータで受け取り、画面表示（listInvoicesForMonth + filterInvoicesByStatus/
 * filterInvoicesByClientName + buildBillingExportRows）とまったく同じ関数で行を組み立てる
 * ことで、画面表示とCSVの金額・件数が食い違わないようにする。
 * 権限チェックはUIでボタンを隠すだけでなく、ここでも必ずrequireBillingAccess()で検証する。
 */
export async function GET(request: NextRequest) {
  await requireBillingAccess();

  const searchParams = request.nextUrl.searchParams;
  const billingMonthIso = monthInputToIso(searchParams.get("month")) ?? currentMonthIsoJst();
  const statusParam = searchParams.get("status") ?? "all";
  const statusFilter: BillingStatusFilterKey = STATUS_FILTER_KEYS.includes(statusParam as BillingStatusFilterKey)
    ? (statusParam as BillingStatusFilterKey)
    : "all";
  const nameQuery = searchParams.get("q") ?? "";

  const supabase = await createSupabaseServerClient();
  const invoices = filterInvoicesByClientName(
    filterInvoicesByStatus(await listInvoicesForMonth(supabase, billingMonthIso), statusFilter),
    nameQuery,
  );
  const rows = buildBillingExportRows(invoices);

  const header = [
    "顧客コード",
    "顧客名",
    "件名",
    "摘要",
    "請求月",
    "売上月",
    "種別",
    "税抜金額",
    "状態",
    "請求先会社名",
    "請求先メールアドレス",
  ];

  const lines = [header.map(csvField).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.clientCode,
        row.clientCompanyName,
        row.invoiceTitle ?? "",
        row.subject,
        formatMonthLabel(row.billingMonth),
        formatMonthLabel(row.revenueMonth),
        BILLING_ITEM_CATEGORY_LABELS[row.category],
        String(row.amount),
        row.statusLabel,
        row.billingCompanyNameSnapshot ?? "",
        row.billingEmailSnapshot ?? "",
      ]
        .map((v) => csvField(String(v)))
        .join(","),
    );
  }

  const csvBody = "﻿" + lines.join("\r\n") + "\r\n";
  const monthQuery = billingMonthIso.slice(0, 7);
  const fileNameAscii = `billing_list_${monthQuery}.csv`;
  const fileNameUtf8 = encodeURIComponent(`請求一覧_${monthQuery}.csv`);

  return new NextResponse(csvBody, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileNameAscii}"; filename*=UTF-8''${fileNameUtf8}`,
    },
  });
}
