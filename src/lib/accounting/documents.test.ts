import { describe, expect, it } from "vitest";
import { isAllowedAccountingMimeType, isValidDocumentType, currentYearMonthJst } from "./documents";

describe("isAllowedAccountingMimeType（書類BOXのアップロード許可mime type）", () => {
  it("PDFを許可する", () => {
    expect(isAllowedAccountingMimeType("application/pdf")).toBe(true);
  });
  it("JPEGを許可する", () => {
    expect(isAllowedAccountingMimeType("image/jpeg")).toBe(true);
    expect(isAllowedAccountingMimeType("image/jpg")).toBe(true);
  });
  it("PNGを許可する", () => {
    expect(isAllowedAccountingMimeType("image/png")).toBe(true);
  });
  it("未対応の形式（動画等）は拒否する", () => {
    expect(isAllowedAccountingMimeType("video/mp4")).toBe(false);
    expect(isAllowedAccountingMimeType("application/zip")).toBe(false);
    expect(isAllowedAccountingMimeType("text/plain")).toBe(false);
  });
});

describe("isValidDocumentType（書類種別の検証）", () => {
  it("receipt/invoice_received/otherを許可する", () => {
    expect(isValidDocumentType("receipt")).toBe(true);
    expect(isValidDocumentType("invoice_received")).toBe(true);
    expect(isValidDocumentType("other")).toBe(true);
  });
  it("未知の値・非文字列を拒否する", () => {
    expect(isValidDocumentType("invoice")).toBe(false);
    expect(isValidDocumentType("")).toBe(false);
    expect(isValidDocumentType(null)).toBe(false);
    expect(isValidDocumentType(undefined)).toBe(false);
  });
});

describe("currentYearMonthJst", () => {
  it("'YYYY-MM'形式を返す", () => {
    expect(currentYearMonthJst()).toMatch(/^\d{4}-\d{2}$/);
  });
});
