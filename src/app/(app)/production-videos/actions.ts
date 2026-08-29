"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";
import { uploadFilesForProductionVideoLibrary } from "@/lib/productionVideos/upload";
import type { PostType } from "@/lib/supabase/database.types";

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function safeReturnTo(value: FormDataEntryValue | null, fallback: string): string {
  const text = String(value ?? "");
  return text.startsWith("/") ? text : fallback;
}

function withParam(url: string, key: string, value: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${key}=${encodeURIComponent(value)}`;
}

/**
 * 制作動画の複数ファイルアップロード。/production-videos（アップロードタブ）・
 * 顧客詳細「制作動画」タブの両方から共通で呼ばれる。post_records/final・Wチェック・
 * 投稿完了フローとは一切連動しない、単独のアップロードのみ。
 */
export async function addProductionVideoAction(formData: FormData) {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const postType = emptyToNull(formData.get("postType")) as PostType | null;
  const memo = emptyToNull(formData.get("memo"));
  const returnTo = safeReturnTo(formData.get("returnTo"), "/production-videos?tab=upload");

  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  if (!clientId) {
    redirect(withParam(returnTo, "error", "顧客を選択してください"));
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    redirect(withParam(returnTo, "error", "ファイルを選択してください"));
  }

  // Drive格納→DB保存の順序を守る（materials/final/outsourcingと同じ方針）。
  // Driveアップロードに1件でも失敗したらDBには1件も登録しない。
  let uploaded: Awaited<ReturnType<typeof uploadFilesForProductionVideoLibrary>>;
  try {
    uploaded = await uploadFilesForProductionVideoLibrary({ clientId, files });
  } catch {
    redirect(
      withParam(returnTo, "error", "Google Driveへの保存に失敗しました。時間をおいて再度お試しください"),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("production_videos").insert(
    uploaded.map((file) => ({
      client_id: clientId,
      post_type: postType,
      file_name: file.fileName,
      drive_file_id: file.driveFileId,
      drive_url: file.driveUrl,
      memo,
      uploaded_by_staff_id: staff.id,
    })),
  );

  if (error) {
    redirect(withParam(returnTo, "error", "登録に失敗しました。時間をおいて再度お試しください"));
  }

  redirect(withParam(returnTo, "saved", "1"));
}
