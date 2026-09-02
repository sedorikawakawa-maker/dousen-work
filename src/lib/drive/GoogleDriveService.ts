import "server-only";
import type {
  CreateResumableUploadSessionInput,
  DriveFileMetadata,
  DriveFolderRef,
  DriveService,
  DriveUploadInput,
  DriveUploadResult,
  ResolveFolderInput,
  ResolveMaterialSubmissionFolderInput,
  ResumableUploadSession,
  UploadToResolvedFolderInput,
} from "./DriveService";
import { getDriveIntegrationRow, getDecryptedRefreshToken } from "@/lib/googleDrive/repository";
import { createAuthorizedClient, getDriveClient, describeGoogleError } from "@/lib/googleDrive/googleClient";
import {
  createResumableSession,
  findOrCreateFolder,
  resolveClientFolder,
  uploadFileToFolder,
} from "@/lib/googleDrive/driveOperations";
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

  /**
   * {root}/{client_code}_{company_name}/{folderHint}/ を解決するだけ（アップロードしない）。
   * resolveClientFolder自体はfinal/outsourcingと共通で、folderHintが同じなら同じフォルダを再利用する。
   */
  async resolveFolder(input: ResolveFolderInput): Promise<DriveFolderRef> {
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
      const folderId = await resolveClientFolder(drive, {
        rootFolderId: row.root_folder_id,
        clientCode: resolvedClientCode,
        companyName,
        folderHint: input.folderHint,
      });
      return { folderId, folderUrl: `https://drive.google.com/drive/folders/${folderId}` };
    } catch (err) {
      throw new Error(describeGoogleError(err));
    }
  }

  /**
   * ブラウザが直接PUTできるresumable upload sessionを発行する。access tokenは
   * この関数の中だけで使い、戻り値のsessionUrlにも含めない（Google側が発行する
   * opaqueなsession識別子のみ。session URL自体はDBへの保存・ログ出力も行わない）。
   */
  async createResumableUploadSession(input: CreateResumableUploadSessionInput): Promise<ResumableUploadSession> {
    const row = await getDriveIntegrationRow();
    if (!row || row.status !== "connected" || !row.refresh_token_encrypted) {
      throw new Error("Google Driveが連携されていません。管理者にご連絡ください。");
    }

    const refreshToken = await getDecryptedRefreshToken();
    if (!refreshToken) {
      throw new Error("Google Drive連携が無効です。管理者にご連絡ください。");
    }

    let authClient;
    try {
      authClient = await createAuthorizedClient(refreshToken);
    } catch (err) {
      throw new Error(describeGoogleError(err));
    }

    try {
      const sessionUrl = await createResumableSession(authClient, {
        folderId: input.folderId,
        fileName: input.file.name,
        mimeType: input.file.mimeType,
        fileSizeBytes: input.file.sizeBytes,
        origin: input.origin,
      });
      return { sessionUrl };
    } catch (err) {
      throw new Error(describeGoogleError(err));
    }
  }

  /** ベストエフォート削除。失敗しても呼び出し側の処理は継続させるため例外は投げない。 */
  async deleteFile(fileId: string): Promise<void> {
    try {
      const refreshToken = await getDecryptedRefreshToken();
      if (!refreshToken) return;
      const authClient = await createAuthorizedClient(refreshToken);
      const drive = getDriveClient(authClient);
      await drive.files.delete({ fileId });
    } catch {
      // ベストエフォートのため無視する。
    }
  }

  /**
   * ファイル（フォルダも同じFileリソースなので可）のid/name/親フォルダID一覧を取得する。
   * ブラウザ申告のdrive_file_idが本当に想定フォルダ内に存在するかの検証に使う
   * （material-form等の外部公開フォームでの不正な値の注入を防ぐ）。
   * 存在しない・アクセス不可の場合はnullを返す（例外にしない。呼び出し側は
   * nullを「検証失敗」として扱う）。
   */
  async getFileMetadata(fileId: string): Promise<DriveFileMetadata | null> {
    try {
      const refreshToken = await getDecryptedRefreshToken();
      if (!refreshToken) return null;
      const authClient = await createAuthorizedClient(refreshToken);
      const drive = getDriveClient(authClient);
      const { data } = await drive.files.get({ fileId, fields: "id, name, parents" });
      if (!data.id) return null;
      return { id: data.id, name: data.name ?? "", parents: data.parents ?? [] };
    } catch {
      return null;
    }
  }
}
