import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  validateBillingRegistrationInput,
  generateInvoiceItemsForRecurringRule,
  generateInvoiceItemForOneTimeRule,
  createOneTimeBillingRule,
  createRecurringBillingRule,
  type BillingRegistrationInput,
} from "./generate";

type BillingRuleRow = Database["public"]["Tables"]["billing_rules"]["Row"];

function baseSpotInput(overrides: Partial<BillingRegistrationInput> = {}): BillingRegistrationInput {
  return {
    kind: "spot",
    clientId: "client-1",
    invoiceTitle: "9月分 SNS運用・動画制作費",
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
    invoiceTitle: "月次SNS運用費",
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

  it("件名未入力は拒否", () => {
    const { data, error } = validateBillingRegistrationInput(baseSpotInput({ invoiceTitle: "" }));
    expect(data).toBeNull();
    expect(error).toMatch(/件名/);
  });

  it("件名が空白のみの場合も拒否", () => {
    const { error } = validateBillingRegistrationInput(baseSpotInput({ invoiceTitle: "   " }));
    expect(error).toMatch(/件名/);
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

// ---------------------------------------------------------------------------
// 運用ルール「当面すべての請求明細は税率10%」(2026-10-07決定)の回帰テスト。
// 新規invoice_items INSERTは recurring/one_time いずれも insertInvoiceItemIfMissing
// （generate.ts内部の共通関数、/management/billing・クライアント詳細画面の両方の
// 新規登録フォームもcreateOneTimeBillingRule/createRecurringBillingRule経由で
// 最終的にここへ到達する）1箇所だけを通るため、recurring/one_timeの2経路を
// このテストで検証すれば「通常新規明細はすべて10%」を実質的にカバーする。
// ---------------------------------------------------------------------------

interface ChainNode extends PromiseLike<unknown> {
  select: () => ChainNode;
  eq: () => ChainNode;
  is: () => ChainNode;
  gte: () => ChainNode;
  order: () => ChainNode;
  maybeSingle: () => Promise<unknown>;
  single: () => Promise<unknown>;
}

/** 呼び出し元のeq/is/select等のチェーンを素通りさせ、最後に固定の結果を返す汎用スタブ。 */
function chainResult(finalResult: unknown): ChainNode {
  const node: ChainNode = {
    select: () => node,
    eq: () => node,
    is: () => node,
    gte: () => node,
    order: () => node,
    maybeSingle: async () => finalResult,
    single: async () => finalResult,
    then: (resolve, reject) => Promise.resolve(finalResult).then(resolve, reject),
  };
  return node;
}

function createGenerateSupabaseStub() {
  const invoiceItemInserts: Record<string, unknown>[] = [];
  const invoiceInserts: Record<string, unknown>[] = [];
  const billingRuleInserts: Record<string, unknown>[] = [];
  let invoiceSeq = 0;
  let billingRuleSeq = 0;

  const from = vi.fn((table: string) => {
    if (table === "client_billing_profiles") {
      return { select: () => chainResult({ data: null, error: null }) };
    }
    if (table === "clients_view") {
      return {
        select: () =>
          chainResult({ data: { company_name: "テスト株式会社", contract_end_date: null }, error: null }),
      };
    }
    if (table === "invoices") {
      return {
        // 常に「既存invoiceなし」を返す（ローリング窓の各月・スポットのどの月でも新規作成される）。
        select: () => chainResult({ data: null, error: null }),
        insert: (payload: Record<string, unknown>) => {
          invoiceInserts.push(payload);
          invoiceSeq += 1;
          return chainResult({ data: { id: `invoice-${invoiceSeq}`, status: "planned" }, error: null });
        },
      };
    }
    if (table === "invoice_items") {
      return {
        // 常に「既存明細なし」を返す（二重生成ガードはこのテストの対象外）。
        select: () => chainResult({ data: null, error: null }),
        insert: (payload: Record<string, unknown>) => {
          invoiceItemInserts.push(payload);
          return chainResult({ error: null });
        },
      };
    }
    if (table === "billing_rules") {
      return {
        // 管理画面（/management/billing・クライアント詳細画面）の新規登録フォームが
        // createOneTimeBillingRule/createRecurringBillingRule経由でINSERTする先。
        // INSERTしたpayloadそのものへidを足して返すだけ（downstreamはpayloadの
        // フィールドしか参照しないため、実テーブルと同じ形を再現する必要はない）。
        insert: (payload: Record<string, unknown>) => {
          billingRuleInserts.push(payload);
          billingRuleSeq += 1;
          return chainResult({ data: { ...payload, id: `rule-${billingRuleSeq}` }, error: null });
        },
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  const client = { from } as unknown as SupabaseClient<Database>;
  return { client, invoiceItemInserts, invoiceInserts, billingRuleInserts };
}

function baseBillingRuleRow(overrides: Partial<BillingRuleRow> = {}): BillingRuleRow {
  return {
    id: "rule-1",
    client_id: "client-1",
    billing_type: "recurring",
    subject: "Instagram運用",
    description: null,
    quantity: 1,
    unit_price_ex_tax: 30000,
    notes: null,
    valid_from: "2020-01-01",
    valid_to: null,
    revenue_month_offset_months: 0,
    one_time_billing_month: null,
    one_time_revenue_month: null,
    is_active: true,
    created_by_staff_id: "staff-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    cancelled_at: null,
    cancelled_by_staff_id: null,
    cancel_reason: null,
    invoice_title: "月次SNS運用費",
    ...overrides,
  };
}

describe("新規invoice_itemsのtax_rate初期値（運用ルール: 当面すべて税率10%）", () => {
  it("recurring ruleから生成される明細はtax_rate=0.10で保存される", async () => {
    const { client, invoiceItemInserts } = createGenerateSupabaseStub();
    const rule = baseBillingRuleRow({ billing_type: "recurring" });

    const summary = await generateInvoiceItemsForRecurringRule(client, rule);

    expect(summary.insertedCount).toBeGreaterThan(0);
    expect(invoiceItemInserts.length).toBe(summary.insertedCount);
    for (const payload of invoiceItemInserts) {
      expect(payload.tax_rate).toBe(0.1);
      expect(payload.tax_category).toBeNull();
    }
  });

  it("one_time ruleから生成される明細はtax_rate=0.10で保存される", async () => {
    const { client, invoiceItemInserts } = createGenerateSupabaseStub();
    const rule = baseBillingRuleRow({
      billing_type: "one_time",
      valid_from: null,
      one_time_billing_month: "2026-09-01",
      one_time_revenue_month: "2026-09-01",
    });

    const result = await generateInvoiceItemForOneTimeRule(client, rule);

    expect(result.skipped).toBe(false);
    expect(invoiceItemInserts).toHaveLength(1);
    expect(invoiceItemInserts[0].tax_rate).toBe(0.1);
    expect(invoiceItemInserts[0].tax_category).toBeNull();
  });

  it("管理画面（スポット新規登録: createOneTimeBillingRule）経由の明細もtax_rate=0.10になる", async () => {
    const { client, invoiceItemInserts } = createGenerateSupabaseStub();

    const result = await createOneTimeBillingRule(
      client,
      {
        clientId: "client-1",
        invoiceTitle: "9月分 スポット対応費",
        subject: "追加撮影",
        description: null,
        quantity: 1,
        unitPriceExTax: 50000,
        billingMonthIso: "2026-09-01",
        revenueMonthIso: "2026-09-01",
        notes: null,
      },
      "staff-1",
    );

    expect(result.error).toBeNull();
    expect(invoiceItemInserts).toHaveLength(1);
    expect(invoiceItemInserts[0].tax_rate).toBe(0.1);
  });

  it("管理画面（定期新規登録: createRecurringBillingRule）経由の明細もtax_rate=0.10になる", async () => {
    const { client, invoiceItemInserts } = createGenerateSupabaseStub();

    const result = await createRecurringBillingRule(
      client,
      {
        clientId: "client-1",
        invoiceTitle: "月次SNS運用費",
        subject: "Instagram運用",
        description: null,
        quantity: 1,
        unitPriceExTax: 30000,
        validFromIso: "2020-01-01",
        validToIso: null,
        revenueMonthOffsetMonths: 0,
        notes: null,
      },
      "staff-1",
    );

    expect(result.error).toBeNull();
    expect(invoiceItemInserts.length).toBeGreaterThan(0);
    for (const payload of invoiceItemInserts) {
      expect(payload.tax_rate).toBe(0.1);
    }
  });
});
