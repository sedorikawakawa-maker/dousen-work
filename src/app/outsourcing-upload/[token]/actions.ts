"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashOutsourcingToken } from "@/lib/outsourcing/token";
import { getDriveService } from "@/lib/drive/DriveService";
import { validateBrowserOrigin } from "@/lib/http/origin";

const UPLOADABLE_STATUSES = new Set(["requested", "in_progress"]);
// Google DriveのファイルIDは可変長の英数字+ "-" "_"。厳密な仕様は非公開のため、
// 明らかに不正な値だけを弾く緩めのバリデーションに留める（production-videos/material-formと同じ方針）。
const DRIVE_FILE_ID_PATTERN = /^[\w-]{6,}$/;

const OUTSOURCING_FOLDER_HINT = "outsourcing";

/**
 * token→outsourcing_requestの再検証。既存submitClientDeliveryActionと全く同じ
 * セキュリティモデル(upload_token_hash一致 + アップロード可能なstatusか)。
 * ブラウザからclient_id/production_task_id/outsourcing_request_id等を受け取ることは
 * 一切なく、常にこの関数の結果だけを信頼する。session発行Action・確定Actionの
 * 両方から呼ぶ（このファイル内で1箇所に集約し、検証ロジックが2箇所でずれないようにする）。
 */
async function resolveTokenRequest(token: string) {
  const admin = createSupabaseAdminClient();
  const tokenHash = hashOutsourcingToken(String(token ?? ""));

  const { data: request } = await admin
    .from("outsourcing_requests")
    .select("id, client_id, status, created_by_staff_id, title")
    .eq("upload_token_hash", tokenHash)
    .maybeSingle();

  if (!request || !UPLOADABLE_STATUSES.has(request.status)) return null;
  return request;
}

// ---------------------------------------------------------------------------
// ブラウザ→Google Drive直接アップロード方式（Netlify Functionsへ納品ファイル本体を
// 通さないための新経路。production-videos/material-formと同じ汎用DriveService/
// Origin検証をそのまま再利用。outsourcing-upload専用のDrive処理は追加しない）。
//
// 既存仕様どおり1納品=1ファイル（または1手動URL）。material-formのような
// 複数ファイル・all-or-nothingの概念は元々このスキーマ(outsourcing_deliveries)には
// 存在しないため、新たに持ち込まない。
// ---------------------------------------------------------------------------

export interface CreateOutsourcingUploadSessionResult {
  error: string | null;
  sessionUrl: string | null;
}

export async function createOutsourcingUploadSessionAction(
  token: string,
  file: { fileName: string; mimeType: string; fileSizeBytes: number },
  browserOrigin?: string,
): Promise<CreateOutsourcingUploadSessionResult> {
  const request = await resolveTokenRequest(token);
  if (!request) {
    return { error: "このURLは現在利用できません", sessionUrl: null };
  }

  const fileName = String(file?.fileName ?? "").trim();
  if (!fileName) {
    return { error: "ファイルを選択してください", sessionUrl: null };
  }

  try {
    const validatedOrigin = await validateBrowserOrigin(browserOrigin);
    const drive = await getDriveService();
    // 既存のuploadFile()と全く同じフォルダ解決(顧客の"outsourcing"共有フォルダ)を再利用する。
    const folder = await drive.resolveFolder({
      clientId: request.client_id ?? "unassigned",
      folderHint: OUTSOURCING_FOLDER_HINT,
    });
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
      error: err instanceof Error ? err.message : "格納の準備に失敗しました。時間をおいて再度お試しください",
      sessionUrl: null,
    };
  }
}

export interface ConfirmOutsourcingDeliveryInput {
  token: string;
  /** ブラウザ→Drive直接PUTに成功した場合のみ指定する。 */
  driveFileId: string | null;
  driveUrl: string | null;
  /** ファイルを添付しない場合の代替入力（既存仕様どおり）。 */
  manualDriveUrl: string | null;
  contractorNote: string | null;
}

export interface ConfirmOutsourcingDeliveryResult {
  error: string | null;
  deliveryId: string | null;
}

/**
 * 確定登録。ブラウザから届く値は一切信用せず、以下をサーバー側で再検証してから
 * 初めてDB登録する。
 *  - token→outsourcing_requestを再検証（ブラウザ申告のclient_id/request_idは受け取らない）
 *  - driveFileIdが申告された場合、session発行時と全く同じ手順でフォルダを再解決し、
 *    Drive API自体にfileの実在・親フォルダ一致を確認（任意のdrive_file_id注入を防ぐ）
 * 検証に失敗した場合、Driveへアップロードされてしまった分はベストエフォートで削除する
 * （後始末の失敗によって他の処理を止めない）。
 */
export async function confirmOutsourcingDeliveryAction(
  input: ConfirmOutsourcingDeliveryInput,
): Promise<ConfirmOutsourcingDeliveryResult> {
  const request = await resolveTokenRequest(input?.token);
  if (!request) {
    return { error: "このURLは現在利用できません", deliveryId: null };
  }

  const drive = await getDriveService();
  const claimedFileId = String(input?.driveFileId ?? "").trim();
  const claimedUrl = String(input?.driveUrl ?? "").trim();
  const manualUrl = String(input?.manualDriveUrl ?? "").trim();

  let driveFileId: string | null = null;
  let driveUrl: string | null = null;

  if (claimedFileId) {
    if (!DRIVE_FILE_ID_PATTERN.test(claimedFileId) || !claimedUrl.startsWith("https://drive.google.com/")) {
      await drive.deleteFile(claimedFileId).catch(() => {});
      return { error: "送信内容が不正です。もう一度お試しください", deliveryId: null };
    }

    let folder;
    try {
      folder = await drive.resolveFolder({
        clientId: request.client_id ?? "unassigned",
        folderHint: OUTSOURCING_FOLDER_HINT,
      });
    } catch {
      return { error: "送信に失敗しました。時間をおいて再度お試しください", deliveryId: null };
    }

    const meta = await drive.getFileMetadata(claimedFileId);
    if (!meta || !meta.parents.includes(folder.folderId)) {
      await drive.deleteFile(claimedFileId).catch(() => {});
      return { error: "アップロード内容の確認に失敗しました。もう一度お試しください", deliveryId: null };
    }

    driveFileId = meta.id;
    driveUrl = claimedUrl;
  } else if (manualUrl) {
    driveUrl = manualUrl;
  }

  if (!driveUrl) {
    return { error: "ファイルを選択するか、保存先URLを入力してください", deliveryId: null };
  }

  const contractorNote = String(input?.contractorNote ?? "").trim() || null;

  const admin = createSupabaseAdminClient();
  const { data: deliveryId, error } = await admin.rpc("create_outsourcing_delivery", {
    p_outsourcing_request_id: request.id,
    p_drive_file_id: driveFileId,
    p_drive_url: driveUrl,
    p_contractor_note: contractorNote,
  });

  if (error || !deliveryId) {
    if (driveFileId) await drive.deleteFile(driveFileId).catch(() => {});
    return { error: "送信に失敗しました", deliveryId: null };
  }

  await admin.from("notifications").insert({
    recipient_staff_id: request.created_by_staff_id,
    notification_type: "outsourcing_delivered",
    title: `外注納品: ${request.title}`,
    body: null,
    entity_type: "outsourcing_request",
    entity_id: request.id,
  });

  return { error: null, deliveryId };
}
