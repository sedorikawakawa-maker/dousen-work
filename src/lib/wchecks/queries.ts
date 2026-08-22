import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;
type WCheckRow = Database["public"]["Tables"]["w_checks"]["Row"];
type ProductionTaskRow = Database["public"]["Tables"]["production_tasks"]["Row"];

export interface PendingWCheckItem {
  wcheck: WCheckRow;
  task: ProductionTaskRow;
}

/** 現在Wチェック待ち(status=waiting)の一覧を、紐づくタスク情報とあわせて取得する。 */
export async function listPendingWChecksWithTasks(
  supabase: TypedClient,
): Promise<PendingWCheckItem[]> {
  const { data: wchecks } = await supabase
    .from("w_checks")
    .select("*")
    .eq("status", "waiting")
    .order("requested_at", { ascending: true });

  if (!wchecks || wchecks.length === 0) return [];

  const taskIds = [...new Set(wchecks.map((w) => w.production_task_id))];
  const { data: tasks } = await supabase.from("production_tasks").select("*").in("id", taskIds);
  const taskById = new Map((tasks ?? []).map((t) => [t.id, t]));

  const items: PendingWCheckItem[] = [];
  for (const wcheck of wchecks) {
    const task = taskById.get(wcheck.production_task_id);
    if (task) items.push({ wcheck, task });
  }
  return items;
}

export async function listWChecksForTask(
  supabase: TypedClient,
  taskId: string,
): Promise<WCheckRow[]> {
  const { data, error } = await supabase
    .from("w_checks")
    .select("*")
    .eq("production_task_id", taskId)
    .order("requested_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * 各タスクについて直近でOKになったWチェックを取得する（顧客確認画面での
 * 「制作物リンク」表示に使う。顧客確認自体はリンクを保持しないため。）
 */
export async function getLatestApprovedWCheckByTaskIds(
  supabase: TypedClient,
  taskIds: string[],
): Promise<Map<string, WCheckRow>> {
  const result = new Map<string, WCheckRow>();
  if (taskIds.length === 0) return result;

  const { data } = await supabase
    .from("w_checks")
    .select("*")
    .in("production_task_id", taskIds)
    .eq("status", "approved")
    .order("reviewed_at", { ascending: false });

  for (const wcheck of data ?? []) {
    if (!result.has(wcheck.production_task_id)) {
      result.set(wcheck.production_task_id, wcheck);
    }
  }
  return result;
}
