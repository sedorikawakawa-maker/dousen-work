import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptClientCredentialPassword, decryptClientCredentialPassword } from "./passwordCrypto";

// このテストはprocess.env内だけのテスト専用鍵を使う。実鍵は一切参照・出力しない。
// loadEncryptionKey()は呼び出しのたびにprocess.envを読むため、モジュールの再importは不要。
function setTestKey(): void {
  process.env.CLIENT_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
}

describe("passwordCrypto（client_credentialsパスワード暗号化）", () => {
  beforeEach(() => {
    delete process.env.CLIENT_CREDENTIALS_ENCRYPTION_KEY;
  });

  it("encrypt→decryptで元の平文へ戻る", () => {
    setTestKey();
    const plain = "Sup3r-Secret-Password!";
    const encrypted = encryptClientCredentialPassword(plain);
    expect(decryptClientCredentialPassword(encrypted)).toBe(plain);
  });

  it("同じ平文でも呼び出すたびに暗号文が異なる（乱数IV）", () => {
    setTestKey();
    const plain = "same-password";
    const a = encryptClientCredentialPassword(plain);
    const b = encryptClientCredentialPassword(plain);
    expect(a).not.toBe(b);
  });

  it("暗号文がbyteaのhex形式(\\x...)である", () => {
    setTestKey();
    const encrypted = encryptClientCredentialPassword("x");
    expect(encrypted.startsWith("\\x")).toBe(true);
  });

  it("改ざんされた暗号文は復号に失敗する", () => {
    setTestKey();
    const encrypted = encryptClientCredentialPassword("tamper-me");
    const tampered = encrypted.slice(0, -2) + (encrypted.slice(-2) === "00" ? "01" : "00");
    expect(() => decryptClientCredentialPassword(tampered)).toThrow();
  });

  it("暗号化時と異なる鍵では復号に失敗する", () => {
    setTestKey();
    const encrypted = encryptClientCredentialPassword("wrong-key-test");

    process.env.CLIENT_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => decryptClientCredentialPassword(encrypted)).toThrow();
  });

  it("鍵が未設定なら例外", () => {
    expect(() => encryptClientCredentialPassword("x")).toThrow(/設定されていません/);
  });

  it("鍵の長さが不正なら例外", () => {
    process.env.CLIENT_CREDENTIALS_ENCRYPTION_KEY = randomBytes(16).toString("base64"); // 16byte(不正)
    expect(() => encryptClientCredentialPassword("x")).toThrow(/鍵長が不正/);
  });

  it("エラーメッセージに平文パスワードや暗号文を含めない", () => {
    setTestKey();
    const secret = "MySecretPassword123";
    const encrypted = encryptClientCredentialPassword(secret);
    const tampered = encrypted.slice(0, -2) + (encrypted.slice(-2) === "00" ? "01" : "00");
    try {
      decryptClientCredentialPassword(tampered);
      throw new Error("should have thrown");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).not.toContain(secret);
      expect(message).not.toContain(tampered);
    }
  });
});
