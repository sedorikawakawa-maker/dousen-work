"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccountingAccess } from "@/lib/accounting/authGuard";
import { updateCompanyProfile } from "@/lib/billing/companyProfile";

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

export async function updateCompanyProfileAction(formData: FormData) {
  const staff = await requireAccountingAccess();
  const supabase = await createSupabaseServerClient();

  const defaultPaymentDueDaysRaw = emptyToNull(formData.get("defaultPaymentDueDays"));
  const defaultPaymentDueDays = defaultPaymentDueDaysRaw ? Number(defaultPaymentDueDaysRaw) : null;
  if (defaultPaymentDueDays !== null && (!Number.isFinite(defaultPaymentDueDays) || defaultPaymentDueDays <= 0)) {
    redirect("/accounting/settings?error=" + encodeURIComponent("標準支払日数は0より大きい数値で入力してください。"));
  }

  const result = await updateCompanyProfile(
    supabase,
    {
      companyName: emptyToNull(formData.get("companyName")),
      postalCode: emptyToNull(formData.get("postalCode")),
      address: emptyToNull(formData.get("address")),
      phone: emptyToNull(formData.get("phone")),
      email: emptyToNull(formData.get("email")),
      invoiceRegistrationNumber: emptyToNull(formData.get("invoiceRegistrationNumber")),
      bankName: emptyToNull(formData.get("bankName")),
      branchName: emptyToNull(formData.get("branchName")),
      accountType: emptyToNull(formData.get("accountType")),
      accountNumber: emptyToNull(formData.get("accountNumber")),
      accountHolderName: emptyToNull(formData.get("accountHolderName")),
      defaultPaymentDueDays,
      note: emptyToNull(formData.get("note")),
    },
    staff.id,
  );

  redirect(result.error ? `/accounting/settings?error=${encodeURIComponent(result.error)}` : "/accounting/settings?saved=1");
}
