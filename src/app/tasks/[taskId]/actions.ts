"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";
import { assetTypeForPostType } from "@/lib/wchecks/labels";
import type { Database, ProductionTaskStatus } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

const RESOLVABLE_STATUSES: ProductionTaskStatus[] = ["production_waiting", "in_production"];

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function safeReturnTo(value: FormDataEntryValue | null, fallback: string): string {
  const text = String(value ?? "");
  return text.startsWith("/") ? text : fallback;
}

/** タスクの主担当・副担当へ通知する（同一人物が重複する場合は1件にまとめる）。 */
async function notifyProductionStaff(
  supabase: SupabaseClient<Database>,
  taskId: string,
  notification: { notificationType: string; title: string; body?: string | null },
): Promise<void> {
  const { data: task } = await supabase
    .from("production_tasks")
    .select("assignee_staff_id, secondary_staff_id")
    .eq("id", taskId)
    .maybeSingle();

  const recipientIds = [
    ...new Set(
      [task?.assignee_staff_id, task?.secondary_staff_id].filter(
        (id): id is string => !!id,
      ),
    ),
  ];

  if (recipientIds.length === 0) return;

  await supabase.from("notifications").insert(
    recipientIds.map((staffId) => ({
      recipient_staff_id: staffId,
      notification_type: notification.notificationType,
      title: notification.title,
      body: notification.body ?? null,
      entity_type: "production_task",
      entity_id: taskId,
    })),
  );
}

/**
 * 制作待ち・制作中 → 素材待ち への手動変更。
 * 自動生成・自動再生成では使わない、担当者/社員/役員/社長による意図的な状態変更。
 */
export async function setTaskMaterialWaitingAction(formData: FormData) {
  const taskId = String(formData.get("taskId"));
  const supabase = await createSupabaseServerClient();

  const { data: task } = await supabase
    .from("production_tasks")
    .select("status")
    .eq("id", taskId)
    .maybeSingle();

  if (!task || !RESOLVABLE_STATUSES.includes(task.status)) {
    redirect(`/tasks/${taskId}?error=${encodeURIComponent("制作待ち・制作中のタスクのみ素材待ちに変更できます")}`);
  }

  await supabase
    .from("production_tasks")
    .update({ status: "material_waiting", material_wait_started_at: new Date().toISOString() })
    .eq("id", taskId);

  redirect(`/tasks/${taskId}?saved=1`);
}

/**
 * 素材待ち → 制作待ち／制作中 への手動復帰。
 * 素材到着だけでは自動解除しない（担当者が内容を確認して選ぶ）。
 */
export async function resolveTaskMaterialWaitingAction(formData: FormData) {
  const taskId = String(formData.get("taskId"));
  const nextStatus = String(formData.get("nextStatus")) as ProductionTaskStatus;
  const supabase = await createSupabaseServerClient();

  const { data: task } = await supabase
    .from("production_tasks")
    .select("status")
    .eq("id", taskId)
    .maybeSingle();

  if (!task || task.status !== "material_waiting") {
    redirect(`/tasks/${taskId}?error=${encodeURIComponent("素材待ちのタスクのみ変更できます")}`);
  }

  if (!RESOLVABLE_STATUSES.includes(nextStatus)) {
    redirect(`/tasks/${taskId}?error=${encodeURIComponent("不正な変更先です")}`);
  }

  await supabase
    .from("production_tasks")
    .update({ status: nextStatus, material_wait_started_at: null })
    .eq("id", taskId);

  redirect(`/tasks/${taskId}?saved=1`);
}

/** 制作待ち → 制作中。制作開始を明示するための操作（started_atを記録する）。 */
export async function startProductionAction(formData: FormData) {
  const taskId = String(formData.get("taskId"));
  const supabase = await createSupabaseServerClient();

  const { data: task } = await supabase
    .from("production_tasks")
    .select("status")
    .eq("id", taskId)
    .maybeSingle();

  if (!task || task.status !== "production_waiting") {
    redirect(`/tasks/${taskId}?error=${encodeURIComponent("制作待ちのタスクのみ制作を開始できます")}`);
  }

  await supabase
    .from("production_tasks")
    .update({ status: "in_production", started_at: new Date().toISOString() })
    .eq("id", taskId);

  redirect(`/tasks/${taskId}?saved=1`);
}

/**
 * Wチェック登録。制作物リンク(投稿種別に応じてDrive動画/Canva)とWチェック担当(任意)を登録し、
 * production_tasks.status を wcheck_waiting にする。reviewer指定時のみ通知を作成する。
 */
export async function registerWCheckAction(formData: FormData) {
  const taskId = String(formData.get("taskId"));
  const assetUrl = String(formData.get("assetUrl") ?? "").trim();
  const reviewerStaffId = emptyToNull(formData.get("reviewerStaffId"));
  const notes = emptyToNull(formData.get("notes"));

  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  const supabase = await createSupabaseServerClient();

  const { data: task } = await supabase
    .from("production_tasks")
    .select("post_type")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) {
    redirect(`/tasks/${taskId}?error=${encodeURIComponent("タスクが見つかりません")}`);
  }

  if (!assetUrl) {
    redirect(`/tasks/${taskId}?error=${encodeURIComponent("制作物リンクを入力してください")}`);
  }

  const { data: wcheck, error } = await supabase
    .from("w_checks")
    .insert({
      production_task_id: taskId,
      requested_by_staff_id: staff.id,
      reviewer_staff_id: reviewerStaffId,
      asset_type: assetTypeForPostType(task.post_type),
      asset_url: assetUrl,
      notes,
    })
    .select("id")
    .single();

  if (error || !wcheck) {
    redirect(`/tasks/${taskId}?error=${encodeURIComponent(error?.message ?? "登録に失敗しました")}`);
  }

  await supabase.from("production_tasks").update({ status: "wcheck_waiting" }).eq("id", taskId);

  if (reviewerStaffId) {
    await supabase.from("notifications").insert({
      recipient_staff_id: reviewerStaffId,
      notification_type: "wcheck_requested",
      title: "Wチェック依頼",
      body: null,
      entity_type: "production_task",
      entity_id: taskId,
    });
  }

  redirect(`/tasks/${taskId}?saved=1`);
}

/** WチェックOK。承認したタスクは顧客確認へ進められる状態(client_confirmation_waiting)にする。 */
export async function approveWCheckAction(formData: FormData) {
  const wcheckId = String(formData.get("wcheckId"));
  const taskId = String(formData.get("taskId"));
  const returnTo = safeReturnTo(formData.get("returnTo"), `/tasks/${taskId}`);
  const supabase = await createSupabaseServerClient();

  const { data: wcheck } = await supabase
    .from("w_checks")
    .select("requested_by_staff_id, status")
    .eq("id", wcheckId)
    .maybeSingle();

  if (!wcheck || wcheck.status !== "waiting") {
    redirect(`${returnTo}?error=${encodeURIComponent("Wチェック待ちの依頼のみ操作できます")}`);
  }

  await supabase
    .from("w_checks")
    .update({ status: "approved", reviewed_at: new Date().toISOString() })
    .eq("id", wcheckId);

  await supabase
    .from("production_tasks")
    .update({ status: "client_confirmation_waiting" })
    .eq("id", taskId);

  if (wcheck?.requested_by_staff_id) {
    await supabase.from("notifications").insert({
      recipient_staff_id: wcheck.requested_by_staff_id,
      notification_type: "wcheck_approved",
      title: "WチェックOK",
      body: null,
      entity_type: "production_task",
      entity_id: taskId,
    });
  }

  redirect(`${returnTo}?saved=1`);
}

/**
 * Wチェック修正依頼。production_tasks.status = in_production に戻す。
 * 再度Wチェックする場合は改めて登録する（過去のw_checksは履歴として残る）。
 */
export async function requestWCheckRevisionAction(formData: FormData) {
  const wcheckId = String(formData.get("wcheckId"));
  const taskId = String(formData.get("taskId"));
  const revisionComment = String(formData.get("revisionComment") ?? "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), `/tasks/${taskId}`);
  const supabase = await createSupabaseServerClient();

  if (!revisionComment) {
    redirect(`${returnTo}?error=${encodeURIComponent("修正コメントを入力してください")}`);
  }

  const { data: wcheck } = await supabase
    .from("w_checks")
    .select("requested_by_staff_id, status")
    .eq("id", wcheckId)
    .maybeSingle();

  if (!wcheck || wcheck.status !== "waiting") {
    redirect(`${returnTo}?error=${encodeURIComponent("Wチェック待ちの依頼のみ操作できます")}`);
  }

  await supabase
    .from("w_checks")
    .update({
      status: "revision_requested",
      revision_comment: revisionComment,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", wcheckId);

  await supabase.from("production_tasks").update({ status: "in_production" }).eq("id", taskId);

  if (wcheck?.requested_by_staff_id) {
    await supabase.from("notifications").insert({
      recipient_staff_id: wcheck.requested_by_staff_id,
      notification_type: "wcheck_revision_requested",
      title: "Wチェック修正依頼",
      body: revisionComment,
      entity_type: "production_task",
      entity_id: taskId,
    });
  }

  redirect(`${returnTo}?saved=1`);
}

/**
 * Wチェックを省略して顧客確認待ちへ直接進める。
 * w_checks レコードは作成せず、省略の事実だけを wcheck_skips に追記保存する
 * （削除・上書きはしない。activity_logsへの記録はDBトリガー側で行う）。
 * RLSはWチェック系と同じくis_active_staff()のみで、part_timeを含む全有効スタッフが利用可能。
 */
export async function skipWCheckAction(formData: FormData) {
  const taskId = String(formData.get("taskId"));
  const reason = emptyToNull(formData.get("reason"));
  const returnTo = safeReturnTo(formData.get("returnTo"), `/tasks/${taskId}`);

  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  const supabase = await createSupabaseServerClient();

  const { data: task } = await supabase
    .from("production_tasks")
    .select("status")
    .eq("id", taskId)
    .maybeSingle();

  if (!task || !RESOLVABLE_STATUSES.includes(task.status)) {
    redirect(
      `${returnTo}?error=${encodeURIComponent("制作待ち・制作中のタスクのみWチェックを省略できます")}`,
    );
  }

  const { error } = await supabase.from("wcheck_skips").insert({
    production_task_id: taskId,
    staff_id: staff.id,
    reason,
  });

  if (error) {
    redirect(`${returnTo}?error=${encodeURIComponent(error.message)}`);
  }

  await supabase
    .from("production_tasks")
    .update({ status: "client_confirmation_waiting" })
    .eq("id", taskId);

  redirect(`${returnTo}?saved=1`);
}

/**
 * 顧客確認依頼済みの登録。
 * 重要: WチェックOKになっただけでは client_confirmations を作らない。
 * 実際に担当者が公式LINE等で顧客へ送った後、この操作で初めて作成する。
 * 登録だけでは社内通知は作らない。
 */
export async function requestClientConfirmationAction(formData: FormData) {
  const taskId = String(formData.get("taskId"));
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  const supabase = await createSupabaseServerClient();

  const { data: task } = await supabase
    .from("production_tasks")
    .select("status")
    .eq("id", taskId)
    .maybeSingle();

  if (!task || task.status !== "client_confirmation_waiting") {
    redirect(
      `/tasks/${taskId}?error=${encodeURIComponent("WチェックOK後のタスクのみ顧客確認依頼を登録できます")}`,
    );
  }

  const { error } = await supabase.from("client_confirmations").insert({
    production_task_id: taskId,
    requested_by_staff_id: staff.id,
  });

  if (error) {
    redirect(`/tasks/${taskId}?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/tasks/${taskId}?saved=1`);
}

/** 顧客OK。投稿待ちへ進め、制作担当者へ通知する。 */
export async function approveClientConfirmationAction(formData: FormData) {
  const confirmationId = String(formData.get("confirmationId"));
  const taskId = String(formData.get("taskId"));
  const returnTo = safeReturnTo(formData.get("returnTo"), `/tasks/${taskId}`);
  const supabase = await createSupabaseServerClient();

  const { data: confirmation } = await supabase
    .from("client_confirmations")
    .select("status")
    .eq("id", confirmationId)
    .maybeSingle();

  if (!confirmation || confirmation.status !== "waiting") {
    redirect(`${returnTo}?error=${encodeURIComponent("確認待ちの依頼のみ操作できます")}`);
  }

  await supabase
    .from("client_confirmations")
    .update({ status: "approved", responded_at: new Date().toISOString() })
    .eq("id", confirmationId);

  await supabase.from("production_tasks").update({ status: "posting_waiting" }).eq("id", taskId);

  await notifyProductionStaff(supabase, taskId, {
    notificationType: "client_confirmation_approved",
    title: "顧客確認OK",
  });

  redirect(`${returnTo}?saved=1`);
}

/** 顧客から修正依頼。制作中へ戻し、制作担当者へ通知する。修正後は再度Wチェック登録から進める。 */
export async function requestClientConfirmationRevisionAction(formData: FormData) {
  const confirmationId = String(formData.get("confirmationId"));
  const taskId = String(formData.get("taskId"));
  const revisionComment = String(formData.get("revisionComment") ?? "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), `/tasks/${taskId}`);
  const supabase = await createSupabaseServerClient();

  if (!revisionComment) {
    redirect(`${returnTo}?error=${encodeURIComponent("修正内容を入力してください")}`);
  }

  const { data: confirmation } = await supabase
    .from("client_confirmations")
    .select("status")
    .eq("id", confirmationId)
    .maybeSingle();

  if (!confirmation || confirmation.status !== "waiting") {
    redirect(`${returnTo}?error=${encodeURIComponent("確認待ちの依頼のみ操作できます")}`);
  }

  await supabase
    .from("client_confirmations")
    .update({
      status: "revision_requested",
      responded_at: new Date().toISOString(),
      revision_comment: revisionComment,
    })
    .eq("id", confirmationId);

  await supabase.from("production_tasks").update({ status: "in_production" }).eq("id", taskId);

  await notifyProductionStaff(supabase, taskId, {
    notificationType: "client_confirmation_revision_requested",
    title: "顧客確認: 修正依頼",
    body: revisionComment,
  });

  redirect(`${returnTo}?saved=1`);
}
