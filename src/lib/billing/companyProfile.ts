import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;
export type CompanyProfile = Database["public"]["Tables"]["company_profile"]["Row"];

/**
 * 自社情報(company_profile)を取得する。singletonのためid=1固定。
 * 正式請求書の発行可否判定はDB側(begin_invoice_document_issue RPC)で行うため、
 * ここでは単純な取得のみを提供する（将来の設定画面はこの関数を呼ぶだけで済む）。
 */
export async function getCompanyProfile(supabase: TypedClient): Promise<CompanyProfile | null> {
  const { data, error } = await supabase.from("company_profile").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data;
}

export interface CompanyProfileInput {
  companyName: string | null;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  invoiceRegistrationNumber: string | null;
  bankName: string | null;
  branchName: string | null;
  accountType: string | null;
  accountNumber: string | null;
  accountHolderName: string | null;
  defaultPaymentDueDays: number | null;
  note: string | null;
}

/**
 * 自社情報を更新する（INSERTは行わない。migrationで投入済みのid=1行を常にUPDATEする。
 * RLSにもINSERTポリシーが無いため、仕組み上もINSERTは成立しない）。
 * ロゴ(logo_drive_file_id/logo_drive_url)はGoogle Drive連携実装後の別経路で更新する想定のため、
 * この関数の対象には含めない。
 */
export async function updateCompanyProfile(
  supabase: TypedClient,
  input: CompanyProfileInput,
  updatedByStaffId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("company_profile")
    .update({
      company_name: input.companyName,
      postal_code: input.postalCode,
      address: input.address,
      phone: input.phone,
      email: input.email,
      invoice_registration_number: input.invoiceRegistrationNumber,
      bank_name: input.bankName,
      branch_name: input.branchName,
      account_type: input.accountType,
      account_number: input.accountNumber,
      account_holder_name: input.accountHolderName,
      default_payment_due_days: input.defaultPaymentDueDays,
      note: input.note,
      updated_by_staff_id: updatedByStaffId,
    })
    .eq("id", 1);

  if (error) return { error: error.message };
  return { error: null };
}

/** 正式請求書発行に最低限必要な項目が揃っているかどうか（UI側の事前案内表示用。発行可否の最終判定はRPC側で行う）。 */
export function isCompanyProfileReadyForInvoiceIssue(profile: CompanyProfile | null): boolean {
  if (!profile) return false;
  const required = [
    profile.company_name,
    profile.postal_code,
    profile.address,
    profile.phone,
    profile.email,
    profile.invoice_registration_number,
    profile.bank_name,
    profile.branch_name,
    profile.account_type,
    profile.account_number,
    profile.account_holder_name,
  ];
  return required.every((value) => value !== null && value.trim() !== "");
}
