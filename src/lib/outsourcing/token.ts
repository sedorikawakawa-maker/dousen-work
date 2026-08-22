import "server-only";

import { randomBytes, createHash } from "node:crypto";
import { getRequestOrigin } from "@/lib/http/origin";

export function generateOutsourcingToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOutsourcingToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function buildOutsourcingUploadUrl(token: string): Promise<string> {
  const origin = await getRequestOrigin();
  return `${origin}/outsourcing-upload/${token}`;
}
