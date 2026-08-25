import "server-only";
import { randomBytes } from "node:crypto";

/**
 * 管理者が発行する仮パスワード。十分なエントロピーを持つランダム文字列を
 * サーバー側でのみ生成する（管理者が手入力する方式は採用しない）。
 * DB・ログ・activity_logsには平文を一切保存しない。
 */
export function generateTempPassword(): string {
  return randomBytes(18).toString("base64url");
}
