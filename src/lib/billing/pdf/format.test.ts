import { describe, expect, it } from "vitest";
import { formatJapaneseDate, formatJapaneseMonth, formatQuantity, formatTaxRate, formatYen } from "./format";

describe("formatYen", () => {
  it("3桁区切りで¥記号を付ける", () => {
    expect(formatYen(50000)).toBe("¥50,000");
  });
  it("0円を扱える", () => {
    expect(formatYen(0)).toBe("¥0");
  });
  it("小数は丸めずそのまま表示する", () => {
    expect(formatYen(1234.5)).toBe("¥1,234.5");
  });
});

describe("formatJapaneseDate", () => {
  it("'YYYY-MM-DD'を日本語表記に変換する", () => {
    expect(formatJapaneseDate("2026-10-05")).toBe("2026年10月5日");
  });
  it("月/日の先頭0を付けない", () => {
    expect(formatJapaneseDate("2026-01-01")).toBe("2026年1月1日");
  });
});

describe("formatJapaneseMonth", () => {
  it("月初日文字列を'YYYY年M月'に変換する", () => {
    expect(formatJapaneseMonth("2026-10-01")).toBe("2026年10月");
  });
});

describe("formatTaxRate", () => {
  it("0.10を10%に変換する", () => {
    expect(formatTaxRate(0.1)).toBe("10%");
  });
  it("0.08を8%に変換する", () => {
    expect(formatTaxRate(0.08)).toBe("8%");
  });
  it("nullは'—'を返す", () => {
    expect(formatTaxRate(null)).toBe("—");
  });
});

describe("formatQuantity", () => {
  it("整数はそのまま表示する", () => {
    expect(formatQuantity(1)).toBe("1");
  });
  it("小数はそのまま表示する", () => {
    expect(formatQuantity(1.5)).toBe("1.5");
  });
});
