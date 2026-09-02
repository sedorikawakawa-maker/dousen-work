import "server-only";
import type { drive_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { Readable } from "node:stream";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

/** 「既存フォルダを指定」欄はURLのコピペも許容し、URLの場合はIDだけ取り出す。 */
export function extractFolderIdFromInput(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : trimmed;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** 指定した親フォルダ直下から名前でフォルダを探し、無ければ作成する。 */
export async function findOrCreateFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId: string,
): Promise<{ id: string; name: string }> {
  const safeName = escapeDriveQueryValue(name);
  const query = `name = '${safeName}' and '${parentId}' in parents and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`;

  const { data } = await drive.files.list({
    q: query,
    fields: "files(id, name)",
    spaces: "drive",
    pageSize: 1,
  });

  const existing = data.files?.[0];
  if (existing?.id) {
    return { id: existing.id, name: existing.name ?? name };
  }

  const { data: created } = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME_TYPE, parents: [parentId] },
    fields: "id, name",
  });

  if (!created.id) {
    throw new Error("Google Driveへのフォルダ作成に失敗しました。");
  }

  return { id: created.id, name: created.name ?? name };
}

/** 顧客・用途に応じたフォルダを解決する: {root}/{client_code}_{company_name}/{folderHint}/ */
export async function resolveClientFolder(
  drive: drive_v3.Drive,
  params: { rootFolderId: string; clientCode: string; companyName: string; folderHint: string },
): Promise<string> {
  const clientFolderName = `${params.clientCode}_${params.companyName}`;
  const clientFolder = await findOrCreateFolder(drive, clientFolderName, params.rootFolderId);
  const purposeFolder = await findOrCreateFolder(drive, params.folderHint, clientFolder.id);
  return purposeFolder.id;
}

export async function getFolderMeta(
  drive: drive_v3.Drive,
  folderId: string,
): Promise<{ id: string; name: string }> {
  const { data } = await drive.files.get({ fileId: folderId, fields: "id, name" });
  if (!data.id) {
    throw new Error("指定されたフォルダが見つかりません。削除された可能性があります。");
  }
  return { id: data.id, name: data.name ?? "" };
}

export async function createRootFolder(
  drive: drive_v3.Drive,
  name = "DOUSEN WORK 制作データ",
): Promise<{ id: string; name: string }> {
  const { data } = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME_TYPE },
    fields: "id, name",
  });
  if (!data.id) {
    throw new Error("ルートフォルダの作成に失敗しました。");
  }
  return { id: data.id, name: data.name ?? name };
}

export async function uploadFileToFolder(
  drive: drive_v3.Drive,
  params: { file: File; folderId: string },
): Promise<{ driveFileId: string; driveUrl: string }> {
  const arrayBuffer = await params.file.arrayBuffer();
  const stream = Readable.from(Buffer.from(arrayBuffer));

  const { data } = await drive.files.create({
    requestBody: { name: params.file.name, parents: [params.folderId] },
    media: { mimeType: params.file.type || "application/octet-stream", body: stream },
    fields: "id, webViewLink",
  });

  if (!data.id) {
    throw new Error("Google Driveへのファイルアップロードに失敗しました。");
  }

  return { driveFileId: data.id, driveUrl: data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view` };
}

/**
 * 汎用: 指定フォルダへの1ファイル分のresumable upload sessionを発行し、session URLを返す。
 * production-videos専用ではなく、将来material-form/outsourcing-upload/post_records final等
 * でも同じ形で使えるよう、フォルダIDとファイルメタデータだけを受け取る形にしている。
 *
 * access tokenはこの関数の外へは一切出さない（session発行の1リクエストにのみ使用）。
 * session URL自体はGoogleが発行する自己完結した認可情報で、後続のPUTにAuthorizationヘッダーは
 * 不要（Google公式ドキュメントのサンプルコードでも、PUTリクエストにはContent-Length /
 * Content-Rangeのみが付与されaccess tokenは付与されない）。
 *
 * originを指定した場合、session開始POSTにOriginヘッダーを付与する。session開始リクエストを
 * サーバー側fetchで行うとブラウザ由来のOriginが無いため、後続のブラウザからのPUTに対して
 * GoogleがAccess-Control-Allow-Originを返さずCORSで失敗する、という仮説の検証用。
 * 呼び出し元（DriveService実装）で検証済みのオリジンのみを渡すこと。
 */
export async function createResumableSession(
  authClient: OAuth2Client,
  params: { folderId: string; fileName: string; mimeType: string; fileSizeBytes: number; origin?: string },
): Promise<string> {
  const { token } = await authClient.getAccessToken();
  if (!token) {
    throw new Error("Google Driveのアクセストークンを取得できませんでした。");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=UTF-8",
    "X-Upload-Content-Type": params.mimeType || "application/octet-stream",
    "X-Upload-Content-Length": String(params.fileSizeBytes),
  };
  if (params.origin) {
    headers.Origin = params.origin;
  }

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ name: params.fileName, parents: [params.folderId] }),
    },
  );

  if (!response.ok) {
    throw new Error(`Google Driveのresumable upload session発行に失敗しました（status: ${response.status}）。`);
  }

  const sessionUrl = response.headers.get("location");
  if (!sessionUrl) {
    throw new Error("Google Driveからresumable upload session URLを取得できませんでした。");
  }

  return sessionUrl;
}
