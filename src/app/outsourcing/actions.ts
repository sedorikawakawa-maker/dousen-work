"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";
import { generateOutsourcingToken, hashOutsourcingToken } from "@/lib/outsourcing/token";

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

export async function createOutsourcingRequestAction(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  const contractorName = String(formData.get("contractorName") ?? "").trim();
  const clientId = emptyToNull(formData.get("clientId"));
  const productionTaskId = emptyToNull(formData.get("productionTaskId"));
  const instruction = emptyToNull(formData.get("instruction"));
  const materialLink = emptyToNull(formData.get("materialLink"));
  const dueDate = emptyToNull(formData.get("dueDate"));
  const createdByStaffId = emptyToNull(formData.get("createdByStaffId")) ?? staff.id;

  if (!title || !contractorName) {
    redirect(
      `/outsourcing/new?error=${encodeURIComponent("案件名と外注先名は必須です")}`,
    );
  }

  const rawToken = generateOutsourcingToken();
  const tokenHash = hashOutsourcingToken(rawToken);

  const supabase = await createSupabaseServerClient();
  const { data: request, error } = await supabase
    .from("outsourcing_requests")
    .insert({
      client_id: clientId,
      production_task_id: productionTaskId,
      title,
      contractor_name: contractorName,
      instruction,
      material_link: materialLink,
      due_date: dueDate,
      upload_token_hash: tokenHash,
      token_expires_at: null,
      status: "requested",
      created_by_staff_id: createdByStaffId,
    })
    .select("id")
    .single();

  if (error || !request) {
    redirect(`/outsourcing/new?error=${encodeURIComponent(error?.message ?? "作成に失敗しました")}`);
  }

  redirect(`/outsourcing/${request.id}?newToken=${encodeURIComponent(rawToken)}`);
}

/** URLの再発行。中止済みだった場合は依頼中へ戻す。 */
export async function reissueOutsourcingTokenAction(formData: FormData) {
  const requestId = String(formData.get("requestId"));
  const rawToken = generateOutsourcingToken();
  const tokenHash = hashOutsourcingToken(rawToken);

  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase
    .from("outsourcing_requests")
    .select("status")
    .eq("id", requestId)
    .maybeSingle();

  await supabase
    .from("outsourcing_requests")
    .update({
      upload_token_hash: tokenHash,
      status: current?.status === "cancelled" ? "requested" : current?.status,
    })
    .eq("id", requestId);

  redirect(`/outsourcing/${requestId}?newToken=${encodeURIComponent(rawToken)}`);
}

/** アップロードURLの無効化（案件そのものは中止扱いになる）。 */
export async function cancelOutsourcingRequestAction(formData: FormData) {
  const requestId = String(formData.get("requestId"));
  const supabase = await createSupabaseServerClient();

  await supabase.from("outsourcing_requests").update({ status: "cancelled" }).eq("id", requestId);

  redirect(`/outsourcing/${requestId}?saved=1`);
}

/**
 * 社内確認済み。外注案件をcompletedにするだけで、production_taskは自動完了にしない。
 * Wチェック・顧客確認・投稿実績登録は通常フローのまま進める。
 */
export async function markOutsourcingCompletedAction(formData: FormData) {
  const requestId = String(formData.get("requestId"));
  const supabase = await createSupabaseServerClient();

  const { data: request } = await supabase
    .from("outsourcing_requests")
    .select("status")
    .eq("id", requestId)
    .maybeSingle();

  if (!request || request.status !== "delivered") {
    redirect(`/outsourcing/${requestId}?error=${encodeURIComponent("納品済みの案件のみ確認できます")}`);
  }

  await supabase.from("outsourcing_requests").update({ status: "completed" }).eq("id", requestId);

  redirect(`/outsourcing/${requestId}?saved=1`);
}
