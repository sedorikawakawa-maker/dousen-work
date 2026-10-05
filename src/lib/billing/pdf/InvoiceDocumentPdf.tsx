import "server-only";

import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { InvoiceDocumentSnapshot } from "./snapshot";
import { INVOICE_FONT_FAMILY } from "./fonts";
import { formatJapaneseDate, formatJapaneseMonth, formatQuantity, formatTaxRate, formatYen } from "./format";

// Phase2B: レイアウトはA4縦1枚を基本としつつ、明細が多い場合はreact-pdfの自動改ページに委ねる
// （Viewへ明示的な高さ指定をしないことで、明細行が増えればPageまたぎで自然に折り返す）。
// 税額・税込合計はPhase2Aで端数処理ルールが未確定のため表示しない（9参照）。デザインは
// 凝りすぎず、読みやすさ・文字化けゼロ・改ページ安定を優先する。

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
  subtotalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
    paddingHorizontal: 3,
  },
  subtotalLabel: { marginRight: 12 },
  subtotalValue: { fontWeight: "bold" },
  taxNote: {
    marginTop: 4,
    fontSize: 8,
    color: "#666666",
    textAlign: "right",
  },
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

export function InvoiceDocumentPdf({ snapshot }: { snapshot: InvoiceDocumentSnapshot }) {
  const subtotalExTax = snapshot.items.reduce((sum, item) => sum + item.tax_excluded_amount, 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>請求書</Text>

        <View style={styles.topRow}>
          <RecipientBlock recipient={snapshot.recipient} />
          <InvoiceInfoBlock invoice={snapshot.invoice} />
        </View>

        {snapshot.invoice.invoice_title ? (
          <View style={styles.invoiceTitleBlock}>
            <Text style={styles.invoiceTitleLabel}>件名</Text>
            <Text style={styles.invoiceTitleValue}>{snapshot.invoice.invoice_title}</Text>
          </View>
        ) : null}

        <ItemsTable items={snapshot.items} />

        <View style={styles.subtotalRow}>
          <Text style={styles.subtotalLabel}>税抜小計</Text>
          <Text style={styles.subtotalValue}>{formatYen(subtotalExTax)}</Text>
        </View>
        <Text style={styles.taxNote}>消費税額・税込合計の正式な計算はPhase2C以降で実装します（本書には含まれません）。</Text>

        <View style={styles.bottomSection}>
          <BankBlock issuer={snapshot.issuer} />
          <IssuerBlock issuer={snapshot.issuer} />
        </View>
      </Page>
    </Document>
  );
}
