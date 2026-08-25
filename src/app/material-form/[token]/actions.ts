"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashMaterialFormToken } from "@/lib/materials/formToken";
import { notifyAssignedStaffOfNewMaterialSubmission } from "@/lib/materials/queries";
import { uploadFilesForMaterialSubmission } from "@/lib/materials/submissionUpload";
import type { MaterialSubmissionFileInput } from "@/lib/supabase/database.types";

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

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

  // submission IDを先に確定し、Drive submissionフォルダの一意化とDB行のidに同じ値を使う。
  // 複数ファイルはすべて成功して初めてDBへ登録する。1件でも失敗したら
  // submission・materialsとも1件も作らない（中途半端な登録を防ぐ）。
  let submissionId = "";
  let driveFolderId: string | null = null;
  let driveFolderUrl: string | null = null;
  let uploadedFiles: MaterialSubmissionFileInput[] = [];
  try {
    const result = await uploadFilesForMaterialSubmission({ clientId: client.id, title, files });
    submissionId = result.submissionId;
    driveFolderId = result.driveFolderId;
    driveFolderUrl = result.driveFolderUrl;
    uploadedFiles = result.files;
  } catch {
    redirect(
      `/material-form/${token}?error=${encodeURIComponent("ファイルの保存に失敗しました。時間をおいて再度お試しください")}`,
    );
  }

  // submission作成＋ファイル分のmaterials作成を1トランザクションで行うRPC。
  const { data: createdSubmissionId, error } = await admin.rpc("create_client_material_submission", {
    p_id: submissionId,
    p_client_id: client.id,
    p_title: title,
    p_post_usage: emptyToNull(formData.get("postUsage")),
    p_requested_post_timing: emptyToNull(formData.get("requestedPostTiming")),
    p_editing_instructions: emptyToNull(formData.get("editingInstructions")),
    p_caption_instructions: emptyToNull(formData.get("captionInstructions")),
    p_contact_notes: emptyToNull(formData.get("contactNotes")),
    p_shot_date: emptyToNull(formData.get("shotDate")),
    p_drive_folder_id: driveFolderId,
    p_drive_folder_url: driveFolderUrl,
    p_files: uploadedFiles,
  });

  if (error || !createdSubmissionId) {
    redirect(`/material-form/${token}?error=${encodeURIComponent("送信に失敗しました。時間をおいて再度お試しください")}`);
  }

  await notifyAssignedStaffOfNewMaterialSubmission(admin, {
    clientId: client.id,
    clientName: client.company_name,
    submissionId: createdSubmissionId,
    submissionTitle: title,
  });

  redirect(`/material-form/${token}?submitted=1`);
}
