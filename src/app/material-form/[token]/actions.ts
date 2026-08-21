"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashMaterialFormToken } from "@/lib/materials/formToken";
import { notifyAssignedStaffOfNewMaterial } from "@/lib/materials/queries";
import { getDriveService } from "@/lib/drive/DriveService";

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

export async function submitClientMaterialAction(formData: FormData) {
  const token = String(formData.get("token"));
  const title = String(formData.get("title") ?? "").trim();

  if (!title) {
    redirect(`/material-form/${token}?error=${encodeURIComponent("素材の内容（タイトル）を入力してください")}`);
  }

  // 顧客はログインしないため service_role の管理クライアントでRLSをバイパスして登録する
  const admin = createSupabaseAdminClient();
  const tokenHash = hashMaterialFormToken(token);

  const { data: tokenRow } = await admin
    .from("material_form_tokens")
    .select("client_id")
    .eq("token_hash", tokenHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!tokenRow) {
    redirect(`/material-form/${token}?error=${encodeURIComponent("このURLは無効です")}`);
  }

  const { data: client } = await admin
    .from("clients")
    .select("id, company_name")
    .eq("id", tokenRow.client_id)
    .maybeSingle();

  if (!client) {
    redirect(`/material-form/${token}?error=${encodeURIComponent("このURLは無効です")}`);
  }

  let driveFileId: string | null = null;
  let driveUrl: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const drive = getDriveService();
    const result = await drive.uploadFile({ file, clientId: client.id, folderHint: "materials" });
    driveFileId = result.driveFileId;
    driveUrl = result.driveUrl;
  }

  const { data: material, error } = await admin
    .from("materials")
    .insert({
      client_id: client.id,
      title,
      post_usage: emptyToNull(formData.get("postUsage")),
      requested_post_timing: emptyToNull(formData.get("requestedPostTiming")),
      editing_instructions: emptyToNull(formData.get("editingInstructions")),
      caption_instructions: emptyToNull(formData.get("captionInstructions")),
      contact_notes: emptyToNull(formData.get("contactNotes")),
      shot_date: emptyToNull(formData.get("shotDate")),
      drive_file_id: driveFileId,
      drive_url: driveUrl,
      submitted_by_type: "client",
    })
    .select("id")
    .single();

  if (error || !material) {
    redirect(`/material-form/${token}?error=${encodeURIComponent("送信に失敗しました。時間をおいて再度お試しください")}`);
  }

  await notifyAssignedStaffOfNewMaterial(admin, {
    clientId: client.id,
    clientName: client.company_name,
    materialId: material.id,
    materialTitle: title,
  });

  redirect(`/material-form/${token}?submitted=1`);
}
