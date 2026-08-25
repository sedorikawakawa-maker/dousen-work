import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { encryptRefreshToken, decryptRefreshToken } from "./tokenCrypto";
import type { Database } from "@/lib/supabase/database.types";

type DriveIntegrationRow = Database["public"]["Tables"]["drive_integration"]["Row"];

// drive_integrationはservice_role専用テーブル（authenticated/anonからはRLSで一切
// アクセス不可）のため、この読み書きはすべてcreateSupabaseAdminClient()で行う。
// 呼び出し元では必ずrequireDriveSettingsAccess()による権限チェックを事前に済ませること。

function bufferToPgBytea(buf: Buffer): string {
  return "\\x" + buf.toString("hex");
}

function pgByteaToBuffer(value: string): Buffer {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  return Buffer.from(hex, "hex");
}

export async function getDriveIntegrationRow(): Promise<DriveIntegrationRow | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("drive_integration").select("*").eq("id", 1).maybeSingle();
  return data ?? null;
}

/** 保存されているrefresh tokenを復号して返す。未接続の場合はnull。 */
export async function getDecryptedRefreshToken(): Promise<string | null> {
  const row = await getDriveIntegrationRow();
  if (!row?.refresh_token_encrypted) return null;
  return decryptRefreshToken(pgByteaToBuffer(row.refresh_token_encrypted));
}

export async function saveGoogleConnection(params: {
  googleAccountEmail: string;
  refreshToken: string;
  connectedByStaffId: string;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const encrypted = encryptRefreshToken(params.refreshToken);

  await admin
    .from("drive_integration")
    .update({
      status: "connected",
      google_account_email: params.googleAccountEmail,
      refresh_token_encrypted: bufferToPgBytea(encrypted),
      connected_by_staff_id: params.connectedByStaffId,
      connected_at: new Date().toISOString(),
      last_verified_at: null,
      last_verified_status: null,
      last_error_message: null,
    })
    .eq("id", 1);
}

export async function saveVerificationResult(result: { ok: boolean; message?: string }): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("drive_integration")
    .update({
      status: result.ok ? "connected" : "error",
      last_verified_at: new Date().toISOString(),
      last_verified_status: result.ok ? "ok" : "error",
      last_error_message: result.ok ? null : (result.message ?? "不明なエラー"),
    })
    .eq("id", 1);
}

export async function saveRootFolder(params: { rootFolderId: string; rootFolderName: string }): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("drive_integration")
    .update({
      root_folder_id: params.rootFolderId,
      root_folder_name: params.rootFolderName,
    })
    .eq("id", 1);
}

export async function clearGoogleConnection(): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin
    .from("drive_integration")
    .update({
      status: "not_connected",
      google_account_email: null,
      refresh_token_encrypted: null,
      root_folder_id: null,
      root_folder_name: null,
      last_verified_at: null,
      last_verified_status: null,
      last_error_message: null,
      connected_by_staff_id: null,
      connected_at: null,
    })
    .eq("id", 1);
}
