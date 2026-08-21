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

  const supabase = await createSupabaseServerClient();

  const { data: client, error } = await supabase
    .from("clients")
    .insert({
      client_code: "",
      company_name: companyName,
      shop_name: emptyToNull(formData.get("shopName")),
      phone: emptyToNull(formData.get("phone")),
      email: emptyToNull(formData.get("email")),
      contact_name: emptyToNull(formData.get("contactName")),
      industry: emptyToNull(formData.get("industry")),
      inflow_channel: emptyToNull(formData.get("inflowChannel")),
      contact_method: emptyToNull(formData.get("contactMethod")),
      contract_status: contractStatus,
      current_status: "on_track",
      contract_start_date: emptyToNull(formData.get("contractStartDate")),
      contract_end_date: null,
      notes: emptyToNull(formData.get("notes")),
      revenue_amount: null,
      fee_amount: null,
      material_wait_started_at: null,
    })
    .select("id")
    .single();

  if (error || !client) {
    return { error: `顧客の登録に失敗しました: ${error?.message ?? "unknown error"}` };
  }

  if (primaryStaffId) {
    await supabase.from("client_assignments").insert({
      client_id: client.id,
      staff_id: primaryStaffId,
      assignment_type: "primary",
      active_from: new Date().toISOString().slice(0, 10),
      active_to: null,
    });
  }

  redirect(`/clients/${client.id}`);
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}
