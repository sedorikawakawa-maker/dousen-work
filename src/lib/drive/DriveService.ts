import "server-only";

// Google Drive 連携の抽象層。
// 本番実装(実際のGoogle Drive API呼び出し)に差し替える際は、この interface を満たす
// クラスを追加し、getDriveService() の分岐を変えるだけでよい構成にしている。
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

export interface DriveService {
  uploadFile(input: DriveUploadInput): Promise<DriveUploadResult>;
}

/**
 * モック実装。
 * 現時点ではGoogle Drive OAuth認証情報が無いため、実ファイルはどこにも永続化せず、
 * ダミーの driveFileId / driveUrl のみを発行する（ファイル本体は破棄される）。
 * ローカル開発・デモ用途の暫定実装であり、本番運用前に実DriveServiceへの
 * 差し替えが必要。
 */
class MockDriveService implements DriveService {
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
}

let cachedService: DriveService | null = null;

export function getDriveService(): DriveService {
  if (!cachedService) {
    // GOOGLE_DRIVE_CLIENT_ID等が設定され、実DriveServiceを実装した際はここで分岐する。
    // 例: cachedService = process.env.GOOGLE_DRIVE_CLIENT_ID ? new GoogleDriveService() : new MockDriveService();
    cachedService = new MockDriveService();
  }
  return cachedService;
}
