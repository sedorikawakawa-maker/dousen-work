import "server-only";

import { getDriveService } from "@/lib/drive/DriveService";
import { getMaterialUploadDateFolderName } from "@/lib/materials/uploadDateFolder";
import { sanitizeSubmissionFolderName } from "@/lib/materials/submissionFolderName";
import type { MaterialSubmissionFileInput } from "@/lib/supabase/database.types";

export interface SubmissionUploadResult {
  submissionId: string;
  driveFolderId: string | null;
  driveFolderUrl: string | null;
  files: MaterialSubmissionFileInput[];
}

/**
 * 顧客向けフォーム・スタッフ手動登録の両方で共通して使う、
 * 「submission ID確定 → submission専用Driveフォルダ作成 → 全ファイルアップロード」の処理。
 * ファイルが0件の場合はDriveフォルダを作らない（フォルダは常にファイルを1件以上含む）。
 * 途中で失敗した場合は例外を投げる（呼び出し側の既存のtry/catchでDB未登録のまま処理を止める）。
 */
export async function uploadFilesForMaterialSubmission(params: {
  clientId: string;
  title: string;
  files: File[];
}): Promise<SubmissionUploadResult> {
  const submissionId = crypto.randomUUID();

  if (params.files.length === 0) {
    return { submissionId, driveFolderId: null, driveFolderUrl: null, files: [] };
  }

  const drive = await getDriveService();
  const dateFolderName = getMaterialUploadDateFolderName();
  const submissionFolderName = sanitizeSubmissionFolderName(params.title, submissionId);

  const folder = await drive.resolveMaterialSubmissionFolder({
    clientId: params.clientId,
    dateFolderName,
    submissionFolderName,
  });

  const uploadedFiles: MaterialSubmissionFileInput[] = [];
  for (const file of params.files) {
    const result = await drive.uploadFileToResolvedFolder({ file, folderId: folder.folderId });
    uploadedFiles.push({ file_name: file.name, drive_file_id: result.driveFileId, drive_url: result.driveUrl });
  }

  return {
    submissionId,
    driveFolderId: folder.folderId,
    driveFolderUrl: folder.folderUrl,
    files: uploadedFiles,
  };
}
