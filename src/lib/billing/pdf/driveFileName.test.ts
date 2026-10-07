import { describe, expect, it } from "vitest";
import { buildInvoiceDocumentFileName, sanitizeDriveFileNameSegment } from "./driveFileName";
import type { InvoiceDocumentSnapshot } from "./snapshot";

describe("sanitizeDriveFileNameSegment", () => {
  it("危険な文字(/ \\ : * ? \" < > |)をアンダースコアへ置き換える", () => {
    expect(sanitizeDriveFileNameSegment('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  it("日本語はそのまま保持する", () => {
    expect(sanitizeDriveFileNameSegment("株式会社サンプル")).toBe("株式会社サンプル");
  });

  it("前後の空白を取り除く", () => {
    expect(sanitizeDriveFileNameSegment("  テスト  ")).toBe("テスト");
  });
});

describe("buildInvoiceDocumentFileName", () => {
  function snapshotWith(recipientCompanyName: string): InvoiceDocumentSnapshot {
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
        company_name: recipientCompanyName,
        department: null,
        contact_name: null,
        postal_code: "160-0001",
        address: "東京都新宿区1-1-1",
      },
      invoice: {
        invoice_number: "202610-0001",
        invoice_title: null,
        issue_date: "2026-10-05",
        due_date: "2026-11-04",
        billing_month: "2026-10-01",
      },
      items: [
        {
          subject: "テスト",
          description: null,
          quantity: 1,
          unit_price_ex_tax: 1000,
          tax_excluded_amount: 1000,
          tax_rate: 0.1,
          tax_category: "課税",
          revenue_month: "2026-10-01",
        },
      ],
    };
  }

  it("{invoice_number}_{請求先会社名}_{YYYY年MM月請求書}.pdf の形式で組み立てる", () => {
    const name = buildInvoiceDocumentFileName(snapshotWith("株式会社サンプル"));
    expect(name).toBe("202610-0001_株式会社サンプル_2026年10月請求書.pdf");
  });

  it("会社名に危険な文字が含まれる場合はsanitizeされる", () => {
    const name = buildInvoiceDocumentFileName(snapshotWith('株式会社サンプル/テスト"商事'));
    expect(name).toBe("202610-0001_株式会社サンプル_テスト_商事_2026年10月請求書.pdf");
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });
});
