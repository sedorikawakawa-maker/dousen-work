import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// client_credentialsのパスワード暗号化専用モジュール。Google Drive refresh token用の
// tokenCrypto.tsとアルゴリズム・パッキング方式(iv || authTag || 暗号文)は同じだが、
// 鍵はCLIENT_CREDENTIALS_ENCRYPTION_KEYとして完全に分離する（DRIVE_TOKEN_ENCRYPTION_KEY
// は流用しない。片方の鍵が漏洩しても他方の秘密には影響しないようにするため）。
// CLIENT_CREDENTIALS_ENCRYPTION_KEY以外のどこにも平文鍵・平文passwordを出力しない
// （console.log等でのロギングも行わない。エラーメッセージにも鍵・暗号文・passwordを含めない）。

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function loadEncryptionKey(): Buffer {
  const raw = process.env.CLIENT_CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "CLIENT_CREDENTIALS_ENCRYPTION_KEY が設定されていません。SNSログイン情報のパスワード機能を利用するには32バイト鍵をbase64で設定してください。",
    );
  }

  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error("CLIENT_CREDENTIALS_ENCRYPTION_KEY の形式が不正です（base64として読み取れません）。");
  }

  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `CLIENT_CREDENTIALS_ENCRYPTION_KEY の鍵長が不正です（${key.length}バイト）。base64で32バイト（AES-256）の鍵を設定してください。`,
    );
  }

  return key;
}

function bufferToPgBytea(buf: Buffer): string {
  return "\\x" + buf.toString("hex");
}

function pgByteaToBuffer(value: string): Buffer {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  return Buffer.from(hex, "hex");
}

/**
 * 平文パスワードを暗号化し、DBのbytea列へそのまま保存できる文字列(\x...)を返す。
 * 呼び出すたびに乱数IVを使うため、同じ平文でも毎回異なる暗号文になる。
 */
export function encryptClientCredentialPassword(plainPassword: string): string {
  const key = loadEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainPassword, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return bufferToPgBytea(Buffer.concat([iv, authTag, encrypted]));
}

/**
 * DBのbytea列の値(\x...)を復号し、平文パスワードを返す。
 * 改ざんされた暗号文・誤った鍵の場合はGCMの認証タグ検証で例外を投げる（復号できない）。
 */
export function decryptClientCredentialPassword(encryptedPasswordBytea: string): string {
  const key = loadEncryptionKey();
  const payload = pgByteaToBuffer(encryptedPasswordBytea);
  if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("暗号化されたパスワードのデータ形式が不正です。");
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
