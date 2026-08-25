import "server-only";
import type {
  DriveFolderRef,
  DriveService,
  DriveUploadInput,
  DriveUploadResult,
  ResolveMaterialSubmissionFolderInput,
  UploadToResolvedFolderInput,
} from "./DriveService";
import { getDriveIntegrationRow, getDecryptedRefreshToken } from "@/lib/googleDrive/repository";
import { createAuthorizedClient, getDriveClient, describeGoogleError } from "@/lib/googleDrive/googleClient";
import { findOrCreateFolder, resolveClientFolder, uploadFileToFolder } from "@/lib/googleDrive/driveOperations";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 実Google Drive実装。設定不備時はMockへフォールバックせず、必ず例外を投げる。 */
export class GoogleDriveService implements DriveService {
  readonly isMock = false;

  async uploadFile(input: DriveUploadInput): Promise<DriveUploadResult> {
    const row = await getDriveIntegrationRow();
    if (!row || row.status !== "connected" || !row.refresh_token_encrypted) {
      throw new Error("Google Driveが連携されていません。管理者にご連絡ください。");
    }
    if (!row.root_folder_id) {
      throw new Error("Google Driveの保存先フォルダが設定されていません。管理者にご連絡ください。");
    }

    const refreshToken = await getDecryptedRefreshToken();
    if (!refreshToken) {
      throw new Error("Google Drive連携が無効です。管理者にご連絡ください。");
    }

    let drive;
    try {
      const authClient = await createAuthorizedClient(refreshToken);
      drive = getDriveClient(authClient);
    } catch (err) {
      throw new Error(describeGoogleError(err));
    }

    const clientCode = "unknown";
    let resolvedClientCode = clientCode;
    let companyName = input.clientId;

    if (UUID_PATTERN.test(input.clientId)) {
      const admin = createSupabaseAdminClient();
      const { data: client } = await admin
        .from("clients")
        .select("client_code, company_name")
        .eq("id", input.clientId)
        .maybeSingle();
      if (client) {
        resolvedClientCode = client.client_code;
        companyName = client.company_name;
      }
    }

    try {
      const folderId = await resolveClientFolder(drive, {
        rootFolderId: row.root_folder_id,
        clientCode: resolvedClientCode,
        companyName,
        folderHint: input.folderHint ?? "misc",
      });

      return await uploadFileToFolder(drive, { file: input.file, folderId });
    } catch (err) {
      throw new Error(describeGoogleError(err));
    }
  }

  /**
   * material_submission専用: 顧客フォルダ/日付フォルダ配下にsubmission専用フォルダを解決する。
   * resolveClientFolder自体は変更せず、日付フォルダの取得にそのまま利用したうえで、
   * その配下にsubmissionフォルダをもう1段作成する（final/outsourcingには影響しない）。
   */
  async resolveMaterialSubmissionFolder(input: ResolveMaterialSubmissionFolderInput): Promise<DriveFolderRef> {
    const row = await getDriveIntegrationRow();
    if (!row || row.status !== "connected" || !row.refresh_token_encrypted) {
      throw new Error("Google Driveが連携されていません。管理者にご連絡ください。");
    }
    if (!row.root_folder_id) {
      throw new Error("Google Driveの保存先フォルダが設定されていません。管理者にご連絡ください。");
    }

    const refreshToken = await getDecryptedRefreshToken();
    if (!refreshToken) {
      throw new Error("Google Drive連携が無効です。管理者にご連絡ください。");
    }

    let drive;
    try {
      const authClient = await createAuthorizedClient(refreshToken);
      drive = getDriveClient(authClient);
    } catch (err) {
      throw new Error(describeGoogleError(err));
    }

    let resolvedClientCode = "unknown";
    let companyName = input.clientId;
    if (UUID_PATTERN.test(input.clientId)) {
      const admin = createSupabaseAdminClient();
      const { data: client } = await admin
        .from("clients")
        .select("client_code, company_name")
        .eq("id", input.clientId)
        .maybeSingle();
      if (client) {
        resolvedClientCode = client.client_code;
        companyName = client.company_name;
      }
    }

    try {
      const dateFolderId = await resolveClientFolder(drive, {
        rootFolderId: row.root_folder_id,
        clientCode: resolvedClientCode,
        companyName,
        folderHint: input.dateFolderName,
      });
      const submissionFolder = await findOrCreateFolder(drive, input.submissionFolderName, dateFolderId);
      return {
        folderId: submissionFolder.id,
        folderUrl: `https://drive.google.com/drive/folders/${submissionFolder.id}`,
      };
    } catch (err) {
      throw new Error(describeGoogleError(err));
    }
  }

  /** resolveMaterialSubmissionFolderで確定したフォルダへ、再解決せずに直接アップロードする。 */
  async uploadFileToResolvedFolder(input: UploadToResolvedFolderInput): Promise<DriveUploadResult> {
    const row = await getDriveIntegrationRow();
    if (!row || row.status !== "connected" || !row.refresh_token_encrypted) {
      throw new Error("Google Driveが連携されていません。管理者にご連絡ください。");
    }

    const refreshToken = await getDecryptedRefreshToken();
    if (!refreshToken) {
      throw new Error("Google Drive連携が無効です。管理者にご連絡ください。");
    }

    let drive;
    try {
      const authClient = await createAuthorizedClient(refreshToken);
      drive = getDriveClient(authClient);
    } catch (err) {
      throw new Error(describeGoogleError(err));
    }

    try {
      return await uploadFileToFolder(drive, { file: input.file, folderId: input.folderId });
    } catch (err) {
      throw new Error(describeGoogleError(err));
    }
  }
}
