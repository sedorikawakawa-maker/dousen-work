import "server-only";

import { randomBytes, createHash } from "node:crypto";
import { headers } from "next/headers";

export function generateMaterialFormToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashMaterialFormToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function buildMaterialFormUrl(token: string): Promise<string> {
  const origin = await getRequestOrigin();
  return `${origin}/material-form/${token}`;
}
