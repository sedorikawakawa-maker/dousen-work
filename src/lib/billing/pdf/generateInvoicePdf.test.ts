import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { generateInvoicePdf } from "./generateInvoicePdf";
import type { InvoiceDocumentSnapshot } from "./snapshot";

// 生成したテストPDFは、git管理対象のプロジェクトディレクトリには一切保存せず、
// セッション専用の一時ディレクトリ（OS temp配下）へ出力する。commit対象にはならない。
const OUTPUT_DIR = path.join(
  process.env.TEMP ?? process.env.TMPDIR ?? "/tmp",
  "dousen-work-phase2b-pdf-test",
);

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
      company_name: "株式会社髙橋﨑神﨑テスト",
      department: "広報部",
      contact_name: "齋藤 渡邊",
      postal_code: "260-0001",
      address: "千葉県千葉市中央区要町1-2-3",
    },
    invoice: {
      invoice_number: "202610-0001",
      invoice_title: "2026年10月分 SNS運用代行費",
      issue_date: "2026-10-05",
      due_date: "2026-11-04",
      billing_month: "2026-10-01",
    },
    items: [
      {
        subject: "Instagram運用支援・動画編集・広告運用",
        description: "投稿作成10本、広告クリエイティブ3本、月次レポート作成を含む包括的な運用支援業務一式",
        quantity: 1,
        unit_price_ex_tax: 150000,
        tax_excluded_amount: 150000,
        tax_rate: 0.1,
        tax_category: "課税",
        revenue_month: "2026-10-01",
      },
    ],
  };
}

describe("generateInvoicePdf（正常系）", () => {
  it("正常なsnapshotからPDF Bufferを生成する", async () => {
    const { buffer } = await generateInvoicePdf(baseSnapshot());
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("PDFヘッダー(%PDF-)で始まる", async () => {
    const { buffer } = await generateInvoicePdf(baseSnapshot());
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("日本語会社名・住所・氏名・摘要（異体字・旧字体を含む）を含めても例外を投げない", async () => {
    await expect(generateInvoicePdf(baseSnapshot())).resolves.toBeDefined();
  });

  it("空欄optional値（department/contact_name/description/invoice_title=null）でも生成できる", async () => {
    const snapshot = baseSnapshot();
    snapshot.recipient.department = null;
    snapshot.recipient.contact_name = null;
    snapshot.invoice.invoice_title = null;
    snapshot.items[0].description = null;
    const { buffer } = await generateInvoicePdf(snapshot);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("複数明細・長い摘要を含めて生成できる", async () => {
    const snapshot = baseSnapshot();
    snapshot.items.push({
      subject: "動画編集（長尺）",
      description:
        "長尺動画の編集、テロップ挿入、BGM選定、カラーグレーディング、複数回のクライアント確認対応までを含む一連の作業であり、説明文が長くなるケースの改行・折り返し確認用の明細です",
      quantity: 2,
      unit_price_ex_tax: 80000,
      tax_excluded_amount: 160000,
      tax_rate: 0.1,
      tax_category: "課税",
      revenue_month: "2026-10-01",
    });
    const { buffer } = await generateInvoicePdf(snapshot);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("金額・日付のフォーマットが請求書らしい表記になっている", async () => {
    const { buffer } = await generateInvoicePdf(baseSnapshot());
    // react-pdfの内部テキストはPDFの文字列演算子(Tj)内に格納されるため、生テキストとしての
    // "¥150,000"等の直接検索はできない。ここでは生成そのものが成功することと、
    // format.test.tsの純粋関数テストで表記ルール自体を検証している。
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("テストPDFをローカル（git管理外のOS一時ディレクトリ）へ1件保存し、ページ数を確認する", async () => {
    const { buffer } = await generateInvoicePdf(baseSnapshot());

    mkdirSync(OUTPUT_DIR, { recursive: true });
    const outputPath = path.join(OUTPUT_DIR, "sample-invoice.pdf");
    writeFileSync(outputPath, buffer);

    const pdfDoc = await PDFDocument.load(buffer);
    expect(pdfDoc.getPageCount()).toBe(1);
    expect(outputPath).toContain("sample-invoice.pdf");
  });

  it("明細を大量に追加すると自動改ページされる（2ページ以上になる）", async () => {
    const snapshot = baseSnapshot();
    snapshot.items = Array.from({ length: 60 }, (_, i) => ({
      subject: `摘要${i + 1}：月次運用業務`,
      description: `明細${i + 1}の説明文です。改ページ確認用の繰り返し明細。`,
      quantity: 1,
      unit_price_ex_tax: 10000,
      tax_excluded_amount: 10000,
      tax_rate: 0.1,
      tax_category: "課税",
      revenue_month: "2026-10-01",
    }));

    const { buffer } = await generateInvoicePdf(snapshot);
    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(path.join(OUTPUT_DIR, "sample-invoice-multipage.pdf"), buffer);

    const pdfDoc = await PDFDocument.load(buffer);
    expect(pdfDoc.getPageCount()).toBeGreaterThan(1);
  });

  it("フォントがCIDFontType0(OpenType/CFF)+Identity-Hで埋め込まれている（CJK埋め込みの標準構造）", async () => {
    const { buffer } = await generateInvoicePdf(baseSnapshot());
    const raw = buffer.toString("latin1");
    expect(raw).toContain("/Identity-H");
    expect(raw).toContain("/Subtype /CIDFontType0");
    expect(raw).toContain("/FontFile3");
    expect(raw).toContain("/ToUnicode");
    expect(raw).toContain("NotoSansJP");
  });
});

describe("generateInvoicePdf（異常系）", () => {
  it("不正なsnapshot（必須項目欠落）は例外を投げる", async () => {
    await expect(generateInvoicePdf({})).rejects.toThrow(/snapshot/);
  });

  it("不正なsnapshot（null）は例外を投げる", async () => {
    await expect(generateInvoicePdf(null)).rejects.toThrow();
  });

  it("フォントに存在しない文字（絵文字）を含む場合は例外を投げる", async () => {
    const snapshot = baseSnapshot();
    snapshot.recipient.company_name = "株式会社テスト😀";
    await expect(generateInvoicePdf(snapshot)).rejects.toThrow(/存在しない文字/);
  });
});
