import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// refresh tokenの暗号化専用モジュール。DRIVE_TOKEN_ENCRYPTION_KEY以外のどこにも
// 平文の鍵・トークンを出力しない（console.log等でのロギングも行わない）。

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export function loadEncryptionKey(): Buffer {
  const raw = process.env.DRIVE_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "DRIVE_TOKEN_ENCRYPTION_KEY が設定されていません。Google Drive連携を利用するには32バイト鍵をbase64で設定してください。",
    );
  }

  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error("DRIVE_TOKEN_ENCRYPTION_KEY の形式が不正です（base64として読み取れません）。");
  }

  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `DRIVE_TOKEN_ENCRYPTION_KEY の鍵長が不正です（${key.length}バイト）。base64で32バイト（AES-256）の鍵を設定してください。`,
    );
  }

  return key;
}

/** refresh token（平文）を暗号化し、DBに保存できるバイト列（iv || authTag || 暗号文）を返す。 */
export function encryptRefreshToken(plainToken: string): Buffer {
  const key = loadEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainToken, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

/** DBに保存されたバイト列を復号し、refresh token（平文）を返す。 */
export function decryptRefreshToken(payload: Buffer): string {
  const key = loadEncryptionKey();
  if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("保存されているrefresh tokenのデータ形式が不正です。");
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
