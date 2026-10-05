import { describe, expect, it } from "vitest";
import { validateInvoiceDocumentSnapshot, type InvoiceDocumentSnapshot } from "./snapshot";

function validSnapshot(): InvoiceDocumentSnapshot {
  return {
    issuer: {
      company_name: "株式会社ドウセン",
      postal_code: "100-0001",
      address: "東京都千代田区1-1-1",
      phone: "03-0000-0000",
      email: "info@example.com",
      invoice_registration_number: "T1234567890123",
      bank_name: "テスト銀行",
      branch_name: "テスト支店",
      account_type: "普通",
      account_number: "1234567",
      account_holder_name: "カ）ドウセン",
    },
    recipient: {
      company_name: "株式会社テスト",
      department: "営業部",
      contact_name: "山田 太郎",
      postal_code: "160-0001",
      address: "東京都新宿区1-1-1",
    },
    invoice: {
      invoice_number: "202610-0001",
      invoice_title: "10月分ご請求",
      issue_date: "2026-10-05",
      due_date: "2026-11-04",
      billing_month: "2026-10-01",
    },
    items: [
      {
        subject: "Instagram運用支援",
        description: "月次運用",
        quantity: 1,
        unit_price_ex_tax: 50000,
        tax_excluded_amount: 50000,
        tax_rate: 0.1,
        tax_category: "課税",
        revenue_month: "2026-10-01",
      },
    ],
  };
}

describe("validateInvoiceDocumentSnapshot（正常系）", () => {
  it("正しい構造を受け入れる", () => {
    const { data, error } = validateInvoiceDocumentSnapshot(validSnapshot());
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data?.items).toHaveLength(1);
  });

  it("department/contact_name/description/tax_category/invoice_titleがnullでも受け入れる", () => {
    const snapshot = validSnapshot();
    snapshot.recipient.department = null;
    snapshot.recipient.contact_name = null;
    snapshot.invoice.invoice_title = null;
    snapshot.items[0].description = null;
    snapshot.items[0].tax_category = null;
    const { data, error } = validateInvoiceDocumentSnapshot(snapshot);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });

  it("複数明細を受け入れる", () => {
    const snapshot = validSnapshot();
    snapshot.items.push({ ...snapshot.items[0], subject: "動画編集" });
    const { data, error } = validateInvoiceDocumentSnapshot(snapshot);
    expect(error).toBeNull();
    expect(data?.items).toHaveLength(2);
  });
});

describe("validateInvoiceDocumentSnapshot（異常系・不正snapshot拒否）", () => {
  it("nullを拒否する", () => {
    const { data, error } = validateInvoiceDocumentSnapshot(null);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("オブジェクトでない値を拒否する", () => {
    const { data, error } = validateInvoiceDocumentSnapshot("not an object");
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("issuerが欠落している場合を拒否する", () => {
    const snapshot = validSnapshot() as unknown as Record<string, unknown>;
    delete snapshot.issuer;
    const { data, error } = validateInvoiceDocumentSnapshot(snapshot);
    expect(data).toBeNull();
    expect(error).toContain("issuer");
  });

  it("issuerの必須項目(company_name)が空文字の場合を拒否する", () => {
    const snapshot = validSnapshot();
    snapshot.issuer.company_name = "";
    const { data, error } = validateInvoiceDocumentSnapshot(snapshot);
    expect(data).toBeNull();
    expect(error).toContain("issuer.company_name");
  });

  it("recipientの必須項目(postal_code)が欠落している場合を拒否する", () => {
    const snapshot = validSnapshot() as unknown as { recipient: Record<string, unknown> };
    delete snapshot.recipient.postal_code;
    const { data, error } = validateInvoiceDocumentSnapshot(snapshot);
    expect(data).toBeNull();
    expect(error).toContain("recipient.postal_code");
  });

  it("invoice.issue_dateの形式が不正な場合を拒否する", () => {
    const snapshot = validSnapshot();
    (snapshot.invoice as unknown as { issue_date: string }).issue_date = "2026/10/05";
    const { data, error } = validateInvoiceDocumentSnapshot(snapshot);
    expect(data).toBeNull();
    expect(error).toContain("issue_date");
  });

  it("itemsが空配列の場合を拒否する", () => {
    const snapshot = validSnapshot();
    snapshot.items = [];
    const { data, error } = validateInvoiceDocumentSnapshot(snapshot);
    expect(data).toBeNull();
    expect(error).toContain("items");
  });

  it("items内のquantityが数値でない場合を拒否する", () => {
    const snapshot = validSnapshot() as unknown as { items: Record<string, unknown>[] };
    snapshot.items[0].quantity = "1";
    const { data, error } = validateInvoiceDocumentSnapshot(snapshot);
    expect(data).toBeNull();
    expect(error).toContain("quantity");
  });
});
