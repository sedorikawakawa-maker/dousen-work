import "server-only";
import { cookies } from "next/headers";

// OAuth開始時に発行したstateと、開始した本人(staffId)を結びつけて短命Cookieに保持する。
// callback側では、このCookieの値をstateの一致確認・本人確認の両方に使う
// （Googleから返るcode/stateだけを信用してrefresh tokenを保存しない）。

const COOKIE_NAME = "drive_oauth_state";
const MAX_AGE_SECONDS = 600;

interface OAuthStatePayload {
  state: string;
  staffId: string;
}

export async function setOAuthStateCookie(payload: OAuthStatePayload): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, JSON.stringify(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/management/settings/drive",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Cookieを読み取り、直後に削除する（1回きりの使い捨て）。 */
export async function readAndClearOAuthStateCookie(): Promise<OAuthStatePayload | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  cookieStore.delete({ name: COOKIE_NAME, path: "/management/settings/drive" });

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<OAuthStatePayload>;
    if (typeof parsed.state !== "string" || typeof parsed.staffId !== "string") return null;
    return { state: parsed.state, staffId: parsed.staffId };
  } catch {
    return null;
  }
}
