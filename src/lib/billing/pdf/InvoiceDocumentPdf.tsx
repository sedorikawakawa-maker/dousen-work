import "server-only";

import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { InvoiceDocumentSnapshot } from "./snapshot";
import type { InvoiceTaxSummary } from "@/lib/billing/invoiceTaxSummary";
import { INVOICE_FONT_FAMILY } from "./fonts";
import { formatJapaneseDate, formatJapaneseMonth, formatQuantity, formatTaxRate, formatYen } from "./format";

// Phase2B: レイアウトはA4縦1枚を基本としつつ、明細が多い場合はreact-pdfの自動改ページに委ねる
// （Viewへ明示的な高さ指定をしないことで、明細行が増えればPageまたぎで自然に折り返す）。
// 消費税額・税込請求額（2026-10-07決定、freee準拠）はtaxSummaryとして呼び出し元
// （generateInvoicePdf）から渡される（snapshot.itemsだけから計算済み。このコンポーネント内では
// 一切再計算しない）。デザインは凝りすぎず、読みやすさ・文字化けゼロ・改ページ安定を優先する。

const styles = StyleSheet.create({
  page: {
    fontFamily: INVOICE_FONT_FAMILY,
    fontSize: 9,
    padding: 36,
    color: "#111111",
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 20,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  recipientBlock: {
    width: "55%",
  },
  recipientCompanyName: {
    fontSize: 13,
    fontWeight: "bold",
    marginBottom: 2,
  },
  recipientLine: {
    fontSize: 9,
    marginBottom: 1,
  },
  invoiceInfoBlock: {
    width: "40%",
  },
  invoiceInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  invoiceInfoLabel: {
    color: "#444444",
  },
  invoiceTitleBlock: {
    marginBottom: 12,
  },
  invoiceTitleLabel: {
    fontSize: 9,
    color: "#444444",
  },
  invoiceTitleValue: {
    fontSize: 12,
    fontWeight: "bold",
  },
  table: {
    marginTop: 8,
    borderTop: "1pt solid #333333",
    borderBottom: "1pt solid #333333",
  },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottom: "0.5pt solid #333333",
    paddingVertical: 4,
    backgroundColor: "#f2f2f2",
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "0.5pt solid #cccccc",
    paddingVertical: 4,
  },
  cellSubject: { width: "26%", paddingHorizontal: 3 },
  cellDescription: { width: "22%", paddingHorizontal: 3 },
  cellQuantity: { width: "10%", paddingHorizontal: 3, textAlign: "right" },
  cellUnitPrice: { width: "14%", paddingHorizontal: 3, textAlign: "right" },
  cellAmount: { width: "14%", paddingHorizontal: 3, textAlign: "right" },
  cellTaxRate: { width: "7%", paddingHorizontal: 3, textAlign: "right" },
  cellRevenueMonth: { width: "7%", paddingHorizontal: 3, textAlign: "right" },
  tableHeaderText: { fontWeight: "bold", fontSize: 8 },
  grandTotalBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
    marginBottom: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderTop: "1.5pt solid #111111",
    borderBottom: "1.5pt solid #111111",
    backgroundColor: "#f2f2f2",
  },
  grandTotalLabel: { fontSize: 11, fontWeight: "bold" },
  grandTotalValue: { fontSize: 16, fontWeight: "bold" },
  taxSummarySection: {
    marginTop: 8,
    alignSelf: "flex-end",
    width: "55%",
  },
  taxSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  subtotalLabel: { marginRight: 12 },
  subtotalValue: { fontWeight: "bold" },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
    paddingHorizontal: 3,
    paddingVertical: 4,
    borderTop: "1pt solid #333333",
  },
  grandTotalRowLabel: { fontSize: 11, fontWeight: "bold" },
  grandTotalRowValue: { fontSize: 11, fontWeight: "bold" },
  bottomSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 28,
  },
  bankBlock: {
    width: "48%",
  },
  sectionHeading: {
    fontSize: 10,
    fontWeight: "bold",
    marginBottom: 4,
  },
  issuerBlock: {
    width: "48%",
  },
  issuerLine: {
    fontSize: 8,
    marginBottom: 1,
  },
});

function RecipientBlock({ recipient }: { recipient: InvoiceDocumentSnapshot["recipient"] }) {
  return (
    <View style={styles.recipientBlock}>
      <Text style={styles.recipientCompanyName}>{recipient.company_name} 御中</Text>
      {recipient.department ? <Text style={styles.recipientLine}>{recipient.department}</Text> : null}
      {recipient.contact_name ? <Text style={styles.recipientLine}>{recipient.contact_name} 様</Text> : null}
      <Text style={styles.recipientLine}>〒{recipient.postal_code}</Text>
      <Text style={styles.recipientLine}>{recipient.address}</Text>
    </View>
  );
}

function InvoiceInfoBlock({ invoice }: { invoice: InvoiceDocumentSnapshot["invoice"] }) {
  return (
    <View style={styles.invoiceInfoBlock}>
      <View style={styles.invoiceInfoRow}>
        <Text style={styles.invoiceInfoLabel}>請求書番号</Text>
        <Text>{invoice.invoice_number}</Text>
      </View>
      <View style={styles.invoiceInfoRow}>
        <Text style={styles.invoiceInfoLabel}>発行日</Text>
        <Text>{formatJapaneseDate(invoice.issue_date)}</Text>
      </View>
      <View style={styles.invoiceInfoRow}>
        <Text style={styles.invoiceInfoLabel}>支払期限</Text>
        <Text>{formatJapaneseDate(invoice.due_date)}</Text>
      </View>
      <View style={styles.invoiceInfoRow}>
        <Text style={styles.invoiceInfoLabel}>請求月</Text>
        <Text>{formatJapaneseMonth(invoice.billing_month)}</Text>
      </View>
    </View>
  );
}

function ItemsTable({ items }: { items: InvoiceDocumentSnapshot["items"] }) {
  return (
    <View style={styles.table}>
      <View style={styles.tableHeaderRow}>
        <Text style={[styles.cellSubject, styles.tableHeaderText]}>摘要</Text>
        <Text style={[styles.cellDescription, styles.tableHeaderText]}>説明</Text>
        <Text style={[styles.cellQuantity, styles.tableHeaderText]}>数量</Text>
        <Text style={[styles.cellUnitPrice, styles.tableHeaderText]}>単価</Text>
        <Text style={[styles.cellAmount, styles.tableHeaderText]}>税抜金額</Text>
        <Text style={[styles.cellTaxRate, styles.tableHeaderText]}>税率</Text>
        <Text style={[styles.cellRevenueMonth, styles.tableHeaderText]}>売上月</Text>
      </View>
      {items.map((item, index) => (
        <View style={styles.tableRow} key={index} wrap={false}>
          <Text style={styles.cellSubject}>{item.subject}</Text>
          <Text style={styles.cellDescription}>{item.description ?? ""}</Text>
          <Text style={styles.cellQuantity}>{formatQuantity(item.quantity)}</Text>
          <Text style={styles.cellUnitPrice}>{formatYen(item.unit_price_ex_tax)}</Text>
          <Text style={styles.cellAmount}>{formatYen(item.tax_excluded_amount)}</Text>
          <Text style={styles.cellTaxRate}>{formatTaxRate(item.tax_rate)}</Text>
          <Text style={styles.cellRevenueMonth}>{formatJapaneseMonth(item.revenue_month)}</Text>
        </View>
      ))}
    </View>
  );
}

function IssuerBlock({ issuer }: { issuer: InvoiceDocumentSnapshot["issuer"] }) {
  return (
    <View style={styles.issuerBlock}>
      <Text style={styles.sectionHeading}>発行者</Text>
      <Text style={styles.issuerLine}>{issuer.company_name}</Text>
      <Text style={styles.issuerLine}>〒{issuer.postal_code}</Text>
      <Text style={styles.issuerLine}>{issuer.address}</Text>
      <Text style={styles.issuerLine}>TEL: {issuer.phone}</Text>
      <Text style={styles.issuerLine}>Email: {issuer.email}</Text>
      <Text style={styles.issuerLine}>登録番号: {issuer.invoice_registration_number}</Text>
    </View>
  );
}

function BankBlock({ issuer }: { issuer: InvoiceDocumentSnapshot["issuer"] }) {
  return (
    <View style={styles.bankBlock}>
      <Text style={styles.sectionHeading}>お振込先</Text>
      <Text style={styles.issuerLine}>{issuer.bank_name} {issuer.branch_name}</Text>
      <Text style={styles.issuerLine}>
        {issuer.account_type} {issuer.account_number}
      </Text>
      <Text style={styles.issuerLine}>{issuer.account_holder_name}</Text>
      <Text style={styles.issuerLine}>※恐れ入りますが、お振込手数料はご負担くださいますようお願いいたします。</Text>
    </View>
  );
}

function TaxSummarySection({ taxSummary }: { taxSummary: InvoiceTaxSummary }) {
  return (
    <View style={styles.taxSummarySection} wrap={false}>
      <View style={styles.taxSummaryRow}>
        <Text style={styles.subtotalLabel}>税抜小計</Text>
        <Text style={styles.subtotalValue}>{formatYen(taxSummary.subtotalExTax)}</Text>
      </View>
      {taxSummary.taxBreakdown.map((row) => (
        <View key={row.taxRate}>
          <View style={styles.taxSummaryRow}>
            <Text style={styles.subtotalLabel}>{formatTaxRate(row.taxRate)}対象</Text>
            <Text style={styles.subtotalValue}>{formatYen(row.taxableAmount)}</Text>
          </View>
          <View style={styles.taxSummaryRow}>
            <Text style={styles.subtotalLabel}>{formatTaxRate(row.taxRate)}消費税</Text>
            <Text style={styles.subtotalValue}>{formatYen(row.taxAmount)}</Text>
          </View>
        </View>
      ))}
      <View style={styles.taxSummaryRow}>
        <Text style={styles.subtotalLabel}>消費税合計</Text>
        <Text style={styles.subtotalValue}>{formatYen(taxSummary.totalTax)}</Text>
      </View>
      <View style={styles.grandTotalRow}>
        <Text style={styles.grandTotalRowLabel}>税込請求額</Text>
        <Text style={styles.grandTotalRowValue}>{formatYen(taxSummary.totalIncludingTax)}</Text>
      </View>
    </View>
  );
}

export function InvoiceDocumentPdf({
  snapshot,
  taxSummary,
}: {
  snapshot: InvoiceDocumentSnapshot;
  taxSummary: InvoiceTaxSummary;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>請求書</Text>

        <View style={styles.topRow}>
          <RecipientBlock recipient={snapshot.recipient} />
          <InvoiceInfoBlock invoice={snapshot.invoice} />
        </View>

        {/* 税込請求額は請求書内で最も分かりやすい位置（冒頭・明細の直前）へ大きく表示する。
            明細下部にも同じ値を含む内訳（税抜小計〜税込請求額）を別途表示する。 */}
        <View style={styles.grandTotalBox}>
          <Text style={styles.grandTotalLabel}>税込請求額</Text>
          <Text style={styles.grandTotalValue}>{formatYen(taxSummary.totalIncludingTax)}</Text>
        </View>

        {snapshot.invoice.invoice_title ? (
          <View style={styles.invoiceTitleBlock}>
            <Text style={styles.invoiceTitleLabel}>件名</Text>
            <Text style={styles.invoiceTitleValue}>{snapshot.invoice.invoice_title}</Text>
          </View>
        ) : null}

        <ItemsTable items={snapshot.items} />

        <TaxSummarySection taxSummary={taxSummary} />

        <View style={styles.bottomSection}>
          <BankBlock issuer={snapshot.issuer} />
          <IssuerBlock issuer={snapshot.issuer} />
        </View>
      </Page>
    </Document>
  );
}
