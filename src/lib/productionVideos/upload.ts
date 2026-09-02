import "server-only";

import { getDriveService } from "@/lib/drive/DriveService";

/**
 * 制作動画ライブラリの共有フォルダ名。素材のような日付/submission単位のサブフォルダは作らず、
 * {root}/{client_code}_{company_name}/制作動画/ 直下にフラットに積む。
 */
export const PRODUCTION_VIDEO_FOLDER_HINT = "制作動画";

/** 「Google Driveでまとめて開く」用にフォルダだけ解決する（アップロードしない）。 */
export async function resolveProductionVideoFolder(clientId: string) {
  const drive = await getDriveService();
  return drive.resolveFolder({ clientId, folderHint: PRODUCTION_VIDEO_FOLDER_HINT });
}
