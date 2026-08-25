import "server-only";
import type { drive_v3 } from "googleapis";
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
