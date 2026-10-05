import { describe, expect, it } from "vitest";
import { isCompanyProfileReadyForInvoiceIssue, type CompanyProfile } from "./companyProfile";

function fullProfile(overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    id: 1,
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
    default_payment_due_days: 30,
    note: null,
    logo_drive_file_id: null,
    logo_drive_url: null,
    updated_at: "2026-10-01T00:00:00Z",
    updated_by_staff_id: null,
    ...overrides,
  };
}

describe("isCompanyProfileReadyForInvoiceIssue（自社情報が発行に必要な項目を満たすか）", () => {
  it("全項目が設定済みならtrue", () => {
    expect(isCompanyProfileReadyForInvoiceIssue(fullProfile())).toBe(true);
  });

  it("nullの場合はfalse", () => {
    expect(isCompanyProfileReadyForInvoiceIssue(null)).toBe(false);
  });

  it("company_nameが未設定ならfalse", () => {
    expect(isCompanyProfileReadyForInvoiceIssue(fullProfile({ company_name: null }))).toBe(false);
  });

  it("company_nameが空文字ならfalse", () => {
    expect(isCompanyProfileReadyForInvoiceIssue(fullProfile({ company_name: "  " }))).toBe(false);
  });

  it("invoice_registration_numberが未設定ならfalse", () => {
    expect(isCompanyProfileReadyForInvoiceIssue(fullProfile({ invoice_registration_number: null }))).toBe(false);
  });

  it("bank_name/branch_name/account_type/account_number/account_holder_nameのいずれか欠落でfalse", () => {
    expect(isCompanyProfileReadyForInvoiceIssue(fullProfile({ bank_name: null }))).toBe(false);
    expect(isCompanyProfileReadyForInvoiceIssue(fullProfile({ branch_name: null }))).toBe(false);
    expect(isCompanyProfileReadyForInvoiceIssue(fullProfile({ account_type: null }))).toBe(false);
    expect(isCompanyProfileReadyForInvoiceIssue(fullProfile({ account_number: null }))).toBe(false);
    expect(isCompanyProfileReadyForInvoiceIssue(fullProfile({ account_holder_name: null }))).toBe(false);
  });

  it("note/logo/default_payment_due_daysが未設定でも発行要件には影響しない", () => {
    expect(
      isCompanyProfileReadyForInvoiceIssue(
        fullProfile({ note: null, logo_drive_file_id: null, logo_drive_url: null, default_payment_due_days: null }),
      ),
    ).toBe(true);
  });
});
