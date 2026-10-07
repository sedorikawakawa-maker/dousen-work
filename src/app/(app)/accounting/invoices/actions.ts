"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccountingAccess } from "@/lib/accounting/authGuard";
import { getDriveService } from "@/lib/drive/DriveService";
import {
  issueAndGenerateInvoiceDocument,
  generateAndStoreInvoiceDocumentPdf,
} from "@/lib/billing/pdf/issueInvoiceDocument";
import { todayIsoJst, voidInvoiceDocument } from "@/lib/billing/invoiceDocuments";
import { markInvoiceSentGuarded } from "@/lib/billing/markInvoiceSentGuarded";
import { setInvoiceItemTaxRate } from "@/lib/billing/invoiceItemTaxRate";

// このファイルの各Server Actionは、Phase2A/2B/2Cで実装済みのロジック（begin_invoice_document_issue、
// generateInvoicePdf、Drive upload、complete_invoice_document_generation、void_invoice_document、
// mark_invoice_sent）をそのまま呼ぶだけで、発行/取消/送付処理自体をこのUI層で再実装しない。
// generateInvoicePdf/DriveServiceはfsを使うためNode runtime専用（Edge指定は行わない）。

function invoicesUrl(params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString();
  return `/accounting/invoices?${search}`;
}

export async function issueInvoiceDocumentAction(formData: FormData) {
  await requireAccountingAccess();
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  const month = String(formData.get("month") ?? "").trim();
  const supabase = await createSupabaseServerClient();
  const drive = await getDriveService();

  const result = await issueAndGenerateInvoiceDocument(supabase, drive, invoiceId, todayIsoJst());
  redirect(invoicesUrl(result.error ? { month, error: result.error } : { month, saved: "issued" }));
}

export async function retryInvoiceDocumentGenerationAction(formData: FormData) {
  await requireAccountingAccess();
  const invoiceDocumentId = String(formData.get("invoiceDocumentId") ?? "").trim();
  const month = String(formData.get("month") ?? "").trim();
  const supabase = await createSupabaseServerClient();
  const drive = await getDriveService();

  const result = await generateAndStoreInvoiceDocumentPdf(supabase, drive, invoiceDocumentId);
  redirect(invoicesUrl(result.error ? { month, error: result.error } : { month, saved: "issued" }));
}

export async function voidInvoiceDocumentFromInvoicesAction(formData: FormData) {
  await requireAccountingAccess();
  const invoiceDocumentId = String(formData.get("invoiceDocumentId") ?? "").trim();
  const reason = String(formData.get("voidReason") ?? "").trim();
  const month = String(formData.get("month") ?? "").trim();
  const supabase = await createSupabaseServerClient();

  const result = await voidInvoiceDocument(supabase, invoiceDocumentId, reason);
  redirect(invoicesUrl(result.error ? { month, error: result.error } : { month, saved: "voided" }));
}

export async function markInvoiceSentFromInvoicesAction(formData: FormData) {
  await requireAccountingAccess();
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  const month = String(formData.get("month") ?? "").trim();
  const supabase = await createSupabaseServerClient();

  const result = await markInvoiceSentGuarded(supabase, invoiceId);
  redirect(invoicesUrl(result.error ? { month, error: result.error } : { month, saved: "sent" }));
}

export async function setInvoiceItemTaxRateAction(formData: FormData) {
  await requireAccountingAccess();
  const invoiceItemId = String(formData.get("invoiceItemId") ?? "").trim();
  const month = String(formData.get("month") ?? "").trim();
  const taxRateRaw = String(formData.get("taxRate") ?? "");
  const taxRate = Number(taxRateRaw);
  const supabase = await createSupabaseServerClient();

  if (taxRateRaw === "" || !Number.isFinite(taxRate)) {
    redirect(invoicesUrl({ month, error: "税率を選択してください。" }));
  }

  const result = await setInvoiceItemTaxRate(supabase, invoiceItemId, taxRate);
  redirect(invoicesUrl(result.error ? { month, error: result.error } : { month, saved: "tax_rate_set" }));
}
