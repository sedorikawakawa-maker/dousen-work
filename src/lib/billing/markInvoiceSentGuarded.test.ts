import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { markInvoiceSentGuarded } from "./markInvoiceSentGuarded";

function createSupabaseStub(options: {
  invoiceStatus: string | null;
  activeDocumentStatus: string | null;
  rpcError?: { message: string } | null;
}) {
  const rpcCalls: { name: string; args: unknown }[] = [];

  const from = vi.fn((table: string) => {
    if (table === "invoices") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: options.invoiceStatus ? { status: options.invoiceStatus } : null, error: null }),
          }),
        }),
      };
    }
    if (table === "invoice_documents") {
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: async () => ({
                data: options.activeDocumentStatus ? { status: options.activeDocumentStatus } : null,
                error: null,
              }),
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  const rpc = vi.fn(async (name: string, args: unknown) => {
    rpcCalls.push({ name, args });
    return { data: null, error: options.rpcError ?? null };
  });

  const client = { from, rpc } as unknown as SupabaseClient<Database>;
  return { client, rpcCalls };
}

describe("markInvoiceSentGuarded", () => {
  it("prepared + generatedな有効文書がある場合のみmark_invoice_sentを呼ぶ", async () => {
    const { client, rpcCalls } = createSupabaseStub({ invoiceStatus: "prepared", activeDocumentStatus: "generated" });
    const result = await markInvoiceSentGuarded(client, "invoice-1");
    expect(result.error).toBeNull();
    expect(rpcCalls).toEqual([{ name: "mark_invoice_sent", args: { p_invoice_id: "invoice-1" } }]);
  });

  it("invoice.statusがplannedの場合は拒否し、RPCを呼ばない", async () => {
    const { client, rpcCalls } = createSupabaseStub({ invoiceStatus: "planned", activeDocumentStatus: "generated" });
    const result = await markInvoiceSentGuarded(client, "invoice-1");
    expect(result.error).toContain("送付済み");
    expect(rpcCalls).toHaveLength(0);
  });

  it("有効なinvoice_documentが存在しない場合は拒否する（PDF未発行では送付不可）", async () => {
    const { client, rpcCalls } = createSupabaseStub({ invoiceStatus: "prepared", activeDocumentStatus: null });
    const result = await markInvoiceSentGuarded(client, "invoice-1");
    expect(result.error).toContain("発行済み");
    expect(rpcCalls).toHaveLength(0);
  });

  it("有効なinvoice_documentがissuing状態（generated未達）の場合は拒否する", async () => {
    const { client, rpcCalls } = createSupabaseStub({ invoiceStatus: "prepared", activeDocumentStatus: "issuing" });
    const result = await markInvoiceSentGuarded(client, "invoice-1");
    expect(result.error).toContain("発行済み");
    expect(rpcCalls).toHaveLength(0);
  });

  it("対象invoiceが見つからない場合は拒否する", async () => {
    const { client, rpcCalls } = createSupabaseStub({ invoiceStatus: null, activeDocumentStatus: null });
    const result = await markInvoiceSentGuarded(client, "invoice-1");
    expect(result.error).toContain("見つかりません");
    expect(rpcCalls).toHaveLength(0);
  });
});
