import { describe, expect, it } from "vitest";
import { calculateInvoiceTaxSummary, type TaxableInvoiceItem } from "./invoiceTaxSummary";

function item(overrides: Partial<TaxableInvoiceItem> = {}): TaxableInvoiceItem {
  return {
    cancelled_at: null,
    tax_rate: 0.1,
    amount_override: null,
    tax_excluded_amount: 10000,
    ...overrides,
  };
}

describe("calculateInvoiceTaxSummary（税率ごとに合算してから1円未満切り捨て、freee準拠）", () => {
  it("10%のみ: 税抜合計×10%を切り捨てた額が消費税額、税込請求額=税抜+税額", () => {
    const summary = calculateInvoiceTaxSummary([item({ tax_excluded_amount: 50000 })]);
    expect(summary.subtotalExTax).toBe(50000);
    expect(summary.taxBreakdown).toEqual([{ taxRate: 0.1, taxableAmount: 50000, taxAmount: 5000 }]);
    expect(summary.totalTax).toBe(5000);
    expect(summary.totalIncludingTax).toBe(55000);
  });

  it("8%のみ", () => {
    const summary = calculateInvoiceTaxSummary([item({ tax_rate: 0.08, tax_excluded_amount: 50000 })]);
    expect(summary.taxBreakdown).toEqual([{ taxRate: 0.08, taxableAmount: 50000, taxAmount: 4000 }]);
    expect(summary.totalTax).toBe(4000);
    expect(summary.totalIncludingTax).toBe(54000);
  });

  it("0%のみ: 税額は常に0、税込請求額=税抜小計のまま", () => {
    const summary = calculateInvoiceTaxSummary([item({ tax_rate: 0, tax_excluded_amount: 50000 })]);
    expect(summary.taxBreakdown).toEqual([{ taxRate: 0, taxableAmount: 50000, taxAmount: 0 }]);
    expect(summary.totalTax).toBe(0);
    expect(summary.totalIncludingTax).toBe(50000);
  });

  it("10%+8%混在: 税率ごとに別々に合算してから、それぞれ切り捨てる", () => {
    const summary = calculateInvoiceTaxSummary([
      item({ tax_rate: 0.1, tax_excluded_amount: 30000 }),
      item({ tax_rate: 0.1, tax_excluded_amount: 25555 }),
      item({ tax_rate: 0.08, tax_excluded_amount: 10000 }),
    ]);
    expect(summary.subtotalExTax).toBe(65555);
    // 10%対象は30000+25555=55555を合算してから×10%→5555.5→切り捨て5555
    // （行ごとに丸めていれば 30000*0.1=3000 + 25555*0.1=2555.5→2555 の合計5555と
    // 偶然一致してしまうため、下のテストケースで行ごと丸めとの違いを別途検証する）。
    expect(summary.taxBreakdown).toEqual([
      { taxRate: 0.1, taxableAmount: 55555, taxAmount: 5555 },
      { taxRate: 0.08, taxableAmount: 10000, taxAmount: 800 },
    ]);
    expect(summary.totalTax).toBe(6355);
    expect(summary.totalIncludingTax).toBe(71910);
  });

  it("10%+8%+0%混在（将来の複数税率対応）", () => {
    const summary = calculateInvoiceTaxSummary([
      item({ tax_rate: 0.1, tax_excluded_amount: 100000 }),
      item({ tax_rate: 0.08, tax_excluded_amount: 50000 }),
      item({ tax_rate: 0, tax_excluded_amount: 20000 }),
    ]);
    expect(summary.subtotalExTax).toBe(170000);
    expect(summary.taxBreakdown).toEqual([
      { taxRate: 0.1, taxableAmount: 100000, taxAmount: 10000 },
      { taxRate: 0.08, taxableAmount: 50000, taxAmount: 4000 },
      { taxRate: 0, taxableAmount: 20000, taxAmount: 0 },
    ]);
    expect(summary.totalTax).toBe(14000);
    expect(summary.totalIncludingTax).toBe(184000);
  });

  it("税抜合計55,555円・税率10%の端数処理: 5,555.5円→5,555円、税込61,110円", () => {
    const summary = calculateInvoiceTaxSummary([item({ tax_excluded_amount: 55555 })]);
    expect(summary.taxBreakdown[0].taxAmount).toBe(5555);
    expect(summary.totalIncludingTax).toBe(61110);
  });

  it("明細1行ごとには丸めない（合算後に初めて切り捨てることを、行ごと丸めとの結果の違いで検証する）", () => {
    // 行ごとに丸めた場合: 30000*0.1=3000(丸め不要) + 25555*0.1=2555.5→2555 = 合計5555
    // 合算後に丸めた場合: (30000+25555)*0.1=5555.5→5555
    // この例は偶然どちらも5555になるため、丸め方向が逆転する組み合わせで明確に区別する。
    // 12345円 + 12345円 を10%: 行ごとなら 1234.5→1234 を2件で2468。合算後なら24690*0.1=2469→2469。
    const summary = calculateInvoiceTaxSummary([
      item({ tax_excluded_amount: 12345 }),
      item({ tax_excluded_amount: 12345 }),
    ]);
    const perLineRoundedTotal = Math.floor(12345 * 0.1) * 2; // 1234 * 2 = 2468(行ごと丸めなら得られる誤った値)
    expect(summary.taxBreakdown[0].taxAmount).toBe(2469);
    expect(summary.taxBreakdown[0].taxAmount).not.toBe(perLineRoundedTotal);
  });

  it("cancelled_atが設定された明細は計算対象から除外する", () => {
    const summary = calculateInvoiceTaxSummary([
      item({ tax_excluded_amount: 50000 }),
      item({ tax_excluded_amount: 999999, cancelled_at: "2026-10-01T00:00:00Z" }),
    ]);
    expect(summary.subtotalExTax).toBe(50000);
    expect(summary.taxBreakdown).toEqual([{ taxRate: 0.1, taxableAmount: 50000, taxAmount: 5000 }]);
  });

  it("amount_overrideが設定されている場合はそちらを税抜金額として使う（effectiveInvoiceItemAmountの優先順位を維持）", () => {
    const summary = calculateInvoiceTaxSummary([item({ tax_excluded_amount: 50000, amount_override: 40000 })]);
    expect(summary.subtotalExTax).toBe(40000);
    expect(summary.taxBreakdown).toEqual([{ taxRate: 0.1, taxableAmount: 40000, taxAmount: 4000 }]);
  });

  it("tax_rate=nullの有効な明細が1件でもあれば明確な例外を投げる（黙って0%扱いにしない）", () => {
    expect(() =>
      calculateInvoiceTaxSummary([item({ tax_rate: 0.1 }), item({ tax_rate: null })]),
    ).toThrowError(/税率が未設定/);
  });

  it("tax_rate=nullでもcancelled_at設定済みなら除外されるため例外にならない", () => {
    expect(() =>
      calculateInvoiceTaxSummary([item({ tax_rate: 0.1 }), item({ tax_rate: null, cancelled_at: "2026-10-01T00:00:00Z" })]),
    ).not.toThrow();
  });
});
