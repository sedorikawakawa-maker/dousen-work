import { describe, expect, it } from "vitest";
import { isValidBillingPostalCode, parsePaymentDueDays } from "./billingProfileValidation";

describe("isValidBillingPostalCode", () => {
  it("「123-4567」形式を許可する", () => {
    expect(isValidBillingPostalCode("260-0015")).toBe(true);
  });
  it("ハイフンなし・桁数違いは拒否する", () => {
    expect(isValidBillingPostalCode("2600015")).toBe(false);
    expect(isValidBillingPostalCode("26-0015")).toBe(false);
    expect(isValidBillingPostalCode("260-00156")).toBe(false);
  });
  it("空文字は拒否する（空欄チェックは呼び出し側が行う前提）", () => {
    expect(isValidBillingPostalCode("")).toBe(false);
  });
});

describe("parsePaymentDueDays", () => {
  it("空欄(null)はエラーなしでnullを返す（company_profile標準日数へフォールバック）", () => {
    expect(parsePaymentDueDays(null)).toEqual({ value: null, error: null });
  });
  it("空文字もエラーなしでnullを返す", () => {
    expect(parsePaymentDueDays("")).toEqual({ value: null, error: null });
    expect(parsePaymentDueDays("   ")).toEqual({ value: null, error: null });
  });
  it("1〜365の整数は正しく解析される", () => {
    expect(parsePaymentDueDays("30")).toEqual({ value: 30, error: null });
    expect(parsePaymentDueDays("1")).toEqual({ value: 1, error: null });
    expect(parsePaymentDueDays("365")).toEqual({ value: 365, error: null });
  });
  it("0以下は拒否する", () => {
    const result = parsePaymentDueDays("0");
    expect(result.value).toBeNull();
    expect(result.error).toContain("支払サイト");
  });
  it("366以上は拒否する", () => {
    const result = parsePaymentDueDays("366");
    expect(result.value).toBeNull();
    expect(result.error).not.toBeNull();
  });
  it("整数でない値は拒否する", () => {
    expect(parsePaymentDueDays("30.5").error).not.toBeNull();
    expect(parsePaymentDueDays("abc").error).not.toBeNull();
  });
  it("負の数は拒否する", () => {
    expect(parsePaymentDueDays("-5").error).not.toBeNull();
  });
});
