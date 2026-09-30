import { describe, expect, it } from "vitest";
import { validateExpenseBatchConfirmInput, type ExpenseBatchConfirmInput, type ExpenseLineItemInput } from "./expenses";

function baseItem(overrides: Partial<ExpenseLineItemInput> = {}): ExpenseLineItemInput {
  return {
    description: "コピー用紙",
    amount: 3000,
    taxAmount: 300,
    accountCategoryCandidate: "消耗品費",
    accountCategoryConfirmed: "消耗品費",
    taxCategoryCandidate: "課税仕入10%",
    taxCategoryConfirmed: "課税仕入10%",
    ...overrides,
  };
}

function baseInput(overrides: Partial<ExpenseBatchConfirmInput> = {}): ExpenseBatchConfirmInput {
  return {
    documentId: "doc-1",
    transactionDate: "2026-09-15",
    vendorName: "株式会社テスト文具",
    paymentMethod: "クレジットカード",
    documentAmountCandidate: 3300,
    items: [baseItem()],
    ...overrides,
  };
}

describe("validateExpenseBatchConfirmInput（経費確定・複数明細の入力チェック）", () => {
  it("1明細のみでも受理する", () => {
    const { data, error } = validateExpenseBatchConfirmInput(baseInput());
    expect(error).toBeNull();
    expect(data?.items).toHaveLength(1);
  });

  it("複数明細（1書類=複数の勘定科目）を受理する", () => {
    const { data, error } = validateExpenseBatchConfirmInput(
      baseInput({
        documentAmountCandidate: 80000,
        items: [
          baseItem({ description: "広告出稿費", amount: 30000, accountCategoryConfirmed: "広告宣伝費" }),
          baseItem({ description: "動画編集外注", amount: 50000, accountCategoryConfirmed: "外注費" }),
        ],
      }),
    );
    expect(error).toBeNull();
    expect(data?.items).toHaveLength(2);
    expect(data?.items[0].accountCategoryConfirmed).toBe("広告宣伝費");
    expect(data?.items[1].accountCategoryConfirmed).toBe("外注費");
  });

  it("証憑なし（documentId=null）の手入力経費も受理する", () => {
    const { data, error } = validateExpenseBatchConfirmInput(baseInput({ documentId: null }));
    expect(error).toBeNull();
    expect(data?.documentId).toBeNull();
  });

  it("取引日が未入力なら拒否", () => {
    const { error } = validateExpenseBatchConfirmInput(baseInput({ transactionDate: "" }));
    expect(error).toMatch(/取引日/);
  });

  it("取引先が未入力なら拒否", () => {
    const { error } = validateExpenseBatchConfirmInput(baseInput({ vendorName: "  " }));
    expect(error).toMatch(/取引先/);
  });

  it("明細が0件なら拒否", () => {
    const { error } = validateExpenseBatchConfirmInput(baseInput({ items: [] }));
    expect(error).toMatch(/明細/);
  });

  it("明細の金額が未入力(null)なら拒否", () => {
    const { error } = validateExpenseBatchConfirmInput(baseInput({ items: [baseItem({ amount: null })] }));
    expect(error).toMatch(/金額/);
  });

  it("明細の金額がマイナスなら拒否", () => {
    const { error } = validateExpenseBatchConfirmInput(baseInput({ items: [baseItem({ amount: -100 })] }));
    expect(error).toMatch(/金額/);
  });

  it("明細の税額がマイナスなら拒否", () => {
    const { error } = validateExpenseBatchConfirmInput(baseInput({ items: [baseItem({ taxAmount: -1 })] }));
    expect(error).toMatch(/税額/);
  });

  it("明細の勘定科目(確定)が未入力なら拒否", () => {
    const { error } = validateExpenseBatchConfirmInput(baseInput({ items: [baseItem({ accountCategoryConfirmed: "" })] }));
    expect(error).toMatch(/勘定科目/);
  });

  it("2件目の明細のみ不正な場合もそこを指して拒否する", () => {
    const { error } = validateExpenseBatchConfirmInput(
      baseInput({ items: [baseItem(), baseItem({ accountCategoryConfirmed: "" })] }),
    );
    expect(error).toMatch(/明細2/);
  });

  it("税額・支払方法・摘要が未入力でも受理する（Phase1では必須にしない）", () => {
    const { data, error } = validateExpenseBatchConfirmInput(
      baseInput({ paymentMethod: null, items: [baseItem({ taxAmount: null, description: null })] }),
    );
    expect(error).toBeNull();
    expect(data?.items[0].taxAmount).toBeNull();
  });
});
