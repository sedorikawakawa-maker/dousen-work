import "server-only";

// 請求書PDF表示用のフォーマット関数。すべて純粋関数（DBアクセスなし）でテスト可能にする。

/** 50000 -> "¥50,000"。小数が含まれる場合も丸めず最大2桁まで表示する（勝手に四捨五入しない）。 */
export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}`;
}

/** 'YYYY-MM-DD' -> '2026年10月5日'。 */
export function formatJapaneseDate(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

/** 'YYYY-MM-DD'（月初日） -> '2026年10月'。日はユーザーに意識させない（既存formatMonthLabelと同じ扱い）。 */
export function formatJapaneseMonth(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  return `${y}年${m}月`;
}

/**
 * 0.10 -> "10%"。nullは「—」（税率未設定。Phase2Aの発行RPCは未設定明細を拒否するため
 * 通常発生しないが、型としてはnullを受け取れるため表示上もフォールバックを用意する）。
 */
export function formatTaxRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}

/** 数量の表示。整数なら小数点を出さず、小数があればそのまま表示する。 */
export function formatQuantity(quantity: number): string {
  return quantity.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
}
