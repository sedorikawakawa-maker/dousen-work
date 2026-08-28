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
 * 「Wチェック修正依頼が未対応のまま残っている」タスクを、指定スタッフの担当分だけ取得する。
 * 判定条件（新しいproduction_task statusは追加しない）:
 *   1. production_tasks.assignee_staff_id = staffId
 *   2. production_tasks.status = 'in_production'（修正依頼直後の状態のまま進んでいない）
 *   3. そのタスクの最新のw_checks（requested_at最大）がstatus='revision_requested'
 *      → 新しいWチェックを再登録すると最新w_checksがwaitingに変わるため、その時点で自動的に対象外になる
 *   4. Wチェックを省略(wcheck_skips)して先に進んだ場合、その省略が上記revision_requestedより後なら対象外
 *      （省略後に別の理由でstatusがin_productionへ戻っても、古い修正依頼を誤って再表示しないため）
 */
export async function listPendingWCheckRevisionsForAssignee(
  supabase: TypedClient,
  staffId: string,
): Promise<PendingWCheckItem[]> {
  const { data: tasks } = await supabase
    .from("production_tasks")
    .select("*")
    .eq("assignee_staff_id", staffId)
    .eq("status", "in_production");

  if (!tasks || tasks.length === 0) return [];

  const taskIds = tasks.map((t) => t.id);
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const [{ data: wchecks }, { data: skips }] = await Promise.all([
    supabase
      .from("w_checks")
      .select("*")
      .in("production_task_id", taskIds)
      .order("requested_at", { ascending: false }),
    supabase
      .from("wcheck_skips")
      .select("production_task_id, created_at")
      .in("production_task_id", taskIds)
      .order("created_at", { ascending: false }),
  ]);

  const latestWCheckByTaskId = new Map<string, WCheckRow>();
  for (const wcheck of wchecks ?? []) {
    if (!latestWCheckByTaskId.has(wcheck.production_task_id)) {
      latestWCheckByTaskId.set(wcheck.production_task_id, wcheck);
    }
  }

  const latestSkipAtByTaskId = new Map<string, string>();
  for (const skip of skips ?? []) {
    if (!latestSkipAtByTaskId.has(skip.production_task_id)) {
      latestSkipAtByTaskId.set(skip.production_task_id, skip.created_at);
    }
  }

  const items: PendingWCheckItem[] = [];
  for (const taskId of taskIds) {
    const wcheck = latestWCheckByTaskId.get(taskId);
    if (!wcheck || wcheck.status !== "revision_requested") continue;

    const latestSkipAt = latestSkipAtByTaskId.get(taskId);
    if (latestSkipAt && latestSkipAt > wcheck.requested_at) continue;

    const task = taskById.get(taskId);
    if (task) items.push({ wcheck, task });
  }

  return items;
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
