"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";

function safeReturnTo(value: FormDataEntryValue | null, fallback: string): string {
  const text = String(value ?? "");
  return text.startsWith("/") ? text : fallback;
}

/**
 * 投稿実績の取消（誤登録対応）。
 * 元のpost_recordsは削除・上書きせず、取消メタデータのみ追記する
 * （実績内容の変更はDBトリガーで禁止済み）。
 * 他に有効な実績が無ければ、対象タスクをposting_waitingへ戻す。
 */
export async function cancelPostRecordAction(formData: FormData) {
  const recordId = String(formData.get("recordId"));
  const reason = String(formData.get("reason") ?? "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), "/post-records");

  if (!reason) {
    redirect(`${returnTo}?error=${encodeURIComponent("取消理由を入力してください")}`);
  }

  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_post_record", {
    p_post_record_id: recordId,
    p_staff_id: staff.id,
    p_reason: reason,
  });

  if (error) {
    redirect(`${returnTo}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`${returnTo}?saved=1`);
}
