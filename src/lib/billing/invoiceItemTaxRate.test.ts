import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { isValidInvoiceItemTaxRate, setInvoiceItemTaxRate } from "./invoiceItemTaxRate";

describe("isValidInvoiceItemTaxRate", () => {
  it("10%/8%/0%を許可する", () => {
    expect(isValidInvoiceItemTaxRate(0.1)).toBe(true);
    expect(isValidInvoiceItemTaxRate(0.08)).toBe(true);
    expect(isValidInvoiceItemTaxRate(0)).toBe(true);
  });
  it("候補以外の値は拒否する", () => {
    expect(isValidInvoiceItemTaxRate(0.05)).toBe(false);
    expect(isValidInvoiceItemTaxRate(1)).toBe(false);
  });
});

function createSupabaseStub(result: { data: string | null; error: { message: string } | null }) {
  const rpcCalls: { name: string; args: unknown }[] = [];
  const rpc = vi.fn(async (name: string, args: unknown) => {
    rpcCalls.push({ name, args });
    return result;
  });
  const client = { rpc } as unknown as SupabaseClient<Database>;
  return { client, rpcCalls };
}

describe("setInvoiceItemTaxRate（UIからはset_invoice_item_tax_rate RPCを1回だけ呼ぶ）", () => {
  it("不正な税率はRPCを呼ばずに拒否する", async () => {
    const { client, rpcCalls } = createSupabaseStub({ data: null, error: null });
    const result = await setInvoiceItemTaxRate(client, "item-1", 0.05);
    expect(result.error).toBe("税率の指定が不正です。");
    expect(rpcCalls).toHaveLength(0);
  });

  it("10%設定: set_invoice_item_tax_rateを1回だけ正しい引数で呼ぶ", async () => {
    const { client, rpcCalls } = createSupabaseStub({ data: "new-item-id", error: null });
    const result = await setInvoiceItemTaxRate(client, "item-1", 0.1);
    expect(result.error).toBeNull();
    expect(result.newInvoiceItemId).toBe("new-item-id");
    expect(rpcCalls).toEqual([
      { name: "set_invoice_item_tax_rate", args: { p_invoice_item_id: "item-1", p_tax_rate: 0.1, p_tax_category: null } },
    ]);
  });

  it("8%設定も成功する", async () => {
    const { client, rpcCalls } = createSupabaseStub({ data: "new-item-id-2", error: null });
    const result = await setInvoiceItemTaxRate(client, "item-2", 0.08);
    expect(result.error).toBeNull();
    expect(rpcCalls[0].args).toEqual({ p_invoice_item_id: "item-2", p_tax_rate: 0.08, p_tax_category: null });
  });

  it("0%設定も成功する", async () => {
    const { client, rpcCalls } = createSupabaseStub({ data: "new-item-id-3", error: null });
    const result = await setInvoiceItemTaxRate(client, "item-3", 0);
    expect(result.error).toBeNull();
    expect(rpcCalls[0].args).toEqual({ p_invoice_item_id: "item-3", p_tax_rate: 0, p_tax_category: null });
  });

  it("RPCがエラーを返した場合はそのままエラーを返す（UI層で追加のDB操作をしない）", async () => {
    const { client, rpcCalls } = createSupabaseStub({ data: null, error: { message: "この明細は既に税率が設定済みです" } });
    const result = await setInvoiceItemTaxRate(client, "item-1", 0.1);
    expect(result.error).toBe("この明細は既に税率が設定済みです");
    expect(rpcCalls).toHaveLength(1);
  });
});
