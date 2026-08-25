import "server-only";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { headers } from "next/headers";

const CALLBACK_PATH = "/management/settings/drive/callback";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const EMAIL_SCOPES = ["openid", "https://www.googleapis.com/auth/userinfo.email"];

export class GoogleDriveConfigError extends Error {}

function requireOAuthCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleDriveConfigError(
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET が設定されていません。",
    );
  }
  return { clientId, clientSecret };
}

/** 現在のリクエストのオリジンから、Google側に登録するcallback URLを組み立てる。 */
export async function getRedirectUri(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  return `${proto}://${host}${CALLBACK_PATH}`;
}

export async function createOAuthClient(): Promise<OAuth2Client> {
  const { clientId, clientSecret } = requireOAuthCredentials();
  const redirectUri = await getRedirectUri();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function buildConsentUrl(state: string): Promise<string> {
  const client = await createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [DRIVE_SCOPE, ...EMAIL_SCOPES],
    state,
  });
}

export interface ExchangedTokens {
  refreshToken: string;
  googleAccountEmail: string;
}

/** 認可コードをrefresh tokenへ交換し、接続したGoogleアカウントのメールアドレスを取得する。 */
export async function exchangeCodeForTokens(code: string): Promise<ExchangedTokens> {
  const client = await createOAuthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Googleからrefresh tokenを取得できませんでした。既に連携済みの場合は一度「連携解除」してから再度お試しください。",
    );
  }

  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();

  if (!data.email) {
    throw new Error("Googleアカウントのメールアドレスを取得できませんでした。");
  }

  return { refreshToken: tokens.refresh_token, googleAccountEmail: data.email };
}

/** 保存済みrefresh tokenからaccess tokenを再取得できるかを確認する（無効ならエラーを投げる）。 */
export async function createAuthorizedClient(refreshToken: string): Promise<OAuth2Client> {
  const client = await createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  // 明示的にaccess tokenを取得させ、refresh tokenが失効していないかをここで検証する。
  await client.getAccessToken();
  return client;
}

export function getDriveClient(auth: OAuth2Client) {
  return google.drive({ version: "v3", auth });
}

/** 連携解除時にGoogle側のトークンも失効させる（ベストエフォート。失敗しても解除処理自体は継続する）。 */
export async function revokeGoogleToken(refreshToken: string): Promise<void> {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }).toString(),
  });
}

/** 失効・取り消しなど、Google側の代表的なエラーを分かりやすい文言へ変換する。 */
export function describeGoogleError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("invalid_grant")) {
    return "Google連携が無効になっています（アクセスが取り消された可能性があります）。再接続してください。";
  }
  if (message.includes("GoogleDriveConfigError") || error instanceof GoogleDriveConfigError) {
    return "Google Drive連携のサーバー設定が不足しています。管理者に確認してください。";
  }
  return "Google Driveへの接続に失敗しました。時間をおいて再度お試しください。";
}
