"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";
import { getDriveService } from "@/lib/drive/DriveService";
import { PRODUCTION_VIDEO_FOLDER_HINT } from "@/lib/productionVideos/upload";
import type { PostType } from "@/lib/supabase/database.types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Google DriveのファイルIDは可変長の英数字+ "-" "_"。厳密な仕様は非公開のため、
// 明らかに不正な値（空・記号混入等）だけを弾く緩めのバリデーションに留める。
const DRIVE_FILE_ID_PATTERN = /^[\w-]{10,}$/;
const POST_TYPES: readonly PostType[] = ["reel", "feed", "story"];

function isValidPostType(value: unknown): value is PostType {
  return typeof value === "string" && (POST_TYPES as readonly string[]).includes(value);
}

/**
 * ブラウザが申告したOriginを無条件に信用せず、このリクエスト自体のhost/protoから
 * サーバー側で独立に算出した「期待されるOrigin」とだけ照合する
 * （googleClient.tsのgetRedirectUri()と同じ考え方）。一致すればそのOriginを、
 * 一致しなければサーバー側算出値を使う（＝申告Originは常に無視される）。
 * これにより、開発(localhost)・本番(Netlifyドメイン)のどちらでもハードコードなしで
 * 安全に検証できる。
 */
async function resolveValidatedOrigin(claimedOrigin: string | undefined): Promise<string> {
  const { headers } = await import("next/headers");
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  const expectedOrigin = `${proto}://${host}`;
  return claimedOrigin === expectedOrigin ? claimedOrigin : expectedOrigin;
}

// ---------------------------------------------------------------------------
// ブラウザ→Google Drive直接アップロード方式（Netlify Functionsへ動画本体を
// 通さないための新経路）。以下の2アクションはproduction-videos/クライアント
// 詳細「制作動画」タブの両方から共通で使う。
// ---------------------------------------------------------------------------

export interface ProductionVideoUploadSessionRequest {
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
}

export interface ProductionVideoUploadSession {
  /** ブラウザ側で各ファイルと結果を紐付けるための一時ID（DBには保存しない）。 */
  tempId: string;
  sessionUrl: string;
}

export interface CreateProductionVideoUploadSessionsResult {
  error: string | null;
  sessions: ProductionVideoUploadSession[];
}

/**
 * ① 顧客の「制作動画」フォルダを1回だけ解決し、②ファイルごとにresumable upload
 * sessionを発行してブラウザへ返す。動画本体はまだ一切扱わない（メタデータのみ）。
 * access token・refresh token等はこの関数の外（戻り値）には一切含めない。
 */
export async function createProductionVideoUploadSessionsAction(
  clientId: string,
  files: ProductionVideoUploadSessionRequest[],
  browserOrigin?: string,
): Promise<CreateProductionVideoUploadSessionsResult> {
  const staff = await getCurrentStaff();
  if (!staff) return { error: "ログインが必要です。", sessions: [] };

  const trimmedClientId = String(clientId ?? "").trim();
  if (!UUID_PATTERN.test(trimmedClientId)) {
    return { error: "顧客を選択してください。", sessions: [] };
  }
  if (!Array.isArray(files) || files.length === 0) {
    return { error: "ファイルを選択してください。", sessions: [] };
  }

  try {
    const validatedOrigin = await resolveValidatedOrigin(browserOrigin);
    const drive = await getDriveService();
    const folder = await drive.resolveFolder({
      clientId: trimmedClientId,
      folderHint: PRODUCTION_VIDEO_FOLDER_HINT,
    });

    const sessions: ProductionVideoUploadSession[] = [];
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
      sessions.push({ tempId: crypto.randomUUID(), sessionUrl });
    }

    return { error: null, sessions };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Google Driveとの接続に失敗しました。時間をおいて再度お試しください。",
      sessions: [],
    };
  }
}

export interface ProductionVideoUploadedFile {
  fileName: string;
  driveFileId: string;
  driveUrl: string;
}

export interface ConfirmProductionVideoUploadInput {
  clientId: string;
  postType: string | null;
  memo: string | null;
  /** ブラウザからGoogle Driveへの直接アップロードに成功したものだけを渡す。 */
  uploaded: ProductionVideoUploadedFile[];
  /**
   * アップロードに失敗したがGoogle Drive側にファイル実体が作成されてしまった場合の
   * driveFileId（後始末用、ベストエフォート削除の対象）。通常は空配列で問題ない。
   */
  orphanedDriveFileIds?: string[];
}

export interface ConfirmProductionVideoUploadResult {
  error: string | null;
  savedCount: number;
}

/**
 * ④⑤: ブラウザでのGoogle Drive直接アップロード成功後、小さいmetadataだけを
 * 受け取ってproduction_videosへ登録する。ブラウザから届く値は一切信用せず、
 * clientIdの実在確認・driveFileId/driveUrlの形式チェックを行った上で、
 * 検証を通ったものだけを登録する。
 */
export async function confirmProductionVideoUploadAction(
  input: ConfirmProductionVideoUploadInput,
): Promise<ConfirmProductionVideoUploadResult> {
  const staff = await getCurrentStaff();
  if (!staff) return { error: "ログインが必要です。", savedCount: 0 };

  const clientId = String(input.clientId ?? "").trim();
  if (!UUID_PATTERN.test(clientId)) {
    return { error: "顧客の指定が不正です。", savedCount: 0 };
  }

  const supabase = await createSupabaseServerClient();

  // clientIdの実在確認（clients_view経由。存在しない/アクセス不可なIDでの登録を防ぐ）。
  const { data: clientRow } = await supabase.from("clients_view").select("id").eq("id", clientId).maybeSingle();
  if (!clientRow) {
    return { error: "顧客が見つかりません。", savedCount: 0 };
  }

  const postType = isValidPostType(input.postType) ? input.postType : null;
  const memo = typeof input.memo === "string" && input.memo.trim() !== "" ? input.memo.trim() : null;

  const validUploaded = (Array.isArray(input.uploaded) ? input.uploaded : []).filter(
    (item): item is ProductionVideoUploadedFile =>
      typeof item?.fileName === "string" &&
      item.fileName.trim() !== "" &&
      typeof item?.driveFileId === "string" &&
      DRIVE_FILE_ID_PATTERN.test(item.driveFileId) &&
      typeof item?.driveUrl === "string" &&
      item.driveUrl.startsWith("https://drive.google.com/"),
  );

  let savedCount = 0;
  if (validUploaded.length > 0) {
    const { error } = await supabase.from("production_videos").insert(
      validUploaded.map((file) => ({
        client_id: clientId,
        post_type: postType,
        file_name: file.fileName.trim(),
        drive_file_id: file.driveFileId,
        drive_url: file.driveUrl,
        memo,
        uploaded_by_staff_id: staff.id,
      })),
    );
    if (error) {
      return { error: "登録に失敗しました。時間をおいて再度お試しください。", savedCount: 0 };
    }
    savedCount = validUploaded.length;
  }

  // 失敗分の後始末（補助処理）。失敗しても成功分の登録結果には影響させない。
  const orphanedIds = (input.orphanedDriveFileIds ?? []).filter((id) => DRIVE_FILE_ID_PATTERN.test(id));
  if (orphanedIds.length > 0) {
    try {
      const drive = await getDriveService();
      await Promise.all(orphanedIds.map((id) => drive.deleteFile(id)));
    } catch {
      // ベストエフォートのため無視する。
    }
  }

  return { error: null, savedCount };
}
