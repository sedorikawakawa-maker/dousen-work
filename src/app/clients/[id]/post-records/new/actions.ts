"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";
import { getDriveService } from "@/lib/drive/DriveService";
import type { PostType } from "@/lib/supabase/database.types";

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function newFormUrl(clientId: string, postType: string, params: Record<string, string>) {
  const search = new URLSearchParams({ type: postType, ...params }).toString();
  return `/clients/${clientId}/post-records/new?${search}`;
}

export async function registerPostRecordAction(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const postType = String(formData.get("postType")) as PostType;
  const taskId = String(formData.get("taskId") ?? "");
  const postedAt = String(formData.get("postedAt") ?? "").trim();
  const postedByStaffId = String(formData.get("postedByStaffId") ?? "");
  const title = emptyToNull(formData.get("title"));
  const socialPostUrl = emptyToNull(formData.get("socialPostUrl"));
  const canvaUrl = emptyToNull(formData.get("canvaUrl"));
  const manualDriveUrl = emptyToNull(formData.get("manualDriveUrl"));
  const sourceMaterialId = emptyToNull(formData.get("sourceMaterialId"));

  const fail = (message: string) =>
    redirect(newFormUrl(clientId, postType, { taskId, error: message }));

  if (!taskId) fail("対象の制作タスクを選択してください");
  if (!postedAt) fail("投稿日を入力してください");
  if (!postedByStaffId) fail("投稿担当を選択してください");

  if (postType === "reel" && !socialPostUrl) fail("SNS投稿URLを入力してください");
  if (postType === "feed") {
    if (!socialPostUrl) fail("SNS投稿URLを入力してください");
    if (!canvaUrl) fail("Canvaリンクを入力してください");
  }
  if ((postType === "reel" || postType === "feed") && !title) {
    fail("投稿タイトル/内容を入力してください");
  }

  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  const supabase = await createSupabaseServerClient();

  let finalDriveFileId: string | null = null;
  let finalDriveUrl: string | null = null;

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    // Google Driveへの格納に失敗した場合はここで処理を中断し、
    // post_records・production_tasks.completedのどちらも確定させない。
    try {
      const drive = getDriveService();
      const result = await drive.uploadFile({ file, clientId, folderHint: "final" });
      finalDriveFileId = result.driveFileId;
      finalDriveUrl = result.driveUrl;
    } catch {
      fail("Google Driveへの格納に失敗しました。時間をおいて再度お試しください");
    }
  } else if (manualDriveUrl) {
    finalDriveUrl = manualDriveUrl;
  }

  if (postType === "reel" && !finalDriveUrl) {
    fail("完成動画ファイルをアップロードするか、Google Drive保存先URLを入力してください");
  }
  if (postType === "story" && !canvaUrl && !finalDriveUrl) {
    fail("Canvaリンク、または画像/動画ファイルのいずれかを入力してください");
  }

  const { data: recordId, error } = await supabase.rpc("create_post_record_and_complete_task", {
    p_production_task_id: taskId,
    p_client_id: clientId,
    p_post_type: postType,
    p_posted_at: new Date(postedAt).toISOString(),
    p_posted_by_staff_id: postedByStaffId,
    p_title: title,
    p_social_post_url: socialPostUrl,
    p_canva_url: canvaUrl,
    p_final_drive_file_id: finalDriveFileId,
    p_final_drive_url: finalDriveUrl,
    p_source_material_id: sourceMaterialId,
  });

  if (error || !recordId) {
    if (error?.code === "23505") {
      fail("このタスクは既に投稿実績が登録されています（二重送信の可能性があります）");
    }
    fail(error?.message ?? "登録に失敗しました");
  }

  redirect(`/clients/${clientId}?tab=posts&saved=1`);
}
