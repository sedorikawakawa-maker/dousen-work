"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProductionTaskStatus } from "@/lib/supabase/database.types";

const RESOLVABLE_STATUSES: ProductionTaskStatus[] = ["production_waiting", "in_production"];

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
 * 素材待ち → 制作待り／制作中 への手動復帰。
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
