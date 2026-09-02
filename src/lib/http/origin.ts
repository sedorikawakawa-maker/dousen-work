import "server-only";

import { headers } from "next/headers";

export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * ブラウザ申告のOriginを無条件に信用せず、このリクエスト自体から独立に算出した
 * getRequestOrigin()と一致する場合のみ採用する（不一致・未指定なら常にサーバー
 * 算出値へフォールバックする）。Google Drive resumable upload sessionの発行時など、
 * ブラウザ直PUTを許可するCORS Originとして安全に使えるOriginが必要な箇所で使う。
 */
export async function validateBrowserOrigin(claimedOrigin: string | undefined | null): Promise<string> {
  const expected = await getRequestOrigin();
  return claimedOrigin === expected ? claimedOrigin : expected;
}
