"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashOutsourcingToken } from "@/lib/outsourcing/token";
import { getDriveService } from "@/lib/drive/DriveService";

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

const UPLOADABLE_STATUSES = new Set(["requested", "in_progress"]);

export async function submitOutsourcingDeliveryAction(formData: FormData) {
  const token = String(formData.get("token"));
  const manualDriveUrl = emptyToNull(formData.get("manualDriveUrl"));
  const contractorNote = emptyToNull(formData.get("contractorNote"));

  const admin = createSupabaseAdminClient();
  const tokenHash = hashOutsourcingToken(token);

  const { data: request } = await admin
    .from("outsourcing_requests")
    .select("id, status, client_id, created_by_staff_id, title")
    .eq("upload_token_hash", tokenHash)
    .maybeSingle();

  if (!request || !UPLOADABLE_STATUSES.has(request.status)) {
    redirect(`/outsourcing-upload/${token}?error=${encodeURIComponent("このURLは現在利用できません")}`);
  }

  let driveFileId: string | null = null;
  let driveUrl: string | null = null;

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    try {
      const drive = await getDriveService();
      const result = await drive.uploadFile({
        file,
        clientId: request.client_id ?? "unassigned",
        folderHint: "outsourcing",
      });
      driveFileId = result.driveFileId;
      driveUrl = result.driveUrl;
    } catch {
      redirect(
        `/outsourcing-upload/${token}?error=${encodeURIComponent("格納に失敗しました。時間をおいて再度お試しください")}`,
      );
    }
  } else if (manualDriveUrl) {
    driveUrl = manualDriveUrl;
  }

  if (!driveUrl) {
    redirect(
      `/outsourcing-upload/${token}?error=${encodeURIComponent("ファイルを選択するか、保存先URLを入力してください")}`,
    );
  }

  const { data: deliveryId, error } = await admin.rpc("create_outsourcing_delivery", {
    p_outsourcing_request_id: request.id,
    p_drive_file_id: driveFileId,
    p_drive_url: driveUrl,
    p_contractor_note: contractorNote,
  });

  if (error || !deliveryId) {
    redirect(`/outsourcing-upload/${token}?error=${encodeURIComponent("送信に失敗しました")}`);
  }

  await admin.from("notifications").insert({
    recipient_staff_id: request.created_by_staff_id,
    notification_type: "outsourcing_delivered",
    title: `外注納品: ${request.title}`,
    body: null,
    entity_type: "outsourcing_request",
    entity_id: request.id,
  });

  redirect(`/outsourcing-upload/${token}?submitted=1`);
}
