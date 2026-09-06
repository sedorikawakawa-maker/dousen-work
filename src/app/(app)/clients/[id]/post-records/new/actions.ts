"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";
import { getDriveService } from "@/lib/drive/DriveService";
import { validateBrowserOrigin } from "@/lib/http/origin";
import type { PostType } from "@/lib/supabase/database.types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Google DriveのファイルIDは可変長の英数字+ "-" "_"。厳密な仕様は非公開のため、
// 明らかに不正な値だけを弾く緩めのバリデーションに留める（他のresumable経路と同じ方針）。
const DRIVE_FILE_ID_PATTERN = /^[\w-]{6,}$/;
const POST_TYPES: readonly PostType[] = ["reel", "feed", "story"];

// post_records final専用のDrive保存先。production-videosの「制作動画」フォルダとは
// folderHintが異なるため別フォルダとして管理される（統合しない）。
const FINAL_FOLDER_HINT = "final";

function isValidPostType(value: unknown): value is PostType {
  return typeof value === "string" && (POST_TYPES as readonly string[]).includes(value);
}

function nullableString(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

// ---------------------------------------------------------------------------
// ブラウザ→Google Drive直接アップロード方式（Netlify Functionsへfinal動画本体を
// 通さないための新経路。production-videos/material-form/outsourcing-uploadと同じ
// 汎用DriveService/Origin検証をそのまま再利用。post_records専用のDrive処理は追加しない）。
// ---------------------------------------------------------------------------

export interface CreatePostRecordUploadSessionResult {
  error: string | null;
  sessionUrl: string | null;
}

/**
 * ①staff認証 → ②既存と同じ"final"フォルダを解決 → ③resumable upload sessionを発行。
 * 動画本体はまだ一切扱わない（メタデータのみ）。
 */
export async function createPostRecordUploadSessionAction(
  clientId: string,
  file: { fileName: string; mimeType: string; fileSizeBytes: number },
  browserOrigin?: string,
): Promise<CreatePostRecordUploadSessionResult> {
  const staff = await getCurrentStaff();
  if (!staff) {
    return { error: "ログインが必要です。", sessionUrl: null };
  }

  const trimmedClientId = String(clientId ?? "").trim();
  if (!UUID_PATTERN.test(trimmedClientId)) {
    return { error: "顧客の指定が不正です。", sessionUrl: null };
  }

  const supabase = await createSupabaseServerClient();
  const { data: client } = await supabase.from("clients_view").select("id").eq("id", trimmedClientId).maybeSingle();
  if (!client) {
    return { error: "顧客が見つかりません。", sessionUrl: null };
  }

  const fileName = String(file?.fileName ?? "").trim();
  if (!fileName) {
    return { error: "ファイルを選択してください。", sessionUrl: null };
  }

  try {
    const validatedOrigin = await validateBrowserOrigin(browserOrigin);
    const drive = await getDriveService();
    const folder = await drive.resolveFolder({ clientId: trimmedClientId, folderHint: FINAL_FOLDER_HINT });
    const { sessionUrl } = await drive.createResumableUploadSession({
      folderId: folder.folderId,
      file: {
        name: fileName,
        mimeType: String(file.mimeType ?? "application/octet-stream"),
        sizeBytes: Number(file.fileSizeBytes) || 0,
      },
      origin: validatedOrigin,
    });
    return { error: null, sessionUrl };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Google Driveへの接続に失敗しました。時間をおいて再度お試しください",
      sessionUrl: null,
    };
  }
}

export interface ConfirmPostRecordInput {
  clientId: string;
  taskId: string;
  postType: string;
  postedAt: string;
  postedByStaffId: string;
  title: string | null;
  socialPostUrl: string | null;
  canvaUrl: string | null;
  manualDriveUrl: string | null;
  sourceMaterialId: string | null;
  /** ブラウザ→Drive直接PUTに成功した場合のみ指定する。 */
  driveFileId: string | null;
  driveUrl: string | null;
}

export interface ConfirmPostRecordResult {
  error: string | null;
  recordId: string | null;
}

/**
 * 確定登録。ブラウザから届く値は一切信用せず、以下をサーバー側で再検証してから
 * 初めてDB登録する。
 *  - staff認証（毎回再実行）
 *  - clientIdの実在確認、taskIdが実際にそのclientのタスクであることの確認
 *  - driveFileIdが申告された場合、session発行時と全く同じ手順でフォルダを再解決し、
 *    Drive API自体にfileの実在・親フォルダ一致を確認（任意のdrive_file_id注入を防ぐ）
 * 既存のcreate_post_record_and_complete_task RPC（post_records作成+task completed化を
 * 1トランザクションで実行）はそのまま再利用する。RPC失敗時はアップロード済みの
 * final動画をベストエフォートで削除する（後始末の失敗によって他の処理を止めない）。
 */
export async function confirmPostRecordAction(input: ConfirmPostRecordInput): Promise<ConfirmPostRecordResult> {
  const staff = await getCurrentStaff();
  if (!staff) {
    return { error: "ログインが必要です。", recordId: null };
  }

  const clientId = String(input?.clientId ?? "").trim();
  const taskId = String(input?.taskId ?? "").trim();
  const postedAt = String(input?.postedAt ?? "").trim();
  const postedByStaffId = String(input?.postedByStaffId ?? "").trim();

  if (!UUID_PATTERN.test(clientId)) {
    return { error: "顧客の指定が不正です。", recordId: null };
  }
  if (!UUID_PATTERN.test(taskId)) {
    return { error: "対象の制作タスクを選択してください", recordId: null };
  }
  if (!isValidPostType(input?.postType)) {
    return { error: "投稿種別が不正です。", recordId: null };
  }
  const postType = input.postType;
  if (!postedAt) {
    return { error: "投稿日を入力してください", recordId: null };
  }
  if (!postedByStaffId) {
    return { error: "投稿担当を選択してください", recordId: null };
  }

  const title = nullableString(input?.title);
  const socialPostUrl = nullableString(input?.socialPostUrl);
  const canvaUrl = nullableString(input?.canvaUrl);
  const manualDriveUrl = nullableString(input?.manualDriveUrl);
  const sourceMaterialId = nullableString(input?.sourceMaterialId);

  if (postType === "reel" && !socialPostUrl) {
    return { error: "SNS投稿URLを入力してください", recordId: null };
  }
  if (postType === "feed") {
    if (!socialPostUrl) return { error: "SNS投稿URLを入力してください", recordId: null };
    if (!canvaUrl) return { error: "Canvaリンクを入力してください", recordId: null };
  }
  if ((postType === "reel" || postType === "feed") && !title) {
    return { error: "投稿タイトル/内容を入力してください", recordId: null };
  }

  const supabase = await createSupabaseServerClient();
  const drive = await getDriveService();

  // アップロード済みfinal動画がある状態でclientId/taskIdだけ改ざんされた場合でも
  // 後始末が漏れないよう、claimedFileIdはこれ以降のあらゆる失敗パスより先に読み出す。
  const claimedFileId = String(input?.driveFileId ?? "").trim();
  const claimedUrl = String(input?.driveUrl ?? "").trim();

  const { data: client } = await supabase.from("clients_view").select("id").eq("id", clientId).maybeSingle();
  if (!client) {
    if (claimedFileId) await drive.deleteFile(claimedFileId).catch(() => {});
    return { error: "顧客が見つかりません。", recordId: null };
  }

  // taskIdが実際にこのclientのタスクであることを再確認する（ブラウザ申告値を無条件に信用しない）。
  const { data: task } = await supabase
    .from("production_tasks")
    .select("id, client_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task || task.client_id !== clientId) {
    if (claimedFileId) await drive.deleteFile(claimedFileId).catch(() => {});
    return { error: "対象の制作タスクが見つかりません。", recordId: null };
  }

  let finalDriveFileId: string | null = null;
  let finalDriveUrl: string | null = null;

  if (claimedFileId) {
    if (!DRIVE_FILE_ID_PATTERN.test(claimedFileId) || !claimedUrl.startsWith("https://drive.google.com/")) {
      await drive.deleteFile(claimedFileId).catch(() => {});
      return { error: "送信内容が不正です。もう一度お試しください", recordId: null };
    }

    let folder;
    try {
      folder = await drive.resolveFolder({ clientId, folderHint: FINAL_FOLDER_HINT });
    } catch {
      return { error: "登録に失敗しました。時間をおいて再度お試しください", recordId: null };
    }

    const meta = await drive.getFileMetadata(claimedFileId);
    if (!meta || !meta.parents.includes(folder.folderId)) {
      await drive.deleteFile(claimedFileId).catch(() => {});
      return { error: "アップロード内容の確認に失敗しました。もう一度お試しください", recordId: null };
    }

    finalDriveFileId = meta.id;
    finalDriveUrl = claimedUrl;
  } else if (manualDriveUrl) {
    finalDriveUrl = manualDriveUrl;
  }

  if (postType === "reel" && !finalDriveUrl) {
    if (finalDriveFileId) await drive.deleteFile(finalDriveFileId).catch(() => {});
    return { error: "完成動画ファイルをアップロードするか、Google Drive保存先URLを入力してください", recordId: null };
  }
  if (postType === "story" && !canvaUrl && !finalDriveUrl) {
    if (finalDriveFileId) await drive.deleteFile(finalDriveFileId).catch(() => {});
    return { error: "Canvaリンク、または画像/動画ファイルのいずれかを入力してください", recordId: null };
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
    if (finalDriveFileId) await drive.deleteFile(finalDriveFileId).catch(() => {});
    if (error?.code === "23505") {
      return { error: "このタスクは既に投稿実績が登録されています（二重送信の可能性があります）", recordId: null };
    }
    return { error: error?.message ?? "登録に失敗しました", recordId: null };
  }

  return { error: null, recordId };
}
