import { describe, expect, it } from "vitest";
import { hasMissingTaxRate, invoiceTotalAmount, summarizeRevenueMonths } from "./invoiceList";
import type { ManagementInvoiceRow, ManagementInvoiceItemRow } from "./queries";

function item(overrides: Partial<ManagementInvoiceItemRow> = {}): ManagementInvoiceItemRow {
  return {
    id: "item-1",
    billing_rule_id: null,
    billingType: null,
    billing_month: "2026-10-01",
    revenue_month: "2026-10-01",
    subject: "テスト摘要",
    description: null,
    quantity: 1,
    unit_price_ex_tax: 10000,
    tax_excluded_amount: 10000,
    amount_override: null,
    tax_rate: 0.1,
    tax_category: "課税",
    notes: null,
    cancelled_at: null,
    ...overrides,
  };
}

function invoice(items: ManagementInvoiceItemRow[]): ManagementInvoiceRow {
  return {
    id: "invoice-1",
    client_id: "client-1",
    clientCode: "C001",
    clientCompanyName: "テスト株式会社",
    invoiceTitle: "10月分",
    billing_month: "2026-10-01",
    status: "planned",
    billing_company_name_snapshot: null,
    billing_contact_name_snapshot: null,
    billing_email_snapshot: null,
    billing_cc_email_snapshot: null,
    billing_method_snapshot: null,
    billing_postal_address_snapshot: null,
    sent_at: null,
    sent_by_staff_id: null,
    notes: null,
    items,
  };
}

describe("summarizeRevenueMonths", () => {
  it("有効な明細が全て同一revenue_monthなら単一月を返す", () => {
    const inv = invoice([item({ revenue_month: "2026-10-01" }), item({ id: "item-2", revenue_month: "2026-10-01" })]);
    expect(summarizeRevenueMonths(inv)).toEqual({ kind: "single", month: "2026-10-01" });
  });

  it("複数のrevenue_monthが混在する場合は複数月を返す", () => {
    const inv = invoice([item({ revenue_month: "2026-10-01" }), item({ id: "item-2", revenue_month: "2026-09-01" })]);
    expect(summarizeRevenueMonths(inv)).toEqual({ kind: "multiple" });
  });

  it("取消済み明細は無視する", () => {
    const inv = invoice([
      item({ revenue_month: "2026-10-01" }),
      item({ id: "item-2", revenue_month: "2026-09-01", cancelled_at: "2026-10-05T00:00:00Z" }),
    ]);
    expect(summarizeRevenueMonths(inv)).toEqual({ kind: "single", month: "2026-10-01" });
  });

  it("有効な明細が無い場合はnoneを返す", () => {
    const inv = invoice([item({ cancelled_at: "2026-10-05T00:00:00Z" })]);
    expect(summarizeRevenueMonths(inv)).toEqual({ kind: "none" });
  });
});

describe("hasMissingTaxRate", () => {
  it("有効な明細にtax_rate未設定が1件でもあればtrue", () => {
    const inv = invoice([item({ tax_rate: 0.1 }), item({ id: "item-2", tax_rate: null })]);
    expect(hasMissingTaxRate(inv)).toBe(true);
  });

  it("全ての有効な明細にtax_rateが設定済みならfalse", () => {
    const inv = invoice([item({ tax_rate: 0.1 }), item({ id: "item-2", tax_rate: 0.08 })]);
    expect(hasMissingTaxRate(inv)).toBe(false);
  });

  it("取消済み明細のtax_rate未設定は無視する", () => {
    const inv = invoice([item({ tax_rate: 0.1 }), item({ id: "item-2", tax_rate: null, cancelled_at: "2026-10-05T00:00:00Z" })]);
    expect(hasMissingTaxRate(inv)).toBe(false);
  });
});

describe("invoiceTotalAmount", () => {
  it("有効な明細のeffectiveInvoiceItemAmountを合算する（取消済みは除外）", () => {
    const inv = invoice([
      item({ tax_excluded_amount: 10000 }),
      item({ id: "item-2", tax_excluded_amount: 5000 }),
      item({ id: "item-3", tax_excluded_amount: 99999, cancelled_at: "2026-10-05T00:00:00Z" }),
    ]);
    expect(invoiceTotalAmount(inv)).toBe(15000);
  });

  it("amount_overrideがある場合はそちらを優先する（既存effectiveInvoiceItemAmountの仕様）", () => {
    const inv = invoice([item({ tax_excluded_amount: 10000, amount_override: 8000 })]);
    expect(invoiceTotalAmount(inv)).toBe(8000);
  });
});
