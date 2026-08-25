import "server-only";

// Google Drive 連携の抽象層。
// 本番実装(実際のGoogle Drive API呼び出し)は GoogleDriveService が満たす。
// OAuth token / refresh token はサーバー側のみで扱い、ブラウザへは一切露出させない
// (docs/security.md 準拠)。

export interface DriveUploadInput {
  file: File;
  clientId: string;
  /** フォルダ分けのヒント（例: "materials", "final"）。実装側で顧客フォルダ配下に振り分ける想定。 */
  folderHint?: string;
}

export interface DriveUploadResult {
  driveFileId: string;
  driveUrl: string;
}

export interface DriveFolderRef {
  folderId: string;
  folderUrl: string;
}

export interface ResolveMaterialSubmissionFolderInput {
  clientId: string;
  /** 顧客フォルダ直下の日付フォルダ名（YYYY-MM-DD）。 */
  dateFolderName: string;
  /** 日付フォルダ配下に作るsubmission専用フォルダ名（呼び出し側でサニタイズ・一意化済みの前提）。 */
  submissionFolderName: string;
}

export interface UploadToResolvedFolderInput {
  file: File;
  folderId: string;
}

export interface DriveService {
  /** モック実装かどうか。UI側で開発環境の注意書き表示判定に使う。 */
  readonly isMock: boolean;
  uploadFile(input: DriveUploadInput): Promise<DriveUploadResult>;
  /**
   * material_submission専用: 顧客フォルダ/日付フォルダ配下にsubmission専用フォルダを解決(作成)する。
   * titleだけでの検索・再利用は行わない（呼び出し側がsubmission毎に一意な名前を渡す前提）。
   * final/outsourcingの用途では使わない。
   */
  resolveMaterialSubmissionFolder(input: ResolveMaterialSubmissionFolderInput): Promise<DriveFolderRef>;
  /** 上記で解決済みのフォルダへ直接アップロードする（folderHintによる再解決は行わない）。 */
  uploadFileToResolvedFolder(input: UploadToResolvedFolderInput): Promise<DriveUploadResult>;
}

/**
 * モック実装。
 * 実ファイルはどこにも永続化せず、ダミーの driveFileId / driveUrl のみを発行する
 * （ファイル本体は破棄される）。**開発環境専用**で、本番では絶対に使用されない
 * （getDriveService() 側でNODE_ENV=productionでは選択されないよう制御している）。
 */
class MockDriveService implements DriveService {
  readonly isMock = true;

  async uploadFile({ file, clientId, folderHint }: DriveUploadInput): Promise<DriveUploadResult> {
    const id = `mock-${crypto.randomUUID()}`;
    const folder = folderHint ? `${folderHint}/` : "";
    return {
      driveFileId: id,
      driveUrl: `https://drive.google.com/mock-storage/${clientId}/${folder}${encodeURIComponent(
        file.name,
      )}?id=${id}`,
    };
  }

  async resolveMaterialSubmissionFolder({
    clientId,
    dateFolderName,
    submissionFolderName,
  }: ResolveMaterialSubmissionFolderInput): Promise<DriveFolderRef> {
    const id = `mock-folder-${crypto.randomUUID()}`;
    return {
      folderId: id,
      folderUrl: `https://drive.google.com/mock-storage/${clientId}/${dateFolderName}/${encodeURIComponent(
        submissionFolderName,
      )}?id=${id}`,
    };
  }

  async uploadFileToResolvedFolder({ file, folderId }: UploadToResolvedFolderInput): Promise<DriveUploadResult> {
    const id = `mock-${crypto.randomUUID()}`;
    return {
      driveFileId: id,
      driveUrl: `https://drive.google.com/mock-storage/folder/${folderId}/${encodeURIComponent(file.name)}?id=${id}`,
    };
  }
}

interface DriveConfigCheck {
  ok: boolean;
  reason: string | null;
}

async function checkDriveConfigured(): Promise<DriveConfigCheck> {
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return { ok: false, reason: "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET が未設定です。" };
  }

  try {
    const { loadEncryptionKey } = await import("@/lib/googleDrive/tokenCrypto");
    loadEncryptionKey();
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "DRIVE_TOKEN_ENCRYPTION_KEY が不正です。" };
  }

  const { getDriveIntegrationRow } = await import("@/lib/googleDrive/repository");
  const row = await getDriveIntegrationRow();
  if (!row || row.status !== "connected" || !row.refresh_token_encrypted) {
    return { ok: false, reason: "Google Driveが連携されていません。" };
  }
  if (!row.root_folder_id) {
    return { ok: false, reason: "Google Driveの保存先フォルダが設定されていません。" };
  }

  return { ok: true, reason: null };
}

/**
 * 実行時に毎回、現在のDB上の連携状態を確認して実装を選ぶ
 * （管理画面からの接続/解除がすぐ反映されるよう、モジュールレベルではキャッシュしない）。
 * 本番環境では設定不備があってもMockへフォールバックせず、必ず例外を投げる。
 */
export async function getDriveService(): Promise<DriveService> {
  const configured = await checkDriveConfigured();

  if (configured.ok) {
    const { GoogleDriveService } = await import("./GoogleDriveService");
    return new GoogleDriveService();
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(`Google Drive連携が利用できません: ${configured.reason}`);
  }

  return new MockDriveService();
}
