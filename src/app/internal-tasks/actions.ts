"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/session";
import type { InternalTaskPriority, InternalTaskStatus } from "@/lib/supabase/database.types";

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function toTimestamptz(dateLocal: string | null): string | null {
  if (!dateLocal) return null;
  const date = new Date(dateLocal);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function createInternalTaskAction(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const assigneeStaffId = String(formData.get("assigneeStaffId") ?? "") || staff.id;

  if (!title || !category) {
    redirect(`/internal-tasks/new?error=${encodeURIComponent("カテゴリとタイトルは必須です")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("internal_tasks").insert({
    client_id: emptyToNull(formData.get("clientId")),
    assignee_staff_id: assigneeStaffId,
    category,
    title,
    description: emptyToNull(formData.get("description")),
    priority: (String(formData.get("priority") ?? "B") as InternalTaskPriority) || "B",
    due_at: toTimestamptz(emptyToNull(formData.get("dueAt"))),
    attachment_url: emptyToNull(formData.get("attachmentUrl")),
  });

  if (error) {
    redirect(`/internal-tasks/new?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/internal-tasks?saved=1");
}

export async function updateInternalTaskAction(formData: FormData) {
  const taskId = String(formData.get("taskId"));
  const title = String(formData.get("title") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();

  if (!title || !category) {
    redirect(`/internal-tasks/${taskId}/edit?error=${encodeURIComponent("カテゴリとタイトルは必須です")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("internal_tasks")
    .update({
      client_id: emptyToNull(formData.get("clientId")),
      assignee_staff_id: String(formData.get("assigneeStaffId")),
      category,
      title,
      description: emptyToNull(formData.get("description")),
      priority: String(formData.get("priority") ?? "B") as InternalTaskPriority,
      status: String(formData.get("status") ?? "not_started") as InternalTaskStatus,
      due_at: toTimestamptz(emptyToNull(formData.get("dueAt"))),
      attachment_url: emptyToNull(formData.get("attachmentUrl")),
    })
    .eq("id", taskId);

  if (error) {
    redirect(`/internal-tasks/${taskId}/edit?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/internal-tasks?saved=1");
}

/** 一覧からの状態変更（未着手→作業中→完了）。 */
export async function updateInternalTaskStatusAction(formData: FormData) {
  const taskId = String(formData.get("taskId"));
  const nextStatus = String(formData.get("nextStatus")) as InternalTaskStatus;
  const returnTo = String(formData.get("returnTo") ?? "/internal-tasks");

  const supabase = await createSupabaseServerClient();
  await supabase.from("internal_tasks").update({ status: nextStatus }).eq("id", taskId);

  redirect(returnTo.startsWith("/") ? returnTo : "/internal-tasks");
}
