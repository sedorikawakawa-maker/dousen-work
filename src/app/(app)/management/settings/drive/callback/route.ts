import { NextResponse, type NextRequest } from "next/server";
import { readAndClearOAuthStateCookie } from "@/lib/googleDrive/oauthState";
import { getCurrentStaff } from "@/lib/auth/session";
import { canAccessManagementFeatures } from "@/lib/auth/roles";
import { exchangeCodeForTokens, describeGoogleError } from "@/lib/googleDrive/googleClient";
import { saveGoogleConnection } from "@/lib/googleDrive/repository";

/**
 * Google OAuthのcallback。ここに来たcode/stateだけを信用してrefresh tokenを
 * 保存することはしない。以下をすべて満たした場合のみ保存する:
 *  1. Cookieに保存しておいたstateと、クエリのstateが一致する
 *  2. 現在のログインセッションが、開始時と同じstaffである
 *  3. そのstaffが現在もGoogle Drive設定を操作できる権限を持つ
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const settingsUrl = new URL("/management/settings/drive", url.origin);

  const statePayload = await readAndClearOAuthStateCookie();

  if (!code || !state || !statePayload || statePayload.state !== state) {
    settingsUrl.searchParams.set(
      "error",
      "認証情報を確認できませんでした。お手数ですが最初からやり直してください。",
    );
    return NextResponse.redirect(settingsUrl);
  }

  const staff = await getCurrentStaff();
  if (!staff || staff.id !== statePayload.staffId || !canAccessManagementFeatures(staff.role)) {
    settingsUrl.searchParams.set(
      "error",
      "セッションを確認できませんでした。ログインし直して再度お試しください。",
    );
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const { refreshToken, googleAccountEmail } = await exchangeCodeForTokens(code);
    await saveGoogleConnection({ googleAccountEmail, refreshToken, connectedByStaffId: staff.id });
    settingsUrl.searchParams.set("connected", "1");
  } catch (err) {
    settingsUrl.searchParams.set("error", describeGoogleError(err));
  }

  return NextResponse.redirect(settingsUrl);
}
