"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashMaterialFormToken } from "@/lib/materials/formToken";
import { notifyAssignedStaffOfNewMaterialSubmission } from "@/lib/materials/queries";
import { getMaterialUploadDateFolderName } from "@/lib/materials/uploadDateFolder";
import { sanitizeSubmissionFolderName } from "@/lib/materials/submissionFolderName";
import { getDriveService, type DriveService } from "@/lib/drive/DriveService";
import { validateBrowserOrigin } from "@/lib/http/origin";
import type { MaterialSubmissionFileInput } from "@/lib/supabase/database.types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Google DriveのファイルIDは可変長の英数字+ "-" "_"（モックのfileIdはbase64url埋め込みでやや長い）。
// 厳密な仕様は非公開のため、明らかに不正な値だけを弾く緩めのバリデーションに留める。
const DRIVE_FILE_ID_PATTERN = /^[\w-]{6,}$/;

function nullableString(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

/**
 * token→client_idの再検証（旧経路と全く同じセキュリティモデル:
 * token_hash一致 + is_active=true + 対象clientの実在確認）。ブラウザからclient_idを
 * 受け取ることは一切なく、常にこの関数の結果だけを信頼する。
 * session発行Action・確定Actionの両方から呼ぶ（このファイル内で1箇所に集約し、
 * 検証ロジックが2箇所でずれないようにする）。
 */
async function resolveTokenClient(token: string): Promise<{ clientId: string; companyName: string } | null> {
  const admin = createSupabaseAdminClient();
  const tokenHash = hashMaterialFormToken(String(token ?? ""));

  const { data: tokenRow } = await admin
    .from("material_form_tokens")
    .select("client_id")
    .eq("token_hash", tokenHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!tokenRow) return null;

  const { data: client } = await admin
    .from("clients")
    .select("id, company_name")
    .eq("id", tokenRow.client_id)
    .maybeSingle();

  if (!client) return null;

  return { clientId: client.id, companyName: client.company_name };
}

async function bestEffortCleanup(drive: DriveService, uploaded: { driveFileId?: string }[]): Promise<void> {
  await Promise.all(
    uploaded
      .map((f) => String(f?.driveFileId ?? ""))
      .filter((id) => DRIVE_FILE_ID_PATTERN.test(id))
      .map((id) => drive.deleteFile(id).catch(() => {})),
  );
}

// ---------------------------------------------------------------------------
// ブラウザ→Google Drive直接アップロード方式（Netlify Functionsへ素材本体を
// 通さないための新経路。production-videosと同じ汎用DriveService/Origin検証を再利用）。
// ---------------------------------------------------------------------------

export interface MaterialUploadSessionRequest {
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
}

export interface MaterialUploadSession {
  tempId: string;
  fileName: string;
  sessionUrl: string;
}

export interface CreateMaterialUploadSessionsResult {
  error: string | null;
  submissionId: string;
  dateFolderName: string | null;
  driveFolderId: string | null;
  driveFolderUrl: string | null;
  sessions: MaterialUploadSession[];
}

/**
 * ①token検証 → ②提出用Driveフォルダを1回だけ解決(作成) → ③ファイルごとにresumable
 * upload sessionを発行してブラウザへ返す。ファイル本体はまだ一切扱わない。
 * ファイル無し提出（連絡事項のみ等）にも対応するため、files.length===0の場合は
 * 既存仕様どおりフォルダを作らずsessionsも空で返す。
 */
export async function createMaterialUploadSessionsAction(
  token: string,
  title: string,
  files: MaterialUploadSessionRequest[],
  browserOrigin?: string,
): Promise<CreateMaterialUploadSessionsResult> {
  const trimmedTitle = String(title ?? "").trim();
  const empty = { submissionId: "", dateFolderName: null, driveFolderId: null, driveFolderUrl: null, sessions: [] };

  if (!trimmedTitle) {
    return { error: "素材の内容（タイトル）を入力してください", ...empty };
  }

  const tokenClient = await resolveTokenClient(token);
  if (!tokenClient) {
    return { error: "このURLは無効です", ...empty };
  }

  const submissionId = crypto.randomUUID();

  if (!Array.isArray(files) || files.length === 0) {
    return { error: null, ...empty, submissionId };
  }

  try {
    const validatedOrigin = await validateBrowserOrigin(browserOrigin);
    const drive = await getDriveService();
    const dateFolderName = getMaterialUploadDateFolderName();
    const submissionFolderName = sanitizeSubmissionFolderName(trimmedTitle, submissionId);

    const folder = await drive.resolveMaterialSubmissionFolder({
      clientId: tokenClient.clientId,
      dateFolderName,
      submissionFolderName,
    });

    const sessions: MaterialUploadSession[] = [];
    for (const file of files) {
      const fileName = String(file.fileName ?? "").trim();
      if (!fileName) continue;
      const { sessionUrl } = await drive.createResumableUploadSession({
        folderId: folder.folderId,
        file: {
          name: fileName,
          mimeType: String(file.mimeType ?? "application/octet-stream"),
          sizeBytes: Number(file.fileSizeBytes) || 0,
        },
        origin: validatedOrigin,
      });
      sessions.push({ tempId: crypto.randomUUID(), fileName, sessionUrl });
    }

    return {
      error: null,
      submissionId,
      dateFolderName,
      driveFolderId: folder.folderId,
      driveFolderUrl: folder.folderUrl,
      sessions,
    };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "アップロードの準備に失敗しました。時間をおいて再度お試しください",
      ...empty,
      submissionId,
    };
  }
}

export interface MaterialUploadedFile {
  fileName: string;
  driveFileId: string;
  driveUrl: string;
}

export interface ConfirmMaterialSubmissionInput {
  token: string;
  submissionId: string;
  title: string;
  postUsage: string | null;
  requestedPostTiming: string | null;
  editingInstructions: string | null;
  captionInstructions: string | null;
  contactNotes: string | null;
  shotDate: string | null;
  /** createMaterialUploadSessionsActionの戻り値をそのまま渡す（ファイル無し提出ならnull）。 */
  dateFolderName: string | null;
  driveFolderId: string | null;
  driveFolderUrl: string | null;
  /** session発行時に依頼したファイル件数。ブラウザ側アップロード結果件数と突き合わせる。 */
  expectedFileCount: number;
  /** ブラウザ→Drive直接PUTに成功したものだけ（失敗したファイルは含めない）。 */
  uploaded: MaterialUploadedFile[];
}

export interface ConfirmMaterialSubmissionResult {
  error: string | null;
  submissionId: string | null;
}

/**
 * ④確定登録。ブラウザから届く値は一切信用せず、以下をすべてサーバー側で再検証してから
 * 初めてDB登録する。
 *  - token→client_idを再検証（ブラウザ申告のclient_idは受け取らない）
 *  - 提出フォルダをsession発行時と全く同じ手順で再解決し、ブラウザ申告のdriveFolderIdと
 *    一致するかを検証（他顧客のフォルダを申告されても、常に自分のtokenのclient_idからしか
 *    解決されないため一致しえない）
 *  - 申告されたuploaded件数がexpectedFileCountと一致するか（1件でも失敗していたら
 *    現在のmaterial_submissionの設計に合わせ提出を成立させない）
 *  - 申告された各drive_file_idについて、Drive API自体に実在確認し、親フォルダが
 *    上記で検証済みのフォルダと一致するかを確認（任意のdrive_file_id注入を防ぐ）
 * 検証に失敗した場合、既にDriveへアップロードされてしまった分はベストエフォートで削除する
 * （後始末の失敗によって他の処理を止めない）。
 */
export async function confirmMaterialSubmissionAction(
  input: ConfirmMaterialSubmissionInput,
): Promise<ConfirmMaterialSubmissionResult> {
  const title = String(input?.title ?? "").trim();
  if (!title) {
    return { error: "素材の内容（タイトル）を入力してください", submissionId: null };
  }

  const tokenClient = await resolveTokenClient(input?.token);
  if (!tokenClient) {
    return { error: "このURLは無効です", submissionId: null };
  }

  const submissionId = String(input?.submissionId ?? "");
  if (!UUID_PATTERN.test(submissionId)) {
    return { error: "送信内容が不正です。もう一度お試しください", submissionId: null };
  }

  const drive = await getDriveService();
  const expectedFileCount = Number(input?.expectedFileCount) || 0;
  const uploaded = Array.isArray(input?.uploaded) ? input.uploaded : [];

  let driveFolderId: string | null = null;
  let driveFolderUrl: string | null = null;
  const verifiedFiles: MaterialSubmissionFileInput[] = [];

  if (expectedFileCount > 0) {
    const dateFolderName = String(input?.dateFolderName ?? "").trim();
    const claimedFolderId = String(input?.driveFolderId ?? "").trim();
    if (!dateFolderName || !claimedFolderId) {
      return { error: "送信内容が不正です。もう一度お試しください", submissionId: null };
    }

    let folder;
    try {
      folder = await drive.resolveMaterialSubmissionFolder({
        clientId: tokenClient.clientId,
        dateFolderName,
        submissionFolderName: sanitizeSubmissionFolderName(title, submissionId),
      });
    } catch {
      return { error: "送信に失敗しました。時間をおいて再度お試しください", submissionId: null };
    }

    if (folder.folderId !== claimedFolderId) {
      // 他clientのフォルダを申告された、またはtitleが発行時と変わった等。安全側で拒否する。
      await bestEffortCleanup(drive, uploaded);
      return { error: "送信内容が不正です。もう一度お試しください", submissionId: null };
    }
    driveFolderId = folder.folderId;
    driveFolderUrl = folder.folderUrl;

    if (uploaded.length !== expectedFileCount) {
      await bestEffortCleanup(drive, uploaded);
      return { error: "一部のファイルのアップロードに失敗しました。もう一度お試しください", submissionId: null };
    }

    for (const item of uploaded) {
      const driveFileId = String(item?.driveFileId ?? "").trim();
      const driveUrl = String(item?.driveUrl ?? "").trim();
      const fileName = String(item?.fileName ?? "").trim();

      if (!DRIVE_FILE_ID_PATTERN.test(driveFileId) || !driveUrl.startsWith("https://drive.google.com/") || !fileName) {
        await bestEffortCleanup(drive, uploaded);
        return { error: "送信内容が不正です。もう一度お試しください", submissionId: null };
      }

      const meta = await drive.getFileMetadata(driveFileId);
      if (!meta || !meta.parents.includes(folder.folderId)) {
        await bestEffortCleanup(drive, uploaded);
        return { error: "アップロード内容の確認に失敗しました。もう一度お試しください", submissionId: null };
      }

      verifiedFiles.push({ file_name: meta.name || fileName, drive_file_id: meta.id, drive_url: driveUrl });
    }
  }

  const admin = createSupabaseAdminClient();
  const { data: createdSubmissionId, error } = await admin.rpc("create_client_material_submission", {
    p_id: submissionId,
    p_client_id: tokenClient.clientId,
    p_title: title,
    p_post_usage: nullableString(input?.postUsage),
    p_requested_post_timing: nullableString(input?.requestedPostTiming),
    p_editing_instructions: nullableString(input?.editingInstructions),
    p_caption_instructions: nullableString(input?.captionInstructions),
    p_contact_notes: nullableString(input?.contactNotes),
    p_shot_date: nullableString(input?.shotDate),
    p_drive_folder_id: driveFolderId,
    p_drive_folder_url: driveFolderUrl,
    p_files: verifiedFiles,
  });

  if (error || !createdSubmissionId) {
    await bestEffortCleanup(drive, uploaded);
    return { error: "送信に失敗しました。時間をおいて再度お試しください", submissionId: null };
  }

  await notifyAssignedStaffOfNewMaterialSubmission(admin, {
    clientId: tokenClient.clientId,
    clientName: tokenClient.companyName,
    submissionId: createdSubmissionId,
    submissionTitle: title,
  });

  return { error: null, submissionId: createdSubmissionId };
}
