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

export interface ResolveFolderInput {
  clientId: string;
  /** 顧客フォルダ直下の用途フォルダ名（例: "制作動画"）。無ければ作成、あれば再利用する。 */
  folderHint: string;
}

export interface CreateResumableUploadSessionInput {
  /** アップロード先フォルダID（resolveFolder等で事前に解決済みのもの。複数ファイルでも1回の解決結果を使い回す）。 */
  folderId: string;
  file: {
    name: string;
    mimeType: string;
    sizeBytes: number;
  };
  /**
   * ブラウザがPUTする際のOrigin（呼び出し元でホワイトリスト検証済みのものだけを渡すこと）。
   * session開始POSTにこのOriginを付与することで、後続のブラウザPUTがCORSで
   * ブロックされないようにする狙いの検証用パラメータ。
   */
  origin?: string;
}

export interface ResumableUploadSession {
  /** ブラウザが直接PUTする先のURL。access token等の秘密情報は含まれない（Google発行のopaqueなsession識別子のみ）。 */
  sessionUrl: string;
}

export interface DriveFileMetadata {
  id: string;
  name: string;
  /** 親フォルダID一覧。「ブラウザが申告したdriveFileIdが本当に想定フォルダ内にあるか」の検証に使う。 */
  parents: string[];
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
  /**
   * {root}/{client_code}_{company_name}/{folderHint}/ を解決(無ければ作成)して返すだけの汎用メソッド。
   * ファイルはアップロードしない。制作動画ライブラリのように「同じ共有フォルダへ複数ファイルを
   * まとめて置く」用途（1回resolve→uploadFileToResolvedFolderを複数回）や、
   * フォルダを開くリンクの表示に使う。
   */
  resolveFolder(input: ResolveFolderInput): Promise<DriveFolderRef>;
  /**
   * 汎用: 指定フォルダへの1ファイル分のresumable upload sessionを発行する。
   * ブラウザがこのsession URLへ直接PUTすることで、動画本体をNetlify Functions
   * （Server Action）のリクエストボディへ一切通さずにGoogle Driveへ送れる。
   * access token自体はこの呼び出しの外（ブラウザ側）へは一切渡らない。
   * production-videos専用ではなく、将来material-form/outsourcing-upload/
   * post_records final等でも同じ形で流用できる汎用メソッドとして設計している。
   */
  createResumableUploadSession(input: CreateResumableUploadSessionInput): Promise<ResumableUploadSession>;
  /** resumable upload失敗時の後始末など、ベストエフォートで使うファイル削除。 */
  deleteFile(fileId: string): Promise<void>;
  /**
   * 汎用: ファイル（またはフォルダ）のメタデータ（id/name/親フォルダID一覧）を取得する。
   * ブラウザから申告されたdrive_file_id等を無条件に信用せず、実際に想定フォルダ内に
   * 存在するかをサーバー側で検証する用途（material-form等の外部公開フォームで重要）。
   * 存在しない/取得できない場合はnullを返す（例外は投げない）。
   */
  getFileMetadata(fileId: string): Promise<DriveFileMetadata | null>;
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

  /**
   * clientId+dateFolderName+submissionFolderNameから決定的なIDを作る
   * （実Driveのfindorcreateと同じく、同じ組み合わせなら毎回同じフォルダに解決される。
   * material-formのconfirm時にsession発行時と同じ呼び出しを再度行いfolderIdの
   * 一致を検証するため、ここが非決定的だと検証が常に失敗してしまう）。
   */
  async resolveMaterialSubmissionFolder({
    clientId,
    dateFolderName,
    submissionFolderName,
  }: ResolveMaterialSubmissionFolderInput): Promise<DriveFolderRef> {
    const id = `mock-folder-${clientId}-${dateFolderName}-${submissionFolderName}`;
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

  /** clientId+folderHintから決定的なIDを作る（同じ組み合わせなら毎回同じフォルダに解決される）。 */
  async resolveFolder({ clientId, folderHint }: ResolveFolderInput): Promise<DriveFolderRef> {
    const id = `mock-folder-${clientId}-${folderHint}`;
    return {
      folderId: id,
      folderUrl: `https://drive.google.com/mock-storage/${clientId}/${encodeURIComponent(folderHint)}?id=${id}`,
    };
  }

  /**
   * 実Driveへは接続しないため、ブラウザが直接PUTできる先として自サーバー内の
   * モック受け口（/api/mock-drive-upload/[sessionId]）を返す。ブラウザ側のコード
   * （PUTしてid/webViewLinkのJSONを受け取る）は本番のresumable経路と全く同じまま動く。
   * 本番コード側で「localhostだから旧経路」のような分岐は行わない。
   */
  async createResumableUploadSession({
    folderId,
    file,
  }: CreateResumableUploadSessionInput): Promise<ResumableUploadSession> {
    const { headers } = await import("next/headers");
    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
    const proto = headerList.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
    const sessionId = crypto.randomUUID();
    // folderIdもクエリに載せておき、モック受け口が「folder+nameを埋め込んだ自己記述的な
    // fileId」を生成できるようにする（getFileMetadataでの検証を成立させるため）。
    const query = new URLSearchParams({ name: file.name, folder: folderId });
    return { sessionUrl: `${proto}://${host}/api/mock-drive-upload/${sessionId}?${query.toString()}` };
  }

  /** モックには実体が無いため何もしない。 */
  async deleteFile(): Promise<void> {}

  /**
   * モックのfileIdは`/api/mock-drive-upload`が発行した自己記述的な値
   * （folder/nameをbase64url埋め込みしたもの）。それをデコードして返すだけで、
   * 実Driveへの問い合わせは行わない。
   */
  async getFileMetadata(fileId: string): Promise<DriveFileMetadata | null> {
    const decoded = decodeMockFileId(fileId);
    if (!decoded) return null;
    return { id: fileId, name: decoded.name, parents: [decoded.folder] };
  }
}

const MOCK_FILE_ID_PREFIX = "mock-";

export function encodeMockFileId(folder: string, name: string): string {
  const payload = Buffer.from(JSON.stringify({ folder, name }), "utf8").toString("base64url");
  return `${MOCK_FILE_ID_PREFIX}${payload}`;
}

function decodeMockFileId(fileId: string): { folder: string; name: string } | null {
  if (!fileId.startsWith(MOCK_FILE_ID_PREFIX)) return null;
  try {
    const json = Buffer.from(fileId.slice(MOCK_FILE_ID_PREFIX.length), "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (typeof parsed?.folder === "string" && typeof parsed?.name === "string") {
      return { folder: parsed.folder, name: parsed.name };
    }
    return null;
  } catch {
    return null;
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
