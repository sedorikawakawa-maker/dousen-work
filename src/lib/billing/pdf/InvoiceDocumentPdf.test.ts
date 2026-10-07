import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { InvoiceDocumentPdf } from "./InvoiceDocumentPdf";
import type { InvoiceDocumentSnapshot } from "./snapshot";
import { calculateInvoiceTaxSummary } from "@/lib/billing/invoiceTaxSummary";

// InvoiceDocumentPdfは@react-pdf/rendererのプリミティブ(Document/Page/View/Text)を使った
// 純粋なReact要素ツリーを返す関数。実際のPDFバイナリへレンダリングすると、埋め込み日本語
// フォントがIdentity-H(CID)エンコードされるため、生成後のバッファから"税込請求額"等の
// テキストを単純な文字列検索で見つけることはできない（generateInvoicePdf.test.tsの既存コメント
// 参照）。そのため、ここではPDFへレンダリングする前のReact要素ツリーをそのまま走査して、
// <Text>要素の子テキストに期待する表示内容が含まれているかを検証する。

/**
 * InvoiceDocumentPdfは子として素のJSX(View/Text)だけでなく、RecipientBlock/ItemsTable/
 * TaxSummarySection等の関数コンポーネントも使う。react-pdfのレンダラーを経由せずに
 * ツリーの中身を見るには、type が関数のReact要素を見つけたらその関数自身を呼び出して
 * 展開する必要がある（通常のReactレンダラーが内部で行うのと同じこと）。
 */
function collectTexts(node: ReactNode, acc: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return acc;
  if (typeof node === "string" || typeof node === "number") {
    acc.push(String(node));
    return acc;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectTexts(child, acc);
    return acc;
  }
  if (typeof node === "object" && "type" in (node as ReactElement)) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    if (typeof element.type === "function") {
      const rendered = (element.type as (props: unknown) => ReactNode)(element.props);
      collectTexts(rendered, acc);
      return acc;
    }
    collectTexts(element.props?.children, acc);
    return acc;
  }
  return acc;
}

function baseSnapshot(): InvoiceDocumentSnapshot {
  return {
    issuer: {
      company_name: "株式会社ドウセン",
      postal_code: "100-0001",
      address: "東京都千代田区1-1-1",
      phone: "03-0000-0000",
      email: "info@example.com",
      invoice_registration_number: "T1234567890123",
      bank_name: "テスト銀行",
      branch_name: "テスト支店",
      account_type: "普通",
      account_number: "1234567",
      account_holder_name: "カ）ドウセン",
    },
    recipient: {
      company_name: "株式会社サンプル",
      department: null,
      contact_name: null,
      postal_code: "160-0001",
      address: "東京都新宿区1-1-1",
    },
    invoice: {
      invoice_number: "202610-0001",
      invoice_title: "10月分ご請求",
      issue_date: "2026-10-05",
      due_date: "2026-11-04",
      billing_month: "2026-10-01",
    },
    items: [
      {
        subject: "Instagram運用支援",
        description: null,
        quantity: 1,
        unit_price_ex_tax: 55555,
        tax_excluded_amount: 55555,
        tax_rate: 0.1,
        tax_category: null,
        revenue_month: "2026-10-01",
      },
    ],
  };
}

function taxableItemsFromSnapshot(snapshot: InvoiceDocumentSnapshot) {
  return snapshot.items.map((item) => ({
    cancelled_at: null,
    tax_rate: item.tax_rate,
    amount_override: null,
    tax_excluded_amount: item.tax_excluded_amount,
  }));
}

describe("InvoiceDocumentPdf（税額表示）", () => {
  it("税抜小計・税率別対象額・消費税額・税込請求額のラベルと金額を表示する", () => {
    const snapshot = baseSnapshot();
    const taxSummary = calculateInvoiceTaxSummary(taxableItemsFromSnapshot(snapshot));
    const tree = InvoiceDocumentPdf({ snapshot, taxSummary });
    // 同じTextの子同士は区切り文字無しで結合する（実際の表示でも"10%"と"対象"の間に
    // 自動的なスペースや改行は入らず隣接表示されるため、抽出テキストもそれに合わせる）。
    const text = collectTexts(tree).join("");

    expect(text).toContain("税抜小計");
    expect(text).toContain("¥55,555");
    expect(text).toContain("10%対象");
    expect(text).toContain("10%消費税");
    expect(text).toContain("¥5,555");
    expect(text).toContain("消費税合計");
    expect(text).toContain("税込請求額");
    expect(text).toContain("¥61,110");
    // Phase2Cの「正式な計算は未実装」という旧注記は削除されている。
    expect(text).not.toContain("Phase2C");
    expect(text).not.toContain("正式な計算");
  });

  it("10%+8%混在の場合、両方の税率の対象額・消費税額を表示する", () => {
    const snapshot = baseSnapshot();
    snapshot.items = [
      { ...snapshot.items[0], tax_rate: 0.1, tax_excluded_amount: 100000 },
      { ...snapshot.items[0], tax_rate: 0.08, tax_excluded_amount: 50000 },
    ];
    const taxSummary = calculateInvoiceTaxSummary(taxableItemsFromSnapshot(snapshot));
    const tree = InvoiceDocumentPdf({ snapshot, taxSummary });
    // 同じTextの子同士は区切り文字無しで結合する（実際の表示でも"10%"と"対象"の間に
    // 自動的なスペースや改行は入らず隣接表示されるため、抽出テキストもそれに合わせる）。
    const text = collectTexts(tree).join("");

    expect(text).toContain("10%対象");
    expect(text).toContain("10%消費税");
    expect(text).toContain("8%対象");
    expect(text).toContain("8%消費税");
    expect(text).toContain("¥150,000"); // 税抜小計
    expect(text).toContain("¥14,000"); // 消費税合計 (10000+4000)
    expect(text).toContain("¥164,000"); // 税込請求額
  });

  it("0%のみの場合も不自然にならず、0%対象・税込請求額=税抜小計を表示する", () => {
    const snapshot = baseSnapshot();
    snapshot.items = [{ ...snapshot.items[0], tax_rate: 0, tax_excluded_amount: 30000 }];
    const taxSummary = calculateInvoiceTaxSummary(taxableItemsFromSnapshot(snapshot));
    const tree = InvoiceDocumentPdf({ snapshot, taxSummary });
    // 同じTextの子同士は区切り文字無しで結合する（実際の表示でも"10%"と"対象"の間に
    // 自動的なスペースや改行は入らず隣接表示されるため、抽出テキストもそれに合わせる）。
    const text = collectTexts(tree).join("");

    expect(text).toContain("0%対象");
    expect(text).toContain("0%消費税");
    expect(text).toContain("¥30,000");
    // 10%/8%の対象行は、該当する明細が無い場合は表示しない（不自然な0円行を出さない）。
    expect(text).not.toContain("10%対象");
    expect(text).not.toContain("8%対象");
  });

  it("税込請求額は明細の直前（冒頭に近い位置）にも大きく表示する", () => {
    const snapshot = baseSnapshot();
    const taxSummary = calculateInvoiceTaxSummary(taxableItemsFromSnapshot(snapshot));
    const tree = InvoiceDocumentPdf({ snapshot, taxSummary });
    const texts = collectTexts(tree);
    const titleIndex = texts.indexOf("請求書");
    const grandTotalLabelIndex = texts.indexOf("税込請求額");
    const itemSubjectIndex = texts.indexOf("Instagram運用支援");

    expect(titleIndex).toBeGreaterThanOrEqual(0);
    expect(grandTotalLabelIndex).toBeGreaterThan(titleIndex);
    // 冒頭側の税込請求額表示は、明細テーブルの内容より先に出現する。
    expect(grandTotalLabelIndex).toBeLessThan(itemSubjectIndex);
  });
});
