import "server-only";

// Supabase Auth は email を要求するため、姓名・パスワードでのログインUIの裏側で
// スタッフごとの内部専用メールアドレスを生成する（ユーザーには見せない）。
// docs/security.md: 「内部用ログインIDを生成してよい」
export function buildStaffAuthEmail(staffId: string): string {
  const domain = process.env.STAFF_AUTH_EMAIL_DOMAIN;
  if (!domain) {
    throw new Error("Missing required environment variable: STAFF_AUTH_EMAIL_DOMAIN");
  }
  return `${staffId}@${domain}`;
}
