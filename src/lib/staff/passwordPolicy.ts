/**
 * 新規パスワードのルールを一元管理する。過度に複雑な文字種混在ルールは設けず、
 * 最低文字数のみで判定する（管理者発行の仮パスワードは十分な長さのランダム文字列のため対象外）。
 */
export const MIN_PASSWORD_LENGTH = 8;

export function isValidNewPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}
