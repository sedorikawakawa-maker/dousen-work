import "server-only";

// client_billing_profilesの郵便番号・支払サイト入力チェック（純粋関数）。
// /clients/[id]「請求・売上」タブのsaveClientBillingProfileActionから利用する。

// 日本郵便番号の一般的な表記（123-4567）。厳しすぎる検証はしない。
const POSTAL_CODE_PATTERN = /^\d{3}-\d{4}$/;

export function isValidBillingPostalCode(value: string): boolean {
  return POSTAL_CODE_PATTERN.test(value);
}

export const PAYMENT_DUE_DAYS_MIN = 1;
export const PAYMENT_DUE_DAYS_MAX = 365;

export interface ParsePaymentDueDaysResult {
  value: number | null;
  error: string | null;
}

/**
 * 支払サイト(日数)の入力文字列を解析する。空欄(null/空文字)はnull（=company_profileの
 * 標準支払日数へフォールバック）として許可し、エラーにしない。異常値（整数でない・範囲外）は
 * エラーとして保存を拒否する。
 */
export function parsePaymentDueDays(raw: string | null): ParsePaymentDueDaysResult {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") {
    return { value: null, error: null };
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < PAYMENT_DUE_DAYS_MIN || parsed > PAYMENT_DUE_DAYS_MAX) {
    return {
      value: null,
      error: `支払サイトは${PAYMENT_DUE_DAYS_MIN}〜${PAYMENT_DUE_DAYS_MAX}の整数（日数）で入力してください。`,
    };
  }
  return { value: parsed, error: null };
}
