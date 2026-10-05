import { describe, expect, it } from "vitest";
import { todayIsoJst } from "./invoiceDocuments";

describe("todayIsoJst（発行日算定用のJST今日日付）", () => {
  it("'YYYY-MM-DD'形式を返す", () => {
    expect(todayIsoJst()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("UTC日付ではなくJST(UTC+9)基準の日付になる", () => {
    const utcNow = new Date();
    const jstNow = new Date(utcNow.getTime() + 9 * 60 * 60 * 1000);
    const expected = `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, "0")}-${String(
      jstNow.getUTCDate(),
    ).padStart(2, "0")}`;
    expect(todayIsoJst()).toBe(expected);
  });
});
