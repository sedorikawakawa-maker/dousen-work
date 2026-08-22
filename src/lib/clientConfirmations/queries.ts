import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getClientConfirmationElapsedDays } from "@/lib/reminders/clientConfirmation";

type TypedClient = SupabaseClient<Database>;
type ClientConfirmationRow = Database["public"]["Tables"]["client_confirmations"]["Row"];
type ProductionTaskRow = Database["public"]["Tables"]["production_tasks"]["Row"];

export interface PendingConfirmationItem {
  confirmation: ClientConfirmationRow;
  task: ProductionTaskRow;
}

/** 現在顧客確認待ち(status=waiting)の一覧を、紐づくタスク情報とあわせて取得する。 */
export async function listPendingClientConfirmationsWithTasks(
  supabase: TypedClient,
): Promise<PendingConfirmationItem[]> {
  const { data: confirmations } = await supabase
    .from("client_confirmations")
    .select("*")
    .eq("status", "waiting")
    .order("requested_at", { ascending: true });

  if (!confirmations || confirmations.length === 0) return [];

  const taskIds = [...new Set(confirmations.map((c) => c.production_task_id))];
  const { data: tasks } = await supabase.from("production_tasks").select("*").in("id", taskIds);
  const taskById = new Map((tasks ?? []).map((t) => [t.id, t]));

  const items: PendingConfirmationItem[] = [];
  for (const confirmation of confirmations) {
    const task = taskById.get(confirmation.production_task_id);
    if (task) items.push({ confirmation, task });
  }
  return items;
}

/**
 * 経過日数がthresholdDays以上のものだけ抽出する。
 * Phase9の催促画面から再利用する想定のデータ構造・query。
 */
export function filterUrgentConfirmations(
  items: PendingConfirmationItem[],
  thresholdDays: number,
  now: Date = new Date(),
): PendingConfirmationItem[] {
  return items.filter(({ confirmation }) => {
    const days = getClientConfirmationElapsedDays(confirmation.requested_at, now);
    return days !== null && days >= thresholdDays;
  });
}

export async function listClientConfirmationsForTask(
  supabase: TypedClient,
  taskId: string,
): Promise<ClientConfirmationRow[]> {
  const { data, error } = await supabase
    .from("client_confirmations")
    .select("*")
    .eq("production_task_id", taskId)
    .order("requested_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/** 顧客詳細「顧客確認履歴」タブ用。production_tasks経由でclient_idに紐づく確認履歴を取得する。 */
export async function listClientConfirmationsForClient(
  supabase: TypedClient,
  clientId: string,
): Promise<ClientConfirmationRow[]> {
  const { data: tasks } = await supabase
    .from("production_tasks")
    .select("id")
    .eq("client_id", clientId);

  const taskIds = (tasks ?? []).map((t) => t.id);
  if (taskIds.length === 0) return [];

  const { data, error } = await supabase
    .from("client_confirmations")
    .select("*")
    .in("production_task_id", taskIds)
    .order("requested_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}
