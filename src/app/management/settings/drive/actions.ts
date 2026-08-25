"use server";

import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { requireDriveSettingsAccess } from "@/lib/googleDrive/authGuard";
import { setOAuthStateCookie } from "@/lib/googleDrive/oauthState";
import {
  buildConsentUrl,
  createAuthorizedClient,
  getDriveClient,
  describeGoogleError,
  revokeGoogleToken,
} from "@/lib/googleDrive/googleClient";
import {
  getDriveIntegrationRow,
  getDecryptedRefreshToken,
  saveVerificationResult,
  saveRootFolder,
  clearGoogleConnection,
} from "@/lib/googleDrive/repository";
import { getFolderMeta, createRootFolder, extractFolderIdFromInput } from "@/lib/googleDrive/driveOperations";

const SETTINGS_PATH = "/management/settings/drive";

/** 「Google Driveと連携」。認可URLへ遷移する前に、CSRF対策のstateと開始者を短命Cookieへ保存する。 */
export async function startGoogleDriveConnectAction() {
  const staff = await requireDriveSettingsAccess();

  const state = randomBytes(24).toString("hex");
  await setOAuthStateCookie({ state, staffId: staff.id });

  let consentUrl: string;
  try {
    consentUrl = await buildConsentUrl(state);
  } catch (err) {
    redirect(`${SETTINGS_PATH}?error=${encodeURIComponent(describeGoogleError(err))}`);
  }

  redirect(consentUrl);
}

/** 「接続テスト」。OAuth有効性・access token取得・root folderアクセス可否を確認する。 */
export async function testDriveConnectionAction() {
  await requireDriveSettingsAccess();
  const row = await getDriveIntegrationRow();

  if (!row || row.status === "not_connected" || !row.refresh_token_encrypted) {
    redirect(`${SETTINGS_PATH}?error=${encodeURIComponent("Google Driveと連携されていません。")}`);
  }
  if (!row.root_folder_id) {
    redirect(`${SETTINGS_PATH}?error=${encodeURIComponent("保存先フォルダが設定されていません。")}`);
  }

  let resultUrl: string;
  try {
    const refreshToken = await getDecryptedRefreshToken();
    if (!refreshToken) throw new Error("refresh tokenが見つかりません。");
    const authClient = await createAuthorizedClient(refreshToken);
    const drive = getDriveClient(authClient);
    await getFolderMeta(drive, row.root_folder_id);

    await saveVerificationResult({ ok: true });
    resultUrl = `${SETTINGS_PATH}?tested=1`;
  } catch (err) {
    const message = describeGoogleError(err);
    await saveVerificationResult({ ok: false, message });
    resultUrl = `${SETTINGS_PATH}?error=${encodeURIComponent(message)}`;
  }

  redirect(resultUrl);
}

/** 「連携解除」。Google側のトークン失効はベストエフォートとし、DB側の状態は必ずクリアする。 */
export async function disconnectDriveAction() {
  await requireDriveSettingsAccess();

  const refreshToken = await getDecryptedRefreshToken();
  if (refreshToken) {
    try {
      await revokeGoogleToken(refreshToken);
    } catch {
      // Google側の失効APIが失敗しても、DB側の解除は継続する。
    }
  }

  await clearGoogleConnection();
  redirect(`${SETTINGS_PATH}?disconnected=1`);
}

/** 「保存先フォルダ変更」。既存フォルダ指定 or 新規自動作成のいずれか。 */
export async function setDriveRootFolderAction(formData: FormData) {
  await requireDriveSettingsAccess();
  const row = await getDriveIntegrationRow();

  if (!row || row.status === "not_connected" || !row.refresh_token_encrypted) {
    redirect(`${SETTINGS_PATH}?error=${encodeURIComponent("先にGoogle Driveと連携してください。")}`);
  }

  const mode = String(formData.get("mode") ?? "");
  const existingFolderInput = String(formData.get("folderId") ?? "").trim();

  let resultUrl: string;
  try {
    const refreshToken = await getDecryptedRefreshToken();
    if (!refreshToken) throw new Error("refresh tokenが見つかりません。");
    const authClient = await createAuthorizedClient(refreshToken);
    const drive = getDriveClient(authClient);

    if (mode === "existing") {
      if (!existingFolderInput) throw new Error("フォルダIDまたはURLを入力してください。");
      const folder = await getFolderMeta(drive, extractFolderIdFromInput(existingFolderInput));
      await saveRootFolder({ rootFolderId: folder.id, rootFolderName: folder.name });
    } else {
      const folder = await createRootFolder(drive);
      await saveRootFolder({ rootFolderId: folder.id, rootFolderName: folder.name });
    }
    resultUrl = `${SETTINGS_PATH}?saved=1`;
  } catch (err) {
    resultUrl = `${SETTINGS_PATH}?error=${encodeURIComponent(describeGoogleError(err))}`;
  }

  redirect(resultUrl);
}
