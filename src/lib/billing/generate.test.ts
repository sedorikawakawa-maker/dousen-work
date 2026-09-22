import { describe, expect, it } from "vitest";
import { validateBillingRegistrationInput, type BillingRegistrationInput } from "./generate";

function baseSpotInput(overrides: Partial<BillingRegistrationInput> = {}): BillingRegistrationInput {
  return {
    kind: "spot",
    clientId: "client-1",
    items: [{ subject: "Instagram運用", description: null, quantity: 1, unitPriceExTax: 30000 }],
    billingMonth: "2026-09",
    revenueMonth: "2026-09",
    ...overrides,
  };
}

function baseRecurringInput(overrides: Partial<BillingRegistrationInput> = {}): BillingRegistrationInput {
  return {
    kind: "recurring",
    clientId: "client-1",
    items: [{ subject: "Instagram運用", description: null, quantity: 1, unitPriceExTax: 30000 }],
    validFrom: "2026-10",
    validTo: null,
    ...overrides,
  };
}

describe("validateBillingRegistrationInput（/management/billing 複数摘要登録の入力チェック）", () => {
  it("正常なスポット入力（複数摘要）を受理する", () => {
    const { data, error } = validateBillingRegistrationInput(
      baseSpotInput({
        items: [
          { subject: "Instagram運用", description: null, quantity: 1, unitPriceExTax: 30000 },
          { subject: "動画制作", description: null, quantity: 3, unitPriceExTax: 20000 },
        ],
      }),
    );
    expect(error).toBeNull();
    expect(data?.kind).toBe("spot");
    expect(data?.items).toHaveLength(2);
  });

  it("正常な定期入力（終了月なし=継続中）を受理する", () => {
    const { data, error } = validateBillingRegistrationInput(baseRecurringInput());
    expect(error).toBeNull();
    expect(data?.validFromIso).toBe("2026-10-01");
    expect(data?.validToIso).toBeNull();
  });

  it("正常な定期入力（終了月あり）を受理する", () => {
    const { data, error } = validateBillingRegistrationInput(baseRecurringInput({ validTo: "2027-03" }));
    expect(error).toBeNull();
    expect(data?.validToIso).toBe("2027-03-01");
  });

  it("顧客未選択は拒否", () => {
    const { data, error } = validateBillingRegistrationInput(baseSpotInput({ clientId: "" }));
    expect(data).toBeNull();
    expect(error).toMatch(/顧客/);
  });

  it("摘要0件は拒否", () => {
    const { data, error } = validateBillingRegistrationInput(baseSpotInput({ items: [] }));
    expect(data).toBeNull();
    expect(error).toMatch(/摘要/);
  });

  it("摘要名が空欄なら拒否", () => {
    const { error } = validateBillingRegistrationInput(
      baseSpotInput({ items: [{ subject: "  ", description: null, quantity: 1, unitPriceExTax: 1000 }] }),
    );
    expect(error).toMatch(/摘要名/);
  });

  it("単価未入力（NaN）は拒否", () => {
    const { error } = validateBillingRegistrationInput(
      baseSpotInput({ items: [{ subject: "テスト", description: null, quantity: 1, unitPriceExTax: NaN }] }),
    );
    expect(error).toMatch(/単価/);
  });

  it("単価0円は拒否", () => {
    const { error } = validateBillingRegistrationInput(
      baseSpotInput({ items: [{ subject: "テスト", description: null, quantity: 1, unitPriceExTax: 0 }] }),
    );
    expect(error).toMatch(/単価/);
  });

  it("数量0は拒否", () => {
    const { error } = validateBillingRegistrationInput(
      baseSpotInput({ items: [{ subject: "テスト", description: null, quantity: 0, unitPriceExTax: 1000 }] }),
    );
    expect(error).toMatch(/数量/);
  });

  it("数量マイナスは拒否", () => {
    const { error } = validateBillingRegistrationInput(
      baseSpotInput({ items: [{ subject: "テスト", description: null, quantity: -1, unitPriceExTax: 1000 }] }),
    );
    expect(error).toMatch(/数量/);
  });

  it("複数摘要のうち2件目が不正な場合もそこを指して拒否する", () => {
    const { error } = validateBillingRegistrationInput(
      baseSpotInput({
        items: [
          { subject: "OK", description: null, quantity: 1, unitPriceExTax: 1000 },
          { subject: "", description: null, quantity: 1, unitPriceExTax: 1000 },
        ],
      }),
    );
    expect(error).toMatch(/摘要2/);
  });

  it("スポットで請求月未入力は拒否", () => {
    const { error } = validateBillingRegistrationInput(baseSpotInput({ billingMonth: "" }));
    expect(error).toMatch(/請求月/);
  });

  it("スポットで売上月未入力は拒否", () => {
    const { error } = validateBillingRegistrationInput(baseSpotInput({ revenueMonth: "" }));
    expect(error).toMatch(/売上計上月/);
  });

  it("定期で開始月未入力は拒否", () => {
    const { error } = validateBillingRegistrationInput(baseRecurringInput({ validFrom: "" }));
    expect(error).toMatch(/開始月/);
  });

  it("終了月が開始月より前（不正な終了月）は拒否", () => {
    const { error } = validateBillingRegistrationInput(
      baseRecurringInput({ validFrom: "2026-10", validTo: "2026-09" }),
    );
    expect(error).toMatch(/終了月/);
  });

  it("終了月が開始月と同じ月は許容する（境界値）", () => {
    const { data, error } = validateBillingRegistrationInput(
      baseRecurringInput({ validFrom: "2026-10", validTo: "2026-10" }),
    );
    expect(error).toBeNull();
    expect(data?.validToIso).toBe("2026-10-01");
  });
});
