import "server-only";

// invoice_documents.snapshot（jsonb）と同じ構造を型安全に扱うための型定義。
// Phase2AのRPC(begin_invoice_document_issue)が生成するsnapshotの形に一致させる。
// 税額・税込合計はPhase2Aで端数処理ルールを未確定にしているため、ここでは一切保持しない
// （tax_excluded_amount/tax_rateまでに留める。勝手に補完しない）。

export interface InvoiceDocumentSnapshotIssuer {
  company_name: string;
  postal_code: string;
  address: string;
  phone: string;
  email: string;
  invoice_registration_number: string;
  bank_name: string;
  branch_name: string;
  account_type: string;
  account_number: string;
  account_holder_name: string;
}

export interface InvoiceDocumentSnapshotRecipient {
  company_name: string;
  department: string | null;
  contact_name: string | null;
  postal_code: string;
  address: string;
}

export interface InvoiceDocumentSnapshotInvoice {
  invoice_number: string;
  invoice_title: string | null;
  /** 'YYYY-MM-DD' */
  issue_date: string;
  /** 'YYYY-MM-DD' */
  due_date: string;
  /** 'YYYY-MM-DD'（月初日） */
  billing_month: string;
}

export interface InvoiceDocumentSnapshotItem {
  subject: string;
  description: string | null;
  quantity: number;
  unit_price_ex_tax: number;
  tax_excluded_amount: number;
  /** 0.10 = 10%。未設定(null)は許容しない想定だが、型としてはnullも受け取れるようにしておく。 */
  tax_rate: number | null;
  tax_category: string | null;
  /** 'YYYY-MM-DD'（月初日） */
  revenue_month: string;
}

export interface InvoiceDocumentSnapshot {
  issuer: InvoiceDocumentSnapshotIssuer;
  recipient: InvoiceDocumentSnapshotRecipient;
  invoice: InvoiceDocumentSnapshotInvoice;
  items: InvoiceDocumentSnapshotItem[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isDateIso(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validateIssuer(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "issuerが不正です。";
  const v = value as Record<string, unknown>;
  const requiredKeys: (keyof InvoiceDocumentSnapshotIssuer)[] = [
    "company_name",
    "postal_code",
    "address",
    "phone",
    "email",
    "invoice_registration_number",
    "bank_name",
    "branch_name",
    "account_type",
    "account_number",
    "account_holder_name",
  ];
  for (const key of requiredKeys) {
    if (!isNonEmptyString(v[key])) return `issuer.${key}が不正です。`;
  }
  return null;
}

function validateRecipient(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "recipientが不正です。";
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.company_name)) return "recipient.company_nameが不正です。";
  if (!isNonEmptyString(v.postal_code)) return "recipient.postal_codeが不正です。";
  if (!isNonEmptyString(v.address)) return "recipient.addressが不正です。";
  if (!isNullableString(v.department)) return "recipient.departmentが不正です。";
  if (!isNullableString(v.contact_name)) return "recipient.contact_nameが不正です。";
  return null;
}

function validateInvoice(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "invoiceが不正です。";
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.invoice_number)) return "invoice.invoice_numberが不正です。";
  if (!isNullableString(v.invoice_title)) return "invoice.invoice_titleが不正です。";
  if (!isDateIso(v.issue_date)) return "invoice.issue_dateが不正です。";
  if (!isDateIso(v.due_date)) return "invoice.due_dateが不正です。";
  if (!isDateIso(v.billing_month)) return "invoice.billing_monthが不正です。";
  return null;
}

function validateItem(value: unknown, index: number): string | null {
  if (typeof value !== "object" || value === null) return `items[${index}]が不正です。`;
  const v = value as Record<string, unknown>;
  const label = `items[${index}]`;
  if (!isNonEmptyString(v.subject)) return `${label}.subjectが不正です。`;
  if (!isNullableString(v.description)) return `${label}.descriptionが不正です。`;
  if (typeof v.quantity !== "number" || !Number.isFinite(v.quantity)) return `${label}.quantityが不正です。`;
  if (typeof v.unit_price_ex_tax !== "number" || !Number.isFinite(v.unit_price_ex_tax))
    return `${label}.unit_price_ex_taxが不正です。`;
  if (typeof v.tax_excluded_amount !== "number" || !Number.isFinite(v.tax_excluded_amount))
    return `${label}.tax_excluded_amountが不正です。`;
  if (v.tax_rate !== null && (typeof v.tax_rate !== "number" || !Number.isFinite(v.tax_rate)))
    return `${label}.tax_rateが不正です。`;
  if (!isNullableString(v.tax_category)) return `${label}.tax_categoryが不正です。`;
  if (!isDateIso(v.revenue_month)) return `${label}.revenue_monthが不正です。`;
  return null;
}

/**
 * invoice_documents.snapshot（jsonbから取得したunknown値）がPDF生成に使える構造かを検証する。
 * DBへは一切アクセスしない純粋関数。不正な場合はエラーメッセージを返す（例外は投げない）。
 */
export function validateInvoiceDocumentSnapshot(
  value: unknown,
): { data: InvoiceDocumentSnapshot | null; error: string | null } {
  if (typeof value !== "object" || value === null) {
    return { data: null, error: "snapshotがオブジェクトではありません。" };
  }
  const v = value as Record<string, unknown>;

  const issuerError = validateIssuer(v.issuer);
  if (issuerError) return { data: null, error: issuerError };

  const recipientError = validateRecipient(v.recipient);
  if (recipientError) return { data: null, error: recipientError };

  const invoiceError = validateInvoice(v.invoice);
  if (invoiceError) return { data: null, error: invoiceError };

  if (!Array.isArray(v.items) || v.items.length === 0) {
    return { data: null, error: "itemsが1件以上必要です。" };
  }
  for (let i = 0; i < v.items.length; i += 1) {
    const itemError = validateItem(v.items[i], i);
    if (itemError) return { data: null, error: itemError };
  }

  return { data: value as InvoiceDocumentSnapshot, error: null };
}
