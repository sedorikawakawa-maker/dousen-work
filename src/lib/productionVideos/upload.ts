import "server-only";

import { getDriveService } from "@/lib/drive/DriveService";

/**
 * 制作動画ライブラリの共有フォルダ名。素材のような日付/submission単位のサブフォルダは作らず、
 * {root}/{client_code}_{company_name}/制作動画/ 直下にフラットに積む。
 */
export const PRODUCTION_VIDEO_FOLDER_HINT = "制作動画";

export interface UploadedProductionVideoFile {
  fileName: string;
  driveFileId: string;
  driveUrl: string;
}

/**
 * 制作動画フォルダを1回だけ解決し、複数ファイルを同じフォルダへ順にアップロードする。
 * 1件でも失敗した場合は例外を投げる（呼び出し側でDB未登録のまま処理を止める）。
 */
export async function uploadFilesForProductionVideoLibrary(params: {
  clientId: string;
  files: File[];
}): Promise<UploadedProductionVideoFile[]> {
  if (params.files.length === 0) return [];

  const drive = await getDriveService();
  const folder = await drive.resolveFolder({
    clientId: params.clientId,
    folderHint: PRODUCTION_VIDEO_FOLDER_HINT,
  });

  const uploaded: UploadedProductionVideoFile[] = [];
  for (const file of params.files) {
    const result = await drive.uploadFileToResolvedFolder({ file, folderId: folder.folderId });
    uploaded.push({ fileName: file.name, driveFileId: result.driveFileId, driveUrl: result.driveUrl });
  }
  return uploaded;
}

/** 「Google Driveでまとめて開く」用にフォルダだけ解決する（アップロードしない）。 */
export async function resolveProductionVideoFolder(clientId: string) {
  const drive = await getDriveService();
  return drive.resolveFolder({ clientId, folderHint: PRODUCTION_VIDEO_FOLDER_HINT });
}
