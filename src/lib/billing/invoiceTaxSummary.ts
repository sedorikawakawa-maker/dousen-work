import "server-only";

import { effectiveInvoiceItemAmount } from "@/lib/billing/queries";

// 消費税計算ルール（2026-10-07決定、freee会計に準拠）:
//   1. 有効な明細（cancelled_at IS NULL）を税率ごとにグループ化し、税抜金額を合算する
//      （金額は既存のeffectiveInvoiceItemAmount = amount_override優先・無ければtax_excluded_amount
//      をそのまま使う。新しい金額ロジックは作らない）。
//   2. 税率ごとの合算額に税率を掛け、1円未満を切り捨てて税率ごとの消費税額を出す
//      （明細1行ごとには丸めない。税率ごとに合算した後で初めて切り捨てる）。
//   3. 税率ごとの消費税額を合計して消費税総額を出す。
//   4. 税抜総額 + 消費税総額 = 税込請求額。
// 現在の運用は全明細10%だが、将来8%等が混在しても対応できるよう、税率をキーにした
// 集計（Map）で実装する（税率の種類数に実装が依存しない）。
// tax_categoryはまだ正式な命名規則が無いため、税額計算の判定には一切使用しない（tax_rateのみを正とする）。

export interface TaxableInvoiceItem {
  cancelled_at: string | null;
  tax_rate: number | null;
  amount_override: number | null;
  tax_excluded_amount: number;
}

export interface InvoiceTaxBreakdownRow {
  taxRate: number;
  taxableAmount: number;
  taxAmount: number;
}

export interface InvoiceTaxSummary {
  subtotalExTax: number;
  taxBreakdown: InvoiceTaxBreakdownRow[];
  totalTax: number;
  totalIncludingTax: number;
}

/**
 * 税率(0.10/0.08/0.00のような小数2桁)×整数円(tax_excluded_amount/amount_override)の積は
 * 必ず小数2桁以内に収まる。しかし浮動小数点演算では、本来ちょうど整数になるはずの値が
 * 誤差で7999.999999999999のようにわずかに下回ることがあり、Math.floorがそのまま1円少なく
 * 切り捨ててしまう。そのため小数9桁（本来あり得る誤差より十分粗い桁）で丸めてから
 * 切り捨てることで、この種の浮動小数点誤差による誤判定を防ぐ。
 */
function floorYen(value: number): number {
  return Math.floor(Math.round(value * 1e9) / 1e9);
}

/**
 * 有効なinvoice_itemsから、税率ごとに合算してから切り捨てる消費税額・税込請求額を算出する
 * 純粋関数（DBアクセスなし）。cancelled_at IS NOT NULLの明細は計算から除外する。
 *
 * tax_rateがnullの有効な明細が1件でもある場合は、黙って0%扱いにせず明確な例外を投げる
 * （begin_invoice_document_issue RPC側も同条件で発行自体を拒否しているが、この関数単体でも
 * 同じ防御を行う。呼び出し元がRPCの防御を経由しない場面でも誤った税額が出ないようにするため）。
 */
export function calculateInvoiceTaxSummary(items: TaxableInvoiceItem[]): InvoiceTaxSummary {
  const activeItems = items.filter((item) => item.cancelled_at === null);

  const missingTaxRateCount = activeItems.filter((item) => item.tax_rate === null).length;
  if (missingTaxRateCount > 0) {
    throw new Error(`税率が未設定の明細が${missingTaxRateCount}件あるため、消費税額を計算できません。`);
  }

  const amountByTaxRate = new Map<number, number>();
  let subtotalExTax = 0;
  for (const item of activeItems) {
    const amount = effectiveInvoiceItemAmount(item);
    subtotalExTax += amount;
    const taxRate = item.tax_rate as number;
    amountByTaxRate.set(taxRate, (amountByTaxRate.get(taxRate) ?? 0) + amount);
  }

  const taxBreakdown: InvoiceTaxBreakdownRow[] = [...amountByTaxRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([taxRate, taxableAmount]) => ({
      taxRate,
      taxableAmount,
      taxAmount: floorYen(taxableAmount * taxRate),
    }));

  const totalTax = taxBreakdown.reduce((sum, row) => sum + row.taxAmount, 0);

  return {
    subtotalExTax,
    taxBreakdown,
    totalTax,
    totalIncludingTax: subtotalExTax + totalTax,
  };
}
