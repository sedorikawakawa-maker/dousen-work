"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";
import type { ContractStatus } from "@/lib/supabase/database.types";

export interface RegisterClientState {
  error: string | null;
}

export async function registerClientAction(
  _prevState: RegisterClientState,
  formData: FormData,
): Promise<RegisterClientState> {
  const staff = await getCurrentStaff();
  if (!staff) {
    return { error: "ログインが必要です。" };
  }

  const companyName = String(formData.get("companyName") ?? "").trim();
  if (!companyName) {
    return { error: "顧客名（会社名・屋号）は必須です。" };
  }

  const contractStatus = String(formData.get("contractStatus") ?? "proposal") as ContractStatus;
  const primaryStaffId = String(formData.get("primaryStaffId") ?? "").trim();
  const services = formData.getAll("services").map((v) => String(v));
  const loginStaffIds = [...new Set(formData.getAll("loginStaffIds").map((v) => String(v)))];

  const supabase = await createSupabaseServerClient();

  const { data: clientId, error } = await supabase.rpc("create_client", {
    p_company_name: companyName,
    p_shop_name: emptyToNull(formData.get("shopName")),
    p_phone: emptyToNull(formData.get("phone")),
    p_email: emptyToNull(formData.get("email")),
    p_contact_name: emptyToNull(formData.get("contactName")),
    p_industry: emptyToNull(formData.get("industry")),
    p_inflow_channel: emptyToNull(formData.get("inflowChannel")),
    p_contact_method: emptyToNull(formData.get("contactMethod")),
    p_contract_status: contractStatus,
    p_contract_start_date: emptyToNull(formData.get("contractStartDate")),
    p_notes: emptyToNull(formData.get("notes")),
    p_services: services,
  });

  if (error || !clientId) {
    return { error: `顧客の登録に失敗しました: ${error?.message ?? "unknown error"}` };
  }

  if (primaryStaffId) {
    await supabase.from("client_assignments").insert({
      client_id: clientId,
      staff_id: primaryStaffId,
      assignment_type: "primary",
      active_from: new Date().toISOString().slice(0, 10),
      active_to: null,
    });
  }

  if (loginStaffIds.length > 0) {
    await supabase.from("client_login_staff").insert(
      loginStaffIds.map((staffId) => ({
        client_id: clientId,
        staff_id: staffId,
        created_by_staff_id: staff.id,
      })),
    );
  }

  redirect(`/clients/${clientId}`);
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}
